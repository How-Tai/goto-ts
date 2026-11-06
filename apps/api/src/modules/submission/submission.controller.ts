import {
  BadRequestException,
  ForbiddenException,
  Controller,
  Header,
  Headers,
  Param,
  ParseIntPipe,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  TsRestHandler,
  nestControllerContract,
  tsRestHandler,
} from '@ts-rest/nest'
import { AccessState, Role } from 'src/core/constants'
import { OfflineAccess } from 'src/core/decorators/offline-mode.decorator'
import { Roles } from 'src/core/decorators/roles.decorator'
import { User } from 'src/core/decorators/user.decorator'
import { RolesGuard } from 'src/core/guards/roles.guard'
import { SubmissionBucket } from 'src/core/guards/account-rate-limit.guard'
import { z } from 'zod'

import { submissionRouter } from '@otog/contract'

import { ContestService } from '../contest/contest.service'
import { UserDTO } from '../user/dto/user.dto'
import { SubmissionService } from './submission.service'

const c = nestControllerContract(submissionRouter)

@Controller()
@UseGuards(RolesGuard)
export class SubmissionController {
  constructor(
    private submissionService: SubmissionService,
    private contestService: ContestService
  ) {}

  @Header('Cache-Control', 'private, no-store')
  @TsRestHandler(c.getSubmissions, { jsonQuery: true })
  getSubmissions(@User() user: UserDTO | undefined) {
    return tsRestHandler(
      c.getSubmissions,
      async ({
        query: { offset = 1e9, limit = 89, problemSearch, userId },
      }) => {
        if (!user) {
          const submissions = await this.submissionService.findMany({
            offset,
            limit,
            problemSearch,
            userId,
            includeContest: false,
            viewer: user,
          })
          return { status: 200, body: submissions }
        }
        if (user.role === 'admin') {
          const submissions = await this.submissionService.findManyWithAdmin({
            offset,
            limit,
            problemSearch,
            userId,
          })
          return { status: 200, body: submissions }
        }
        if (userId === user.id) {
          const submissions = await this.submissionService.findMany({
            offset,
            limit,
            problemSearch,
            userId,
            includeContest: true,
            viewer: user,
          })
          return { status: 200, body: submissions }
        }
        const submissions = await this.submissionService.findMany({
          offset,
          limit,
          problemSearch,
          userId,
          includeContest: false,
          viewer: user,
        })
        return { status: 200, body: submissions }
      }
    )
  }

  @TsRestHandler(c.getContestSubmissionsForAdmin, { jsonQuery: true })
  @Roles(Role.Admin)
  getContestSubmissionsForAdmin() {
    return tsRestHandler(
      c.getContestSubmissionsForAdmin,
      async ({
        query: { offset = 1e9, limit = 89, userSearch, problemSearch },
        params,
      }) => {
        const contestId = z.coerce.number().parse(params.contestId)
        const submissions = await this.submissionService.findAllWithContest({
          offset,
          limit,
          contestId,
          problemSearch,
          userSearch,
        })
        return { status: 200, body: submissions }
      }
    )
  }

  @OfflineAccess(AccessState.Authenticated)
  @TsRestHandler(c.getContestSubmissions, { jsonQuery: true })
  @Roles(Role.Admin, Role.User)
  getContestSubmissions(@User() user: UserDTO) {
    return tsRestHandler(
      c.getContestSubmissions,
      async ({
        query: { offset = 1e9, limit = 89, problemId, userId },
        params,
      }) => {
        const contestId = z.coerce.number().parse(params.contestId)
        if (user.role !== Role.Admin && userId !== user.id) throw new ForbiddenException()
        const submissions = await this.submissionService.getContestSubmissions({
          offset,
          limit,
          userId,
          problemId,
          contestId,
        })
        return { status: 200, body: submissions }
      }
    )
  }

  @Header('Cache-Control', 'private, no-store')
  @TsRestHandler(c.getLatestSubmissionByProblemId)
  @OfflineAccess(AccessState.Authenticated)
  @Roles(Role.Admin, Role.User)
  getLatestSubmissionByProblemId(@User() user: UserDTO) {
    return tsRestHandler(
      c.getLatestSubmissionByProblemId,
      async ({ params: { problemId } }) => {
        const id = z.coerce.number().parse(problemId)
        const submission =
          await this.submissionService.findFirstByProblemIdAndUserId(
            id,
            user.id
          )
        return { status: 200, body: { submission } }
      }
    )
  }

  @TsRestHandler(c.uploadFile, { jsonQuery: true })
  @SubmissionBucket()
  @OfflineAccess(AccessState.Authenticated)
  @Roles(Role.User, Role.Admin)
  @UseInterceptors(FileInterceptor('sourceCode', { limits: { fileSize: 10 * 1024, files: 1, fields: 1, parts: 2, fieldSize: 32, fieldNameSize: 64 } }))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @User() user: UserDTO,
    @Headers('idempotency-key') requestId?: string
  ) {
    return tsRestHandler(c.uploadFile, async ({ body, params, query }) => {
      if (!['c', 'cpp', 'python'].includes(body.language)) throw new BadRequestException('Unsupported language.')
      const contestId = query.contestId
        ? z.coerce.number().parse(query.contestId)
        : null
      const problemId = z.coerce.number().parse(params.problemId)
      if (requestId !== undefined) {
        const parsed = z.uuid().safeParse(requestId)
        if (!parsed.success) throw new BadRequestException('Invalid request ID.')
        requestId = parsed.data
      }
      const submission = await this.submissionService.create({
        userId: user.id,
        problemId,
        file,
        language: body.language,
        contestId,
        requestId,
        requireEligibility: user.role === 'user',
      })
      return { status: 200, body: submission }
    })
  }

  @Header('Cache-Control', 'private, no-store')
  @TsRestHandler(c.getLatestSubmissionByUserId)
  @Roles(Role.User, Role.Admin)
  getLatestSubmissionByUserId(@User() user: UserDTO) {
    return tsRestHandler(c.getLatestSubmissionByUserId, async () => {
      const submission = await this.submissionService.findFirstByUserId(user.id)
      return { status: 200, body: { submission } }
    })
  }

  @Header('Cache-Control', 'private, no-store')
  @TsRestHandler(c.getSubmissionsByUserId)
  getSubmissionsByUserId(@User() user?: UserDTO) {
    return tsRestHandler(
      c.getSubmissionsByUserId,
      async ({ params: { userId }, query: { limit, offset } }) => {
        const id = z.coerce.number().parse(userId)
        if (user?.role === 'admin') {
          const submissions = await this.submissionService.findAllByUserId(
            id,
            offset,
            limit,
            user
          )
          return { status: 200, body: submissions }
        }
        const submissions =
          await this.submissionService.findAllByUserIdWithOutContest(
            id,
            offset,
            limit,
            user
          )
        return { status: 200, body: submissions }
      }
    )
  }

  @Header('Cache-Control', 'private, no-store')
  @TsRestHandler(c.getSubmissionsByProblemId)
  @Roles(Role.User, Role.Admin)
  getSubmissionsByProblemId(@User() user: UserDTO) {
    return tsRestHandler(
      c.getSubmissionsByProblemId,
      async ({ params, query: { limit = 10, offset = 1e9 } }) => {
        const userId = z.coerce.number().parse(params.userId)
        const problemId = z.coerce.number().parse(params.problemId)
        if (user.role !== Role.Admin && userId !== user.id && !await this.submissionService.isProblemInContestOrPublic({ problemId, contestId: null })) throw new ForbiddenException()
        const submissions =
          await this.submissionService.getSubmissionsByProblemId({
            limit,
            userId,
            problemId,
            offset,
            viewer: user,
          })
        return { status: 200, body: submissions }
      }
    )
  }

  @TsRestHandler(c.getSubmissionProgressBatch, { jsonQuery: true })
  @OfflineAccess(AccessState.Authenticated)
  @Header('Cache-Control', 'private, no-store')
  getSubmissionProgressBatch(@User() user?: UserDTO) {
    return tsRestHandler(c.getSubmissionProgressBatch, async ({ query }) => ({
      status: 200, body: await this.submissionService.progressBatch(query.ids, user),
    }))
  }

  @Header('Cache-Control', 'private, no-store')
  @TsRestHandler(c.getSubmission)
  @OfflineAccess(AccessState.Authenticated)
  getSubmissionById(@User() user?: UserDTO) {
    return tsRestHandler(
      c.getSubmission,
      async ({ params: { submissionId } }) => {
        const id = z.coerce.number().parse(submissionId)
        if (!await this.submissionService.canRead(id, user)) return { status: 404, body: { message: 'Not Found' } }
        const submission = await this.submissionService.findOneByResultId(id)
        if (!submission) {
          return { status: 404, body: { message: 'Not Found' } }
        }
        return { status: 200, body: submission }
      }
    )
  }

  @TsRestHandler(c.getSubmissionProgress)
  @OfflineAccess(AccessState.Authenticated)
  @Header('Cache-Control', 'private, no-store')
  getSubmissionProgress(@Param('submissionId', ParseIntPipe) id: number, @User() user?: UserDTO) {
    return tsRestHandler(c.getSubmissionProgress, async () => {
      if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new BadRequestException('Invalid submission ID.')
      const submission = (await this.submissionService.findVisibleProgress([id], user))[0]
      if (!submission) return { status: 404, body: { message: 'Not Found' } }
      if (!(submission.public || submission.userId === user?.id || user?.role === Role.Admin)) {
        return { status: 403, body: { message: 'Forbidden' } }
      }
      const { public: _shared, userId: _owner, ...progress } = submission
      return { status: 200, body: { ...progress,
        submissionResult: ['waiting', 'grading'].includes(progress.status) ? null : progress.submissionResult } }
    })
  }

  @Header('Cache-Control', 'private, no-store')
  @TsRestHandler(c.getSubmissionWithSourceCode)
  @OfflineAccess(AccessState.Authenticated)
  getSubmissionWithSourceCode(
    @Param('submissionId', ParseIntPipe) submissionId: number,
    @User() user: UserDTO | undefined
  ) {
    return tsRestHandler(c.getSubmissionWithSourceCode, async () => {
      if (!await this.submissionService.canRead(submissionId, user)) return { status: 404, body: { message: 'Not Found' } }
      const submission =
        await this.submissionService.findOneByResultIdWithCode(submissionId)
      if (!submission) {
        return { status: 404, body: { message: 'Not Found' } }
      }
      if (
        !(
          submission.public ||
          submission.user.id === user?.id ||
          user?.role === Role.Admin
        )
      ) {
        return { status: 403, body: { message: 'Forbidden' } }
      }
      return { status: 200, body: submission }
    })
  }

  @TsRestHandler(c.shareSubmission)
  @Roles(Role.User, Role.Admin)
  shareSubmission(@User() user: UserDTO) {
    return tsRestHandler(
      c.shareSubmission,
      async ({ body: { show }, params: { submissionId } }) => {
        const id = z.coerce.number().parse(submissionId)
        const submission =
          await this.submissionService.findOneByResultIdWithCode(id)
        if (!submission) {
          return { status: 404, body: { message: 'Not Found' } }
        }
        if (!(user.id === submission.user.id || user.role === Role.Admin)) {
          return { status: 403, body: { message: 'Forbidden' } }
        }
        return {
          status: 200,
          body: await this.submissionService.updateSubmissionPublic(id, show),
        }
      }
    )
  }

  @TsRestHandler(c.rejudgeSubmission)
  @Roles(Role.Admin)
  rejudgeSubmission() {
    return tsRestHandler(
      c.rejudgeSubmission,
      async ({ params: { submissionId } }) => {
        const id = z.coerce.number().parse(submissionId)
        const submission = await this.submissionService.findOneByResultId(id)
        if (!submission) {
          return { status: 404, body: { message: 'Not Found' } }
        }
        return {
          status: 200,
          body: await this.submissionService.rejudgeSubmission(id),
        }
      }
    )
  }

  @TsRestHandler(c.rejudgeAllProblems)
  @Roles(Role.Admin)
  @Header('Cache-Control', 'no-store')
  rejudgeAllProblems(@User() user: UserDTO) {
    return tsRestHandler(c.rejudgeAllProblems, async ({ body }) => ({
      status: 200,
      body: await this.submissionService.rejudgeAllProblems(user.id, body.password),
    }))
  }

  @TsRestHandler(c.rejudgeProblem)
  @Roles(Role.Admin)
  rejudgeProblem() {
    return tsRestHandler(
      c.rejudgeProblem,
      async ({ params: { problemId } }) => {
        const id = z.coerce.number().parse(problemId)
        await this.submissionService.rejudgeProblem(id)
        return { status: 200, body: undefined }
      }
    )
  }
}
