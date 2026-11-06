import { activityOwnerFilter, assertActivityReadable, ActivityViewer } from '../../utils/activity-visibility'
import { ConflictException, Injectable } from '@nestjs/common'
import { Role } from 'src/core/constants'
import { PrismaService } from 'src/core/database/prisma.service'
import { searchId } from 'src/utils/search'

import {
  AdminContestWithProblems,
  ContestDetailSchema,
  ContestSchema,
  ContestScoreSchema,
  ListPaginationQuerySchema,
  UserContestScoreboard,
} from '@otog/contract'
import { Contest, Prisma } from '@otog/database'

import { ShortLivedCache } from '../../utils/short-lived-cache'
import { readableProblemFilter, ProblemViewer } from '../../utils/problem-visibility'

@Injectable()
export class ContestService {
  private readonly scoreboards = new Map<
    number,
    ShortLivedCache<Awaited<ReturnType<ContestService['buildScoreboard']>>>
  >()
  constructor(private readonly prisma: PrismaService) {}
  private async requireClassic(contestId: number) {
    const rows = await this.prisma.$queryRaw<
      any[]
    >`SELECT 1 FROM "cfContest" WHERE "contestId"=${contestId}`
    if (rows.length)
      throw new ConflictException(
        'Manage this contest through /admin/codeforces. Published CF contest settings are frozen.'
      )
  }

  async create(createContest: Prisma.ContestCreateInput) {
    return this.prisma.contest.create({
      data: {
        name: createContest.name,
        mode: createContest.mode,
        gradingMode: createContest.gradingMode,
        scoreboardPolicy: createContest.scoreboardPolicy,
        timeStart: createContest.timeStart,
        timeEnd: createContest.timeEnd,
      },
    })
  }

  listContest(args: ListPaginationQuerySchema) {
    return this.prisma.contest.findMany({
      where: { codeforces: { is: null } },
      select: {
        id: true,
        name: true,
        mode: true,
        gradingMode: true,
        scoreboardPolicy: true,
        timeStart: true,
        timeEnd: true,
        announce: true,
      },
      skip: args.skip,
      take: args.limit,
      orderBy: {
        id: 'desc',
      },
    })
  }
  countContest() {
    return this.prisma.contest.count({ where: { codeforces: { is: null } } })
  }

  findOneById(contestId: number): Promise<ContestSchema | null> {
    return this.prisma.contest.findUnique({
      where: { id: contestId },
      select: {
        id: true,
        name: true,
        mode: true,
        gradingMode: true,
        scoreboardPolicy: true,
        timeStart: true,
        timeEnd: true,
        announce: true,
      },
    })
  }

  async getContestDetail(
    contestId: number,
    viewer?: ProblemViewer
  ): Promise<ContestDetailSchema | null> {
    return this.prisma.contest.findUnique({
      where: { id: contestId },
      select: {
        id: true,
        name: true,
        mode: true,
        gradingMode: true,
        scoreboardPolicy: true,
        timeStart: true,
        timeEnd: true,
        contestProblem: {
          where: { problem: readableProblemFilter(viewer) },
          select: {
            problem: {
              select: {
                id: true,
                name: true,
                score: true,
              },
            },
          },
        },
        announce: true,
        _count: { select: { announcements: true } },
      },
    })
  }

  async getContestProblem(
    contestId: number,
    problemId: number,
    viewer?: ProblemViewer
  ) {
    return await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        contestProblem: { some: { contestId } },
        ...readableProblemFilter(viewer),
      },
    })
  }

  async hasHiddenProblems(contestId: number) {
    return (
      (await this.prisma.contestProblem.count({
        where: { contestId, problem: { show: false } },
      })) > 0
    )
  }

  async getUserContestScores(contestId: number, userId: number) {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      select: { timeStart: true },
    })
    if (!contest) {
      return null
    }

    const contestScores = await this.prisma.contestScore.findMany({
      where: {
        contestId,
        userId,
      },
      select: {
        problemId: true,
        score: true,
        latestSubmission: true,
      },
    })
    return contestScores.map((contestScore) =>
      ContestScoreSchema.parse({
        problemId: contestScore.problemId,
        score: contestScore.score,
        penalty: contestScore.latestSubmission
          ? Math.floor(
              (contestScore.latestSubmission.getTime() -
                contest.timeStart.getTime()) /
                1000
            )
          : 0,
      })
    )
  }

  async getUserContestScoreHistory(contestId: number, userId: number, viewer?: ActivityViewer) {
    await assertActivityReadable(this.prisma, userId, viewer)
    return await this.prisma.contestScore.findMany({
      where: {
        contestId,
        userId,
        user: activityOwnerFilter(viewer),
        problem: readableProblemFilter(viewer),
      },
      include: {
        contestScoreHistory: {
          include: {
            submission: {
              select: {
                creationDate: true,
                submissionResult: {
                  select: {
                    score: true,
                    subtaskResults: {
                      select: {
                        score: true,
                        fullScore: true,
                        subtaskIndex: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
  }

  async scoreboardByContestId(contestId: number, viewer?: ProblemViewer) {
    // Authorization is fresh and viewer-specific; cached score computations are not.
    const readable = await this.prisma.problem.findMany({ where: {
      contestProblem: { some: { contestId } }, ...readableProblemFilter(viewer),
    }, select: { id: true } })
    const ids = new Set(readable.map(problem => problem.id))
    let cache = this.scoreboards.get(contestId)
    if (!cache) {
      if (this.scoreboards.size >= 64)
        this.scoreboards.delete(this.scoreboards.keys().next().value!)
      cache = new ShortLivedCache()
    }
    this.scoreboards.delete(contestId)
    this.scoreboards.set(contestId, cache)
    const board = await cache.get(() => this.buildScoreboard(contestId))
    if (!board) return null
    return { ...board, contest: { ...board.contest,
      contestProblem: board.contest.contestProblem.filter(entry => ids.has(entry.problemId)) },
      userContest: board.userContest.map(entry => ({ ...entry,
        contestScores: entry.contestScores.filter(score => ids.has(score.problemId)) })) }
  }

  private async buildScoreboard(contestId: number) {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      include: {
        contestProblem: {
          include: {
            problem: { select: { id: true, name: true, score: true } },
          },
        },
        userContest: {
          where: {
            user: {
              role: Role.User,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                showName: true,
                rating: true,
                role: true,
              },
            },
          },
        },
      },
    })
    if (!contest) {
      return null
    }

    const userIdToContestScores = new Map<number, ContestScoreSchema[]>()
    const contestScores = await this.prisma.contestScore.findMany({
      where: {
        contestId,
        user: { role: Role.User },
      },
      select: {
        userId: true,
        problemId: true,
        score: true,
        latestSubmission: true,
      },
    })
    contestScores.forEach((contestScore) => {
      const parsedContestScore: ContestScoreSchema = {
        problemId: contestScore.problemId,
        score: contestScore.score,
        penalty: contestScore.latestSubmission
          ? Math.floor(
              (contestScore.latestSubmission.getTime() -
                contest.timeStart.getTime()) /
                1000
            )
          : 0,
      }
      if (userIdToContestScores.has(contestScore.userId)) {
        userIdToContestScores.get(contestScore.userId)!.push(parsedContestScore)
      } else {
        userIdToContestScores.set(contestScore.userId, [parsedContestScore])
      }
    })

    const userContestScoreboards: UserContestScoreboard[] =
      contest.userContest.map((userContest) => {
        const contestScores =
          userIdToContestScores.get(userContest.userId) ?? []
        const totalScore = contestScores
          .map((contestScore) => contestScore.score)
          .reduce((acc, val) => acc + val, 0)
        const maxPenalty = contestScores
          .map((contestScore) => contestScore.penalty)
          .reduce((acc, val) => Math.max(acc, val), 0)
        return {
          ...userContest,
          contestScores,
          totalScore,
          maxPenalty,
        }
      })
    userContestScoreboards.sort((a, b) => {
      if (b.totalScore === a.totalScore) {
        return a.maxPenalty - b.maxPenalty
      }
      return b.totalScore - a.totalScore
    })
    userContestScoreboards.forEach((user, index) => {
      if (index === 0) {
        user.rank = 1
        return
      }
      const prevUser = userContestScoreboards[index - 1]!
      if (
        user.totalScore === prevUser.totalScore &&
        user.maxPenalty === prevUser.maxPenalty
      ) {
        user.rank = prevUser.rank
        return
      }
      user.rank = index + 1
    })
    return { contest, userContest: userContestScoreboards }
  }

  // TODO: fix
  async scoreboardPrizeByContestId(contestId: number) {
    await this.prisma.contest.findUnique({
      where: { id: contestId },
    })

    const select = {
      id: true,
      problem: { select: { id: true } },
      user: { select: { id: true, showName: true } },
    }

    // * 1. First Blood: The first user that passed the task.
    const firstBloodResult = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT MIN(submission.id) AS id
      FROM submission
      INNER JOIN "user"
      ON "user".id = submission."userId" AND "user"."role"='user'
      WHERE "contestId" = ${contestId} AND status = 'accept'
      GROUP BY "submission"."problemId"`
    const firstBloodIds = firstBloodResult.map((result) => result.id)
    const firstBlood = await this.prisma.submission.findMany({
      select,
      where: { id: { in: firstBloodIds } },
    })

    // * 2. Faster Than Light: The user that solved the task with fastest algorithm.
    // const fasterThanLightResult = await this.prisma.$queryRaw<{ id: number }[]>`
    //   SELECT s.id AS id
    //     FROM (
    //       SELECT "problemId", MIN("timeUsed") AS "minTimeUsed"
    //       FROM submission
    //       INNER JOIN "user"
    //       ON "user".id = submission."userId" AND "user"."role"='user'
    //       WHERE "contestId" = ${contestId} AND status = 'accept' GROUP BY "submission"."problemId"
    //     ) t
    //     INNER JOIN (
    //       SELECT submission.*
    //       FROM submission
    //       INNER JOIN "user"
    //       ON "user".id = submission."userId" AND "user"."role"='user'
    //       WHERE "contestId" = ${contestId} AND status = 'accept'
    //     ) s
    //     ON s."problemId" = t."problemId" AND s."timeUsed" = t."minTimeUsed"`
    // const fasterThanLightIds = fasterThanLightResult.map((result) => result.id)
    // const fasterThanLight = await this.prisma.submission.findMany({
    //   select,
    //   where: {
    //     contestId,
    //     id: {
    //       in: fasterThanLightIds,
    //     },
    //   },
    // })

    // * 3. Passed In One: The user that passed the task in one submission.
    // const passedInOneResult = await this.prisma.$queryRaw<{ id: number }[]>`
    //   SELECT s.id AS id
    //     FROM (
    //       SELECT "problemId", "userId", MIN(submission.id) as id
    //         FROM submission
    //         INNER JOIN "user"
    //         ON "user".id = submission."userId" AND "user"."role"='user'
    //         WHERE "contestId" = ${contestId}
    //         GROUP BY "problemId", "userId"
    //     ) t
    //     INNER JOIN submission s
    //     ON s.id = t.id AND s.status = 'accept'`
    // const passedInOneIds = passedInOneResult.map((result) => result.id)
    // const passedInOne = await this.prisma.submission.findMany({
    //   select,
    //   where: { id: { in: passedInOneIds } },
    // })

    // * 4. One Man Solve: The only one user that passed the task.
    const oneManSolveResult = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT ON (s."problemId")
        s.id AS id
      FROM (
        SELECT "problemId", COUNT(DISTINCT "userId") AS "passedCount"
        FROM submission
        INNER JOIN "user"
        ON "user".id = submission."userId" AND "user"."role"='user'
        WHERE "contestId" = ${contestId} AND submission.status = 'accept'
        GROUP BY "problemId"
      ) t
      INNER JOIN (
        SELECT submission.*
        FROM submission
        INNER JOIN "user"
        ON "user".id = submission."userId" AND "user"."role"='user'
        WHERE "contestId" = ${contestId} AND status = 'accept'
      ) s
      ON t."passedCount" = 1 AND s."problemId" = t."problemId"`
    const oneManSolveIds = oneManSolveResult.map((result) => result.id)
    const oneManSolve = await this.prisma.submission.findMany({
      select,
      where: {
        contestId,
        id: { in: oneManSolveIds },
      },
    })

    return { firstBlood, oneManSolve }
  }

  getCurrentContests(now = new Date()) {
    return this.prisma.contest.findMany({
      where: {
        codeforces: { is: null },
        timeStart: {
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
        timeEnd: {
          gt: now,
        },
      },
      select: {
        id: true,
        name: true,
        mode: true,
        gradingMode: true,
        scoreboardPolicy: true,
        timeStart: true,
        timeEnd: true,
        announce: true,
      },
      orderBy: {
        timeStart: 'asc',
      },
    })
  }

  getStartedAndUnFinishedContests() {
    return this.prisma.contest.findMany({
      where: {
        timeStart: {
          lte: new Date(),
        },
        timeEnd: {
          gte: new Date(),
        },
      },
      include: {
        contestProblem: true,
      },
    })
  }

  async toggleProblemToContest(
    contestId: number,
    problemId: number,
    show: boolean
  ) {
    await this.requireClassic(contestId)
    if (show) {
      if (!await this.prisma.problem.findFirst({ where: { id: problemId, area: 'otog' }, select: { id: true } }))
        throw new ConflictException('Import the CF problem into OTOG before adding it to an OTOG contest.')
      await this.prisma.contestProblem.create({
        data: {
          problemId,
          contestId,
        },
      })
      return { show }
    } else {
      await this.prisma.contestProblem.delete({
        where: {
          contestId_problemId: {
            problemId,
            contestId,
          },
        },
      })
      return { show }
    }
  }

  async putProblemToContest(args: {
    contestId: number
    data: Array<{ problemId: number }>
  }) {
    await this.requireClassic(args.contestId)
    const ids = [...new Set(args.data.map(p => p.problemId))]
    if (await this.prisma.problem.count({ where: { id: { in: ids }, area: 'otog' } }) !== ids.length)
      throw new ConflictException('Only OTOG problem IDs can be added to this contest.')
    await this.prisma.contestProblem.createMany({
      data: args.data.map((problemId) => ({
        contestId: args.contestId,
        problemId: problemId.problemId,
      })),
      skipDuplicates: true,
    })
  }

  async addUserToContest(contestId: number, userId: number) {
    return this.prisma.userContest.upsert({
      where: { userId_contestId: { userId, contestId } },
      create: { userId, contestId },
      update: {},
    })
  }

  async updateContest(
    contestId: number,
    contestData: Prisma.ContestUpdateInput
  ) {
    await this.requireClassic(contestId)
    return this.prisma.contest.update({
      where: { id: contestId },
      data: contestData,
    })
  }

  async patchContest(
    contestId: number,
    contestData: Prisma.ContestUpdateInput
  ) {
    await this.requireClassic(contestId)
    return this.prisma.contest.update({
      where: { id: contestId },
      data: contestData,
    })
  }

  async deleteContest(contestId: number) {
    await this.requireClassic(contestId)
    return this.prisma.contest.delete({ where: { id: contestId } })
  }

  async getContestsForAdmin(
    args: ListPaginationQuerySchema
  ): Promise<Contest[]> {
    return await this.prisma.contest.findMany({
      skip: args.skip,
      take: args.limit,
      where: {
        codeforces: { is: null },
        ...(args.search
          ? {
              OR: [
                searchId(args.search),
                { name: { contains: args.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { id: 'desc' },
    })
  }
  async getContestCountForAdmin(args: { search?: string }): Promise<number> {
    return await this.prisma.contest.count({
      where: {
        codeforces: { is: null },
        ...(args.search
          ? {
              OR: [
                searchId(args.search),
                { name: { contains: args.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    })
  }

  async getContestForAdmin(args: {
    id: number
  }): Promise<AdminContestWithProblems | null> {
    return await this.prisma.contest.findUnique({
      where: { id: args.id },
      include: {
        contestProblem: {
          include: {
            problem: true,
          },
          orderBy: { problemId: 'desc' },
        },
      },
    })
  }
}
