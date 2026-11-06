import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'

import {
  CfContestForm,
  CfHackForm,
  CfProblemForm,
  CfSubmitForm,
} from '@otog/contract'

import { Role } from '../../core/constants'
import { Roles } from '../../core/decorators/roles.decorator'
import { User } from '../../core/decorators/user.decorator'
import { SubmissionBucket } from '../../core/guards/account-rate-limit.guard'
import { RolesGuard } from '../../core/guards/roles.guard'
import { UserDTO } from '../user/dto/user.dto'
import { CodeforcesService } from './codeforces.service'

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const v = schema.safeParse(body)
  if (!v.success)
    throw new BadRequestException(
      v.error.issues.map((i) => i.message).join('; ')
    )
  return v.data
}
@Controller('codeforces')
@UseGuards(RolesGuard)
export class CodeforcesController {
  constructor(private readonly cf: CodeforcesService) {}
  @Get() list() {
    return this.cf.list()
  }
  @Get('admin') @Roles(Role.Admin) adminList() {
    return this.cf.list(true)
  }
  @Post('admin') @Roles(Role.Admin) create(@Body() body: unknown) {
    return this.cf.create(parse(CfContestForm, body))
  }
  @Get('admin/:id') @Roles(Role.Admin) adminDetail(
    @Param('id', ParseIntPipe) id: number,
    @User() user: UserDTO
  ) {
    return this.cf.detail(id, user, true)
  }
  @Post('admin/:id/problem') @Roles(Role.Admin) saveProblem(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @User() user: UserDTO
  ) {
    return this.cf.saveProblem(id, parse(CfProblemForm, body), user)
  }
  @Post('admin/:id/publish') @Roles(Role.Admin) publish(
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.cf.publish(id)
  }
  @Post('admin/:id/cancel') @Roles(Role.Admin) cancel(
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.cf.cancel(id)
  }
  @Post('admin/:id/settings') @Roles(Role.Admin) settings(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown
  ) {
    return this.cf.settings(id, parse(CfContestForm, body))
  }
  @Post('admin/:id/system-tests') @Roles(Role.Admin) async systemTests() {
    await this.cf.coordinate()
    return { checked: true }
  }
  @Post('admin/:id/retry/:submissionId') @Roles(Role.Admin) retry(
    @Param('id', ParseIntPipe) id: number,
    @Param('submissionId', ParseIntPipe) submissionId: number
  ) {
    return this.cf.retry(id, submissionId)
  }
  @Get('admin/:id/job/:submissionId') @Roles(Role.Admin) job(
    @Param('id', ParseIntPipe) id: number,
    @Param('submissionId', ParseIntPipe) submissionId: number
  ) {
    return this.cf.job(id, submissionId)
  }
  @Get(':id') detail(
    @Param('id', ParseIntPipe) id: number,
    @User() user?: UserDTO
  ) {
    return this.cf.detail(id, user, user?.role === 'admin')
  }
  @Post(':id/register') @Roles(Role.User, Role.Admin) register(
    @Param('id', ParseIntPipe) id: number,
    @User() user: UserDTO
  ) {
    return this.cf.register(id, user)
  }
  @Post(':id/submit') @Roles(Role.User, Role.Admin) @SubmissionBucket() submit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @User() user: UserDTO
  ) {
    return this.cf.submit(id, parse(CfSubmitForm, body), user)
  }
  @Post(':id/lock') @Roles(Role.User, Role.Admin) lock(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @User() user: UserDTO
  ) {
    return this.cf.lockProblem(
      id,
      parse(z.object({ problemId: z.number().int().positive() }).strict(), body)
        .problemId,
      user
    )
  }
  @Post(':id/hack') @Roles(Role.User, Role.Admin) @SubmissionBucket() hack(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @User() user: UserDTO
  ) {
    return this.cf.hack(id, parse(CfHackForm, body), user)
  }
  @Header('Cache-Control', 'private, no-store')
  @Get(':id/source/:submissionId') @Roles(Role.User, Role.Admin) source(
    @Param('id', ParseIntPipe) id: number,
    @Param('submissionId', ParseIntPipe) submissionId: number,
    @User() user: UserDTO
  ) {
    return this.cf.source(id, submissionId, user)
  }
  @Header('Cache-Control', 'private, no-store')
  @Get(':id/submissions') @Roles(Role.User, Role.Admin) submissions(
    @Param('id', ParseIntPipe) id: number,
    @User() user: UserDTO
  ) {
    return this.cf.submissions(id, user, user.role === 'admin')
  }
  @Get(':id/standings') standings(
    @Param('id', ParseIntPipe) id: number,
    @User() user?: UserDTO
  ) {
    return this.cf.standings(id, user)
  }
}
