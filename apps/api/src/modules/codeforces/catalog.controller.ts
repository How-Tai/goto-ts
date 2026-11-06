import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileFieldsInterceptor } from '@nestjs/platform-express'
import type { Request, Response } from 'express'
import { resolve } from 'node:path'
import { z } from 'zod'

import { CfSubmitForm } from '@otog/contract'

import { AccessState, Role } from '../../core/constants'
import { PrismaService } from '../../core/database/prisma.service'
import { OfflineAccess } from '../../core/decorators/offline-mode.decorator'
import { Roles } from '../../core/decorators/roles.decorator'
import { User } from '../../core/decorators/user.decorator'
import { LocalFileManager, S3FileManager } from '../../core/fileManager'
import { SubmissionBucket } from '../../core/guards/account-rate-limit.guard'
import { RolesGuard } from '../../core/guards/roles.guard'
import { environment } from '../../env'
import { resolveProblemStatement, statementLanguage } from '../../utils/problem-statement'
import { UPLOAD_DIR } from '../../utils/file.util'
import type { UserDTO } from '../user/dto/user.dto'
import type { CfUploadedFiles } from './catalog.service'
import { CatalogForm, CfCatalogService } from './catalog.service'
import { CodeforcesService } from './codeforces.service'

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((i) => i.message).join('; ')
    )
  return result.data
}
@Controller('codeforces')
@UseGuards(RolesGuard)
export class CfCatalogController {
  constructor(
    private readonly catalog: CfCatalogService,
    private readonly cf: CodeforcesService,
    private readonly db: PrismaService
  ) {}

  @Get('problemset') list(
    @Query('search') search = '',
    @Query('skip') skip = '0'
  ) {
    return this.catalog.list(
      false,
      parse(z.string().max(100), search),
      parse(z.coerce.number().int().min(0).max(1000000), skip)
    )
  }
  @Get('problemset/:id') get(
    @Param('id', ParseIntPipe) id: number,
    @User() user?: UserDTO
  ) {
    return this.catalog.get(id, user)
  }
  @Post('problemset/:id/submit')
  @Roles(Role.User, Role.Admin)
  @SubmissionBucket()
  practice(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: unknown,
    @User() user: UserDTO
  ) {
    const form = parse(CfSubmitForm, data)
    if (form.problemId !== id)
      throw new BadRequestException('Problem ID does not match the URL.')
    return this.cf.practice(id, form, user)
  }
  @Get('problemset/:id/submissions')
  @Roles(Role.User, Role.Admin)
  submissions(@Param('id', ParseIntPipe) id: number, @User() user: UserDTO) {
    return this.cf.practiceSubmissions(id, user)
  }
  @Get('admin/problems') @Roles(Role.Admin) adminList(
    @Query('search') search = '',
    @Query('skip') skip = '0'
  ) {
    return this.catalog.list(
      true,
      parse(z.string().max(100), search),
      parse(z.coerce.number().int().min(0).max(1000000), skip)
    )
  }
  @Post('admin/problems') @Roles(Role.Admin) create(@Body() data: unknown) {
    return this.catalog.create(parse(CatalogForm, data))
  }
  @Post('admin/problems/import') @Roles(Role.Admin) import(
    @Body() data: unknown
  ) {
    const { problemId, destination } = parse(
      z
        .object({
          problemId: z.number().int().positive().max(2147483647),
          destination: z.enum(['otog', 'codeforces']),
        })
        .strict(),
      data
    )
    return this.catalog.copy(problemId, destination)
  }
  @Post('admin/problems/migrate') @Roles(Role.Admin) migrate() {
    return this.catalog.migrateLegacy()
  }
  @Post('admin/problems/:id') @Roles(Role.Admin) update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: unknown
  ) {
    return this.catalog.update(id, parse(CatalogForm, data))
  }
  @Post('admin/problems/:id/visibility') @Roles(Role.Admin) visibility(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: unknown
  ) {
    return this.catalog.visibility(
      id,
      parse(z.object({ show: z.boolean() }).strict(), data).show
    )
  }
  @Post('admin/problems/:id/files')
  @Roles(Role.Admin)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'pdf', maxCount: 1 },
        { name: 'pdfTh', maxCount: 1 },
        { name: 'pdfEn', maxCount: 1 },
        { name: 'zip', maxCount: 1 },
        { name: 'attachment', maxCount: 1 },
      ],
      {
        dest: resolve(UPLOAD_DIR),
        limits: { files: 5, fileSize: 100 * 1024 * 1024, fields: 0, parts: 5 },
      }
    )
  )
  files(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: CfUploadedFiles
  ) {
    return this.catalog.files(id, files)
  }

  @Get('statement/:id') @OfflineAccess(AccessState.Public) async statement(
    @Param('id', ParseIntPipe) id: number,
    @Query('contestId') contest: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
    @User() user?: UserDTO,
    @Query('lang') language?: string
  ) {
    await this.authorizeFile(id, contest, req, user)
    const manager = new LocalFileManager(),
      metadata = await resolveProblemStatement(id, manager, statementLanguage(language))
    res.setHeader('Cache-Control', 'private, no-cache, must-revalidate')
    res.setHeader('ETag', metadata.etag)
    res.setHeader('Last-Modified', metadata.lastModified.toUTCString())
    if (metadata.language) res.setHeader('Content-Language', metadata.language)
    res.type('application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${id}.pdf"`)
    if (req.fresh) return res.status(304).end()
    return (await manager.getFileReadStream(metadata.filePath)).pipe(res)
  }
  @Get('attachment/:id') @OfflineAccess(AccessState.Public) async attachment(
    @Param('id', ParseIntPipe) id: number,
    @Query('contestId') contest: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
    @User() user?: UserDTO
  ) {
    await this.authorizeFile(id, contest, req, user)
    const p = await this.db.problem.findFirst({
      where: { id, area: 'codeforces' },
      select: { attachmentMetadata: true },
    })
    if (!p?.attachmentMetadata) return res.sendStatus(404)
    const stream = await new S3FileManager(
      environment.S3_BUCKET
    ).getFileReadStream(`attachment/${id}.zip`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.type('application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`)
    stream.on('error', () => res.destroy())
    return stream.pipe(res)
  }
  private async authorizeFile(
    id: number,
    contest: string | undefined,
    req: Request,
    user?: UserDTO
  ) {
    // Embedded PDFs carry the existing HttpOnly refresh cookie rather than a
    // JS bearer header. Apply the same expiry/revocation checks before access.
    let viewer: { id: number; role: string } | undefined = user
    const rid = req.cookies?.RID
    if (!viewer && typeof rid === 'string' && rid.length <= 255) {
      const session = await this.db.refreshToken.findFirst({
        where: { id: rid, used: false, expiryDate: { gt: new Date() } },
      })
      if (session?.userId)
        viewer =
          (await this.db.user.findUnique({
            where: { id: session.userId },
            select: { id: true, role: true },
          })) ?? undefined
    }
    await this.catalog.assertStatement(
      id,
      viewer,
      contest === undefined
        ? undefined
        : parse(z.coerce.number().int().positive().max(2147483647), contest)
    )
  }
}
