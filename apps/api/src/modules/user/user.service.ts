import { activityOwnerFilter, assertActivityReadable, ActivityViewer } from '../../utils/activity-visibility'
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common'
import { hashPassword } from '../../utils/password'
import { Role } from 'src/core/constants'
import { PrismaService } from 'src/core/database/prisma.service'
import { userList } from 'src/utils'
import { searchId } from 'src/utils/search'
import { contestResultsFilter } from 'src/utils/contest-visibility'

import { ListPaginationQuerySchema, LeaderboardQuerySchema } from '@otog/contract'
import { ContestMode, Prisma, User } from '@otog/database'

export const WITHOUT_PASSWORD = {
  id: true,
  username: true,
  showName: true,
  role: true,
  rating: true,
  showInLeaderboard: true,
} as const

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Pick<User, 'username' | 'password' | 'showName'>) {
    const userNameExists = await this.findOneByUsername(data.username)
    if (userNameExists) {
      throw new ConflictException('username was taken.')
    }
    const showNameExists = await this.findOneByShowName(data.showName)
    if (showNameExists) {
      throw new ConflictException('showName was taken.')
    }
    const passwordHash = await hashPassword(data.password)
    try {
      await this.prisma.user.create({
        data: {
          username: data.username,
          password: passwordHash,
          showName: data.showName,
          role: Role.User,
        },
      })
    } catch {
      throw new BadRequestException()
    }
    return { message: 'Create user complete.', status: true }
  }

  async getUsersForAdmin(args: ListPaginationQuerySchema) {
    return this.prisma.user.findMany({
      take: args.limit,
      skip: args.skip,
      where: args.search
        ? {
            OR: [
              searchId(args.search),
              { showName: { contains: args.search, mode: 'insensitive' } },
              { username: { contains: args.search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        username: true,
        showName: true,
        role: true,
        rating: true,
        showInLeaderboard: true,
      },
      orderBy: { id: 'desc' },
    })
  }
  async getLeaderboard(
    args: LeaderboardQuerySchema,
    requestingUserId: number | undefined,
    isAdminUser: boolean,
  ) {
    const now = new Date()
    const search = (args.search ?? '').trim().toLowerCase()
    // Filter privacy before ranking; search and pagination retain global ranks.
    // Keep unreleased contest results and private-problem totals out of public responses.
    const [result] = await this.prisma.$queryRaw<Array<{
      data: Array<{
        id: number; username: string; showName: string; role: 'user' | 'admin'
        rating: number | null; showInLeaderboard: boolean
        passedCount: number; passedCountAll?: number; rank: number
      }>
      total: number
    }>>`
      WITH stats AS (
        SELECT u.id, u.username, u."showName", u.role, u.rating, u."showInLeaderboard",
          COUNT(DISTINCT CASE WHEN p.area='otog' AND p.show AND (
            s."contestId" IS NULL OR
            c."scoreboardPolicy" = 'DURING_CONTEST' AND c."timeStart" < ${now} OR
            c."scoreboardPolicy" = 'AFTER_CONTEST' AND c."timeEnd" < ${now}
          ) THEN s."problemId" END)::int AS "passedCount",
          COUNT(DISTINCT CASE WHEN p.area='otog' THEN s."problemId" END)::int AS "passedCountAll"
        FROM "user" u
        LEFT JOIN "submission" s ON s."userId" = u.id AND s.status = 'accept'
        LEFT JOIN "problem" p ON p.id = s."problemId"
        LEFT JOIN "contest" c ON c.id = s."contestId"
        WHERE u."showInLeaderboard" OR u.id = ${requestingUserId ?? null}::int
          OR ${isAdminUser && args.showAll}
        GROUP BY u.id
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          ORDER BY "passedCount" DESC, COALESCE(rating, 0) DESC, "showName", id
        )::int AS rank FROM stats
      ), filtered AS (
        SELECT * FROM ranked WHERE ${search} = '' OR
          strpos(lower("showName"), ${search}) > 0 OR strpos(lower(username), ${search}) > 0
      ), page AS (
        SELECT * FROM filtered ORDER BY rank LIMIT ${args.limit} OFFSET ${args.skip}
      )
      SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
        COALESCE((SELECT jsonb_agg(
          CASE WHEN ${isAdminUser} THEN to_jsonb(page)
            ELSE to_jsonb(page) - 'passedCountAll' END ORDER BY rank
        ) FROM page), '[]'::jsonb) AS data
    `
    return result ?? { data: [], total: 0 }
  }

  async getUsersCountForAdmin(args: ListPaginationQuerySchema) {
    return this.prisma.user.count({
      where: args.search
        ? {
            OR: [
              searchId(args.search),
              { showName: { contains: args.search, mode: 'insensitive' } },
              { username: { contains: args.search, mode: 'insensitive' } },
            ],
          }
        : undefined,
    })
  }

  async findOneByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      select: WITHOUT_PASSWORD,
    })
  }

  async findOneById(id: number) {
    return this.prisma.user.findUnique({
      where: { id },
      select: WITHOUT_PASSWORD,
    })
  }

  async findOneByShowName(showName: string) {
    return this.prisma.user.findUnique({
      where: { showName },
      select: WITHOUT_PASSWORD,
    })
  }

  async updateShowNameById(showName: string, id: number) {
    const showNameExists = await this.findOneByShowName(showName)
    if (showNameExists) {
      throw new ConflictException('showName was taken.')
    }
    return this.prisma.user.update({
      where: { id },
      data: { showName },
      select: { showName: true },
    })
  }

  async updateLeaderboardVisibilityById(showInLeaderboard: boolean, id: number) {
    return this.prisma.user.update({
      where: { id },
      data: { showInLeaderboard },
      select: { showInLeaderboard: true },
    })
  }


  async getUserProfileById(id: number, viewer?: ActivityViewer) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        ...WITHOUT_PASSWORD,
        userContest: {
          select: {
            contest: {
              select: {
                id: true,
                name: true,
                timeStart: true,
              },
            },
            rank: true,
            ratingAfterUpdate: true,
          },
          where: { rank: { not: null }, contest: { mode: ContestMode.rated }, user: activityOwnerFilter(viewer) },
        },
      },
    })
  }

  async onlineUser() {
    const checkList = new Map()
    const onlineUser = Array.from(userList.values())
    return onlineUser.filter((user) => {
      if (checkList.get(user.id)) return false
      checkList.set(user.id, true)
      return true
    })
  }

  async updateUser(userId: number, userData: Prisma.UserUpdateInput) {
    if (userData.role === 'admin' && userData.showInLeaderboard === undefined) {
      userData.showInLeaderboard = false
    }
    if (typeof userData.password === 'string' && !!userData.password) {
      const passwordHash = await hashPassword(userData.password)
      return this.prisma.$transaction(async tx => {
        const updated = await tx.user.update({
        where: { id: userId },
        data: { password: passwordHash },
        select: WITHOUT_PASSWORD,
        })
        await tx.refreshToken.updateMany({ where: { userId }, data: { used: true } })
        return updated
      })
    }
    // eslint-disable-next-line no-unused-vars
    const { password: _password, ...data } = userData
    return this.prisma.$transaction(async tx => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: data,
      select: WITHOUT_PASSWORD,
    })
    if (data.role !== undefined) await tx.refreshToken.updateMany({ where: { userId }, data: { used: true } })
    return updated
    })
  }

  async getPassedProblems(userId: number, sortBy: 'id' | 'solvedDate', viewer?: { id: number; role: string }) {
    await assertActivityReadable(this.prisma, userId, viewer)
    const isAdminUser = viewer?.role === 'admin'
    const submissions = await this.prisma.submission.findMany({
      where: {
        userId,
        user: activityOwnerFilter(viewer),
        status: 'accept',
        problem: { area: 'otog', ...(!isAdminUser ? { show: true } : {}) },
        ...(!isAdminUser && viewer?.id !== userId ? {
          OR: [{ contestId: null }, { contest: contestResultsFilter() }],
        } : {}),
      },
      select: {
        id: true,
        creationDate: true,
        problem: {
          select: {
            id: true,
            name: true,
            sname: true,
            score: true,
            show: true,
          },
        },
      },
    })

    const problemMap = new Map<number, {
      id: number
      name: string
      sname: string | null
      score: number
      show: boolean
      solvedDate: Date
      submissionId: number
    }>()

    for (const sub of submissions) {
      const p = sub.problem
      const existing = problemMap.get(p.id)
      if (!existing || sub.creationDate > existing.solvedDate) {
        problemMap.set(p.id, {
          id: p.id,
          name: p.name,
          sname: p.sname,
          score: p.score,
          show: p.show,
          solvedDate: sub.creationDate,
          submissionId: sub.id,
        })
      }
    }

    const passedProblems = Array.from(problemMap.values())

    if (sortBy === 'id') {
      passedProblems.sort((a, b) => a.id - b.id)
    } else {
      passedProblems.sort((a, b) => b.solvedDate.getTime() - a.solvedDate.getTime())
    }

    return passedProblems
  }
}
