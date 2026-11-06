import { activityOwnerFilter, assertActivityReadable } from '../../utils/activity-visibility'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common'
// src: https://github.com/DefinitelyTyped/DefinitelyTyped/issues/47780
import { Multer } from 'multer'
import { createHash } from 'node:crypto'
import { PrismaService } from 'src/core/database/prisma.service'
import { scodeFileFilter, scodeFileSizeLimit } from 'src/utils'
import { contestResultsFilter } from 'src/utils/contest-visibility'

import { KeywordRules, checkKeywords } from '@otog/contract'
import { Prisma, SubmissionStatus, UserRole } from '@otog/database'

import { verifyPassword } from '../../utils/password'
import { TokenBuckets } from '../../utils/token-bucket'
import { WITHOUT_PASSWORD } from '../user/user.service'

type Viewer = { id: number; role: string } | undefined
const visibility = (user: Viewer): Prisma.SubmissionWhereInput =>
  user?.role === 'admin'
    ? { problem: { area: 'otog' } }
    : {
        problem: { area: 'otog' },
        user: activityOwnerFilter(user),
        OR: [
          ...(user ? [{ userId: user.id }] : []),
          {
            problem: { area: 'otog', show: true },
            OR: [{ contestId: null }, { contest: contestResultsFilter() }],
          },
        ],
      }

export const WITHOUT_DETAIL = {
  id: true,
  status: true,
  contestId: true,
  language: true,
  creationDate: true,
  public: true,
  userId: true,
  problem: {
    select: {
      id: true,
      name: true,
      timeLimit: true,
      memoryLimit: true,
      score: true,
    },
  },
  user: { select: WITHOUT_PASSWORD },
  submissionResult: {
    select: {
      id: true,
      score: true,
      timeUsed: true,
      memUsed: true,
      result: true,
      errmsg: true,
    },
  },
} satisfies Prisma.SubmissionSelect

const WITH_DETAIL = {
  ...WITHOUT_DETAIL,
  sourceCode: true,
  submissionResult: {
    select: {
      id: true,
      score: true,
      timeUsed: true,
      memUsed: true,
      result: true,
      errmsg: true,
      subtaskResults: {
        select: {
          score: true,
          fullScore: true,
          subtaskIndex: true,
          verdicts: {
            orderBy: { testcaseIndex: 'asc' },
          },
        },
        orderBy: { subtaskIndex: 'asc' },
      },
    },
  },
} satisfies Prisma.SubmissionSelect

@Injectable()
export class SubmissionService {
  private readonly rejudgePasswordAttempts = new TokenBuckets()
  constructor(private readonly prisma: PrismaService) {}

  async findManyWithAdmin(args: {
    offset: number
    limit: number
    userId?: number
    problemSearch?: string
  }) {
    return await this.prisma.submission.findMany({
      where: {
        contestId: null,
        id: { lt: args.offset },
        userId: args.userId,
        problem: { area: 'otog', ...(args.problemSearch
          ? { name: { contains: args.problemSearch, mode: 'insensitive' as const } }
          : {}) },
      },
      take: args.limit,
      select: WITHOUT_DETAIL,
      orderBy: { id: 'desc' },
    })
  }

  async findMany(args: {
    offset: number
    limit: number
    userId?: number
    problemSearch?: string
    includeContest: boolean
    viewer?: Viewer
  }) {
    if (args.userId !== undefined) await assertActivityReadable(this.prisma, args.userId, args.viewer)
    return await this.prisma.submission.findMany({
      where: {
        contestId: args.includeContest ? undefined : null,
        id: { lt: args.offset },
        userId: args.userId,
        user: activityOwnerFilter(args.viewer),
        problem: {
          area: 'otog',
          ...(args.includeContest ? {} : { show: true }),
          ...(args.problemSearch
            ? {
                name: {
                  contains: args.problemSearch,
                  mode: 'insensitive' as const,
                },
              }
            : {}),
        },
      },
      take: args.limit,
      select: WITHOUT_DETAIL,
      orderBy: { id: 'desc' },
    })
  }

  async getContestSubmissions(args: {
    offset: number
    limit: number
    userId: number
    contestId: number
    problemId: number
  }) {
    return await this.prisma.submission.findMany({
      where: {
        contestId: args.contestId,
        id: { lt: args.offset },
        userId: args.userId,
        problemId: args.problemId,
      },
      take: args.limit,
      select: WITHOUT_DETAIL,
      orderBy: { creationDate: 'desc' },
    })
  }

  findAllWithContest(args: {
    contestId: number
    offset: number
    limit: number
    problemSearch: string | undefined
    userSearch: string | undefined
  }) {
    return this.prisma.submission.findMany({
      where: {
        contestId: args.contestId,
        id: { lt: args.offset },
        problem: { area: 'otog', ...(args.problemSearch
          ? { name: { contains: args.problemSearch, mode: 'insensitive' as const } }
          : {}) },
        user: args.userSearch
          ? { showName: { contains: args.userSearch, mode: 'insensitive' } }
          : undefined,
      },
      take: args.limit,
      select: WITHOUT_DETAIL,
      orderBy: { id: 'desc' },
    })
  }

  async findOneByResultId(resultId: number) {
    return this.prisma.submission.findUnique({
      where: { id: resultId },
      select: WITHOUT_DETAIL,
    })
  }

  async findOneByResultIdWithCode(resultId: number) {
    return this.prisma.submission.findUnique({
      where: { id: resultId },
      select: WITH_DETAIL,
    })
  }

  findProgress(submissionId: number) {
    return this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        status: true,
        queuedAt: true,
        updateDate: true,
        public: true,
        userId: true,
      },
    })
  }

  async findVisibleProgress(ids: number[], user: Viewer) {
    const rows = await this.prisma.submission.findMany({
      where: { AND: [{ id: { in: ids } }, visibility(user)] },
      select: {
        id: true,
        status: true,
        queuedAt: true,
        updateDate: true,
        public: true,
        userId: true,
        submissionResult: {
          select: {
            id: true,
            score: true,
            result: true,
            timeUsed: true,
            memUsed: true,
          },
        },
      },
    })
    return rows
  }

  async progressBatch(ids: number[], user: Viewer) {
    return (await this.findVisibleProgress(ids, user))
      .filter(
        (row) => row.public || row.userId === user?.id || user?.role === 'admin'
      )
      .map(({ public: _shared, userId: _owner, ...row }) => ({
        ...row,
        submissionResult: ['waiting', 'grading'].includes(row.status)
          ? null
          : row.submissionResult,
      }))
  }

  async canRead(submissionId: number, user: Viewer) {
    return !!(await this.prisma.submission.findFirst({
      where: { id: submissionId, ...visibility(user) },
      select: { id: true },
    }))
  }

  fileCheck(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required!')
    }
    // check file extension
    if (!scodeFileFilter(file))
      throw new BadRequestException('Only C C++ and Python are allowed!')
    // check file size
    if (!scodeFileSizeLimit(file, 10 * 1024))
      throw new BadRequestException('File is too large!')
  }

  async create(args: {
    userId: number
    problemId: number
    language: string
    file: Express.Multer.File
    contestId: number | null
    requestId?: string
    requireEligibility?: boolean
  }) {
    this.fileCheck(args.file)
    if (!await this.prisma.problem.findFirst({ where: { id: args.problemId, area: 'otog' }, select: { id: true } }))
      throw new BadRequestException('Use the CF submission page for CF problems.')
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([args.problemId, args.contestId, args.language]))
      .update(args.file.buffer)
      .digest('hex')
    return await this.prisma.$transaction(async (tx) => {
      if (
        args.contestId &&
        (
          await tx.$queryRaw<
            Array<{ found: number }>
          >`SELECT 1 AS found FROM "cfContest" WHERE "contestId"=${args.contestId}`
        ).length
      ) {
        throw new BadRequestException(
          'Submit to this contest through /codeforces so its pretests and problem locks are enforced.'
        )
      }
      if (args.requestId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(140026, hashtext(${args.userId + ':' + args.requestId}))`
        const previous = await tx.$queryRaw<
          Array<{ fingerprint: string; submissionId: number }>
        >`SELECT fingerprint, "submissionId" FROM "otogSubmissionRequest" WHERE "userId"=${args.userId} AND "requestId"=${args.requestId}`
        if (previous[0]) {
          if (previous[0].fingerprint !== fingerprint)
            throw new ConflictException(
              'This request ID was already used for different code.'
            )
          const submission = await tx.submission.findUnique({
            where: { id: previous[0].submissionId },
          })
          if (submission) return submission
        }
      }
      if (
        args.requireEligibility &&
        !(await tx.problem.findFirst({
          where: this.eligibilityWhere(args),
          select: { id: true },
        }))
      ) {
        throw new BadRequestException('Problem is not in contest or public!')
      }
      // Check current rules before taking queue capacity or creating a submission.
      const rows = await tx.$queryRaw<
        KeywordRules[]
      >`SELECT "requiredKeywords", "bannedKeywords" FROM "otogProblemKeywordRules" WHERE "problemId"=${args.problemId}`
      const rules = rows[0] ?? { requiredKeywords: [], bannedKeywords: [] }
      const failure = checkKeywords(
        args.file.buffer.toString(),
        args.language,
        rules
      )
      if (failure.missing.length || failure.banned.length) {
        throw new BadRequestException({
          code: 'KEYWORD_REQUIREMENTS',
          message: 'Code does not meet this problem’s keyword requirements.',
          ...rules,
          ...failure,
        })
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(140014,1)`
      const counts = await tx.$queryRaw<
        Array<{ mine: number; total: number }>
      >`SELECT
        COUNT(*) FILTER (WHERE "userId"=${args.userId})::integer AS mine,
        COUNT(*)::integer AS total FROM submission WHERE status IN ('waiting','grading')`
      if (counts[0] && (counts[0].mine >= 200 || counts[0].total >= 5000))
        throw new HttpException(
          'The submission queue is full. Please wait for queued work to finish.',
          429
        )
      if (args.contestId)
        await tx.userContest.upsert({
          where: {
            userId_contestId: {
              userId: args.userId,
              contestId: args.contestId,
            },
          },
          create: { userId: args.userId, contestId: args.contestId },
          update: {},
        })
      const submission = await tx.submission.create({
        data: {
          userId: args.userId,
          problemId: args.problemId,
          language: args.language,
          status: SubmissionStatus.waiting,
          sourceCode: args.file.buffer.toString(),
          contestId: args.contestId,
        },
      })
      if (args.requestId)
        await tx.$executeRaw`INSERT INTO "otogSubmissionRequest" ("userId", "requestId", fingerprint, "submissionId") VALUES (${args.userId}, ${args.requestId}, ${fingerprint}, ${submission.id})`
      return submission
    })
  }

  isProblemInContestOrPublic(args: {
    problemId: number
    contestId: number | null
  }) {
    return this.prisma.problem.findFirst({
      select: { id: true },
      where: this.eligibilityWhere(args),
    })
  }

  private eligibilityWhere(args: {
    problemId: number
    contestId: number | null
  }): Prisma.ProblemWhereInput {
    return {
      id: args.problemId,
      area: 'otog',
      ...(args.contestId
        ? {
            contestProblem: {
              some: {
                contestId: args.contestId,
                contest: {
                  timeStart: { lte: new Date() },
                  timeEnd: { gte: new Date() },
                },
              },
            },
          }
        : { show: true }),
    }
  }

  async findAllByUserIdWithOutContest(userId: number, offset = 1e9, limit = 89, viewer?: Viewer) {
    await assertActivityReadable(this.prisma, userId, viewer)
    return this.prisma.submission.findMany({
      where: {
        contestId: null,
        problem: { area: 'otog', show: true },
        userId,
        user: activityOwnerFilter(viewer),
        id: { lt: offset },
      },
      take: limit,
      select: WITHOUT_DETAIL,
      orderBy: { id: 'desc' },
    })
  }

  async findAllByUserId(userId: number, offset = 1e9, limit = 89, viewer?: Viewer) {
    await assertActivityReadable(this.prisma, userId, viewer)
    return this.prisma.submission.findMany({
      where: {
        userId,
        user: activityOwnerFilter(viewer),
        id: { lt: offset },
      },
      take: limit,
      select: WITHOUT_DETAIL,
      orderBy: { id: 'desc' },
    })
  }

  async getSubmissionsByProblemId(args: {
    userId: number
    problemId: number
    limit: number
    offset: number
    viewer: Viewer
  }) {
    await assertActivityReadable(this.prisma, args.userId, args.viewer)
    return this.prisma.submission.findMany({
      where: {
        userId: args.userId,
        problemId: args.problemId,
        id: { lt: args.offset },
        ...visibility(args.viewer),
      },
      take: args.limit,
      select: WITHOUT_DETAIL,
      orderBy: { id: 'desc' },
    })
  }

  findFirstByUserId(userId: number) {
    return this.prisma.submission.findFirst({
      where: { userId },
      orderBy: { id: 'desc' },
      select: WITH_DETAIL,
    })
  }

  findFirstByProblemIdAndUserId(problemId: number, userId: number) {
    return this.prisma.submission.findFirst({
      where: { userId, problemId },
      orderBy: { id: 'desc' },
      select: WITH_DETAIL,
    })
  }

  async findAllLatestAccept() {
    const maxGroups = await this.prisma.submission.groupBy({
      _max: { id: true },
      by: ['problemId', 'userId'],
      where: { status: SubmissionStatus.accept },
    })
    const ids = maxGroups
      .map((group) => group._max.id)
      .filter((id): id is number => id !== null)
    return this.prisma.submission.findMany({
      select: WITHOUT_DETAIL,
      where: {
        id: { in: ids },
        user: { role: { not: UserRole.admin } },
      },
      orderBy: { problemId: 'asc' },
    })
  }

  async findLatestSubmissionIds(problemId: number) {
    const maxGroups = await this.prisma.submission.groupBy({
      _max: { id: true },
      by: ['userId'],
      where: { status: SubmissionStatus.accept, problemId },
    })
    return maxGroups.map((group) => group._max.id)
  }

  async findAllLatestSubmission(problemId: number) {
    const submissionIds = await this.findLatestSubmissionIds(problemId)
    const ids = submissionIds.filter((id): id is number => id !== null)
    return this.prisma.submission.findMany({
      where: {
        id: { in: ids },
      },
    })
  }

  async updateSubmissionPublic(submissionId: number, show: boolean) {
    const cf = await this.prisma.$queryRaw<
      any[]
    >`SELECT C.phase FROM "cfRun" R JOIN "cfProblem" P ON P.id=R."cfProblemId" JOIN "cfContest" C ON C."contestId"=P."contestId" WHERE R."submissionId"=${submissionId}`
    if (cf.length && cf[0].phase !== 'final')
      throw new ConflictException(
        'CF contest source sharing is controlled by problem locks until final results.'
      )
    return this.prisma.submission.update({
      where: { id: submissionId },
      data: { public: show },
      select: { public: true },
    })
  }

  async rejudgeSubmission(submissionId: number) {
    return this.prisma.$transaction(async (tx) => {
      const cf = await tx.$queryRaw<
        any[]
      >`SELECT R.kind,P."contestId" FROM "cfRun" R JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE R."submissionId"=${submissionId}`
      if (cf.length)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(140131,${cf[0].contestId}::int)`
      const [state] = await tx.$queryRaw<
        any[]
      >`SELECT status FROM submission WHERE id=${submissionId} FOR UPDATE`
      if (!state || ['waiting', 'grading'].includes(state.status))
        throw new ConflictException(
          'Wait for the active grading job to finish.'
        )
      await tx.submissionResult.delete({ where: { submissionId } })
      if (cf[0]?.kind === 'contest') {
        await tx.$executeRaw`UPDATE "cfRun" SET phase='pretest',outcome=NULL,"preOutcome"=NULL WHERE "submissionId"=${submissionId}`
        await tx.$executeRaw`UPDATE "cfContest" SET phase='system_pending' WHERE "contestId"=${cf[0].contestId} AND phase IN ('final','system_testing')`
      }
      return tx.submission.update({
        where: { id: submissionId },
        data: { status: SubmissionStatus.waiting },
        select: WITHOUT_DETAIL,
      })
    })
  }

  async rejudgeAllProblems(adminId: number, password: string) {
    const admission = this.rejudgePasswordAttempts.take(String(adminId), {
      capacity: 5,
      refillPerSecond: 1 / 12,
    })
    if (!admission.allowed)
      throw new HttpException(
        {
          message: 'กรุณารอสักครู่แล้วลองใหม่',
          retryAfterSeconds: admission.retryAfterSeconds,
        },
        admission.unavailable ? 503 : 429
      )
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { role: true, password: true },
    })
    if (!admin || admin.role !== UserRole.admin) throw new ForbiddenException()
    if (!(await verifyPassword(password, admin.password)))
      throw new ForbiddenException('รหัสผ่านไม่ถูกต้อง')

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout='5s'`
        await tx.$executeRaw`SET LOCAL statement_timeout='15s'`
        // Prevent a concurrent password/role change from authorizing this action.
        const identity = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM "user" WHERE id=${adminId} AND role='admin' AND password=${admin.password} FOR SHARE`
        if (!identity.length)
          throw new ForbiddenException('กรุณายืนยันรหัสผ่านอีกครั้ง')
        const cfContests = await tx.$queryRaw<
          any[]
        >`SELECT DISTINCT P."contestId" FROM "cfRun" R JOIN "cfProblem" P ON P.id=R."cfProblemId" JOIN submission S ON S.id=R."submissionId" WHERE R.kind='contest' AND S.status NOT IN ('waiting','grading') ORDER BY P."contestId"`
        for (const c of cfContests)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(140131,${c.contestId}::int)`
        // Lock completed rows before changing results. Active leases and already
        // pending submissions retain their work, results and queue positions.
        const [result] = await tx.$queryRaw<Array<{ queued: number }>>`
        WITH targets AS MATERIALIZED (
          SELECT S.id FROM submission S
          WHERE S.status NOT IN ('waiting','grading')
            AND NOT EXISTS (SELECT 1 FROM "cfRun" CF WHERE CF."submissionId"=S.id AND CF.kind<>'contest')
            AND NOT EXISTS (SELECT 1 FROM "otogWorkerJob" J WHERE J."submissionId"=S.id)
          ORDER BY S.id FOR UPDATE OF S
        ), reset_cf_runs AS (
          UPDATE "cfRun" R SET phase='pretest',outcome=NULL,"preOutcome"=NULL
          FROM targets T WHERE R."submissionId"=T.id AND R.kind='contest' RETURNING R."cfProblemId"
        ), reset_cf_contests AS (
          UPDATE "cfContest" C SET phase='system_pending' WHERE C.phase IN ('final','system_testing')
            AND C."contestId" IN (SELECT P."contestId" FROM "cfProblem" P JOIN reset_cf_runs R ON R."cfProblemId"=P.id)
        ), removed_results AS (
          DELETE FROM "submissionResult" R USING targets T WHERE R."submissionId"=T.id
        ), removed_attempts AS (
          DELETE FROM "otogWorkerAttempt" A USING targets T WHERE A."submissionId"=T.id
        ), removed_artifacts AS (
          DELETE FROM "otogCompiledArtifact" A USING targets T WHERE A."submissionId"=T.id
        ), updated AS (
          UPDATE submission S SET status='waiting',"updateDate"=statement_timestamp()
          FROM targets T WHERE S.id=T.id RETURNING S.id
        ) SELECT count(*)::int AS queued FROM updated`
        if (result!.queued)
          await tx.$executeRaw`SELECT pg_notify('otog_queue_wakeup','rejudge-all')`
        return result!
      },
      { maxWait: 5000, timeout: 20000 }
    )
  }

  async rejudgeProblem(problemId: number) {
    await this.prisma.$transaction(
      async (tx) => {
        const contests = await tx.$queryRaw<
          any[]
        >`SELECT DISTINCT P."contestId" FROM "cfProblem" P WHERE P."problemId"=${problemId} ORDER BY P."contestId"`
        for (const c of contests)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(140131,${c.contestId}::int)`
        await tx.$queryRaw`WITH targets AS MATERIALIZED (
        SELECT S.id FROM submission S WHERE S."problemId"=${problemId} AND S.status NOT IN ('waiting','grading')
        AND NOT EXISTS(SELECT 1 FROM "otogWorkerJob" J WHERE J."submissionId"=S.id)
        AND NOT EXISTS(SELECT 1 FROM "cfRun" R WHERE R."submissionId"=S.id AND R.kind<>'contest')
        ORDER BY S.id FOR UPDATE OF S
      ), cf_runs AS (
        UPDATE "cfRun" R SET phase='pretest',outcome=NULL,"preOutcome"=NULL FROM targets T
        WHERE R."submissionId"=T.id AND R.kind='contest' RETURNING R."cfProblemId"
      ), cf_contests AS (
        UPDATE "cfContest" C SET phase='system_pending' WHERE C.phase IN ('final','system_testing')
        AND C."contestId" IN(SELECT P."contestId" FROM "cfProblem" P JOIN cf_runs R ON R."cfProblemId"=P.id)
      ), results AS (DELETE FROM "submissionResult" V USING targets T WHERE V."submissionId"=T.id),
      attempts AS (DELETE FROM "otogWorkerAttempt" A USING targets T WHERE A."submissionId"=T.id),
      artifacts AS (DELETE FROM "otogCompiledArtifact" A USING targets T WHERE A."submissionId"=T.id),
      updated AS (UPDATE submission S SET status='waiting',"updateDate"=now() FROM targets T WHERE S.id=T.id RETURNING S.id)
      SELECT count(*)::int FROM updated`
        await tx.$executeRaw`SELECT pg_notify('otog_queue_wakeup','rejudge-problem')`
      },
      { timeout: 20000 }
    )
  }
}
