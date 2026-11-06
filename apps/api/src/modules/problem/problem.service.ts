import { NotFound } from '@aws-sdk/client-s3'
import { rm } from 'node:fs/promises'
import { readableProblemFilter } from '../../utils/problem-visibility'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from 'src/core/database/prisma.service'
import {
  FileManager,
  LocalFileManager,
  S3FileManager,
} from 'src/core/fileManager'
import { environment } from 'src/env'
import {
  removeProblemSource,
  updateProblemDoc,
  updateProblemTestCase,
} from 'src/utils/file.util'
import { searchId } from 'src/utils/search'

import {
  PassedUserSchema,
  ProblemFormSchema,
  ProblemTableRowSchema,
  splitKeywords,
  KeywordRules,
} from '@otog/contract'
import { Prisma, SubmissionStatus, UserRole } from '@otog/database'

import { UploadedFilesObject } from './dto/problem.dto'
import { resolveProblemStatement, StatementLanguage } from '../../utils/problem-statement'
import { ShortLivedCache } from '../../utils/short-lived-cache'

export const WITHOUT_EXAMPLE = {
  id: true,
  name: true,
  sname: true,
  score: true,
  timeLimit: true,
  memoryLimit: true,
  show: true,
  recentShowTime: true,
  case: true,
  rating: true,
}

@Injectable()
export class ProblemService {
  private fileManager: FileManager
  private attachmentManager: S3FileManager
  private readonly passedCountCaches = {
    all: new ShortLivedCache<Array<{ id: number; passedCount: number }>>(),
    visible: new ShortLivedCache<Array<{ id: number; passedCount: number }>>(),
    hidden: new ShortLivedCache<Array<{ id: number; passedCount: number }>>(),
  }

  constructor(private readonly prisma: PrismaService) {
    this.fileManager = new LocalFileManager()
    this.attachmentManager = new S3FileManager(environment.S3_BUCKET)
  }

  async getKeywordRules(problemId: number): Promise<KeywordRules> {
    const rows = await this.prisma.$queryRaw<KeywordRules[]>`SELECT "requiredKeywords", "bannedKeywords" FROM "otogProblemKeywordRules" WHERE "problemId"=${problemId}`
    return rows[0] ?? { requiredKeywords: [], bannedKeywords: [] }
  }

  async canRead(problemId: number, user?: { id: number; role: string }) {
    return !!await this.prisma.problem.findFirst({ where: { id: problemId, ...readableProblemFilter(user) }, select: { id: true } })
  }

  private async saveKeywordRules(tx: Prisma.TransactionClient, problemId: number, input: { requiredKeywords?: string; bannedKeywords?: string }) {
    if (input.requiredKeywords === undefined && input.bannedKeywords === undefined) return
    const rows = await tx.$queryRaw<KeywordRules[]>`SELECT "requiredKeywords", "bannedKeywords" FROM "otogProblemKeywordRules" WHERE "problemId"=${problemId}`
    const required = input.requiredKeywords === undefined ? rows[0]?.requiredKeywords ?? [] : splitKeywords(input.requiredKeywords)
    const banned = input.bannedKeywords === undefined ? rows[0]?.bannedKeywords ?? [] : splitKeywords(input.bannedKeywords)
    if (required.some(word => banned.includes(word))) throw new BadRequestException('A keyword cannot be both required and banned.')
    await tx.$executeRaw`INSERT INTO "otogProblemKeywordRules" ("problemId","requiredKeywords","bannedKeywords") VALUES (${problemId},${required}::text[],${banned}::text[])
      ON CONFLICT ("problemId") DO UPDATE SET "requiredKeywords"=EXCLUDED."requiredKeywords","bannedKeywords"=EXCLUDED."bannedKeywords","updatedAt"=now()`
  }

  async create(problemData: ProblemFormSchema, files: UploadedFilesObject) {
    try {
      const problem = await this.prisma.$transaction(async tx => {
      const created = await tx.problem.create({
        data: {
          name: problemData.name,
          sname: problemData.sname,
          score: problemData.score,
          timeLimit: problemData.timeLimit,
          memoryLimit: problemData.memoryLimit,
          case: problemData.case,
          show: false,
        },
        select: WITHOUT_EXAMPLE,
      })
      await this.saveKeywordRules(tx, created.id, problemData)
      return created
      })
      if (files?.pdf) {
        await updateProblemDoc(
          `${problem.id}`,
          // TODO: fix me
          files.pdf?.[0]?.path as string,
          this.fileManager
        )
      }
      for (const [field, language] of [['pdfTh', 'th'], ['pdfEn', 'en']] as const) {
        if (files?.[field]?.[0]) await updateProblemDoc(String(problem.id), files[field]![0].path, this.fileManager, language)
      }
      if (files?.zip) {
        await updateProblemTestCase(
          `${problem.id}`,
          files.zip?.[0]?.path as string,
          this.fileManager
        )
      }
      return problem
    } catch (err) {
      console.log(err)
      throw new BadRequestException()
    } finally {
      for (const file of [...(files?.pdf ?? []), ...(files?.pdfTh ?? []), ...(files?.pdfEn ?? []), ...(files?.zip ?? [])]) await rm(file.path, { force: true })
    }
  }

  async replaceByProblemId(
    problemId: number,
    problemData: ProblemFormSchema,
    files: UploadedFilesObject
  ) {
    try {
      const problem = await this.prisma.$transaction(async tx => {
      const updated = await tx.problem.update({
        data: {
          name: problemData.name,
          sname: problemData.sname,
          score: problemData.score,
          timeLimit: problemData.timeLimit,
          memoryLimit: problemData.memoryLimit,
          case: problemData.case,
        },
        where: { id: problemId, area: 'otog' },
        select: WITHOUT_EXAMPLE,
      })
      await this.saveKeywordRules(tx, updated.id, problemData)
      return updated
      })
      if (files?.pdf) {
        await updateProblemDoc(
          `${problem.id}`,
          // TODO: fix me
          files.pdf?.[0]?.path as string,
          this.fileManager
        )
      }
      for (const [field, language] of [['pdfTh', 'th'], ['pdfEn', 'en']] as const) {
        if (files?.[field]?.[0]) await updateProblemDoc(String(problem.id), files[field]![0].path, this.fileManager, language)
      }
      if (files?.zip) {
        await updateProblemTestCase(
          `${problem.id}`,
          // TODO: fix me
          files.zip[0]?.path as string,
          this.fileManager
        )
      }
      return problem
    } catch (err) {
      console.error(err)
      throw new BadRequestException()
    } finally {
      for (const file of [...(files?.pdf ?? []), ...(files?.pdfTh ?? []), ...(files?.pdfEn ?? []), ...(files?.zip ?? [])]) await rm(file.path, { force: true })
    }
  }

  async findMany(args: {
    show?: boolean
    userId?: number
  }): Promise<Array<ProblemTableRowSchema>> {
    const where = { area: 'otog', show: args.show }
    const [problems, passedCounts] = await Promise.all([
      this.prisma.problem.findMany({
        where: where,
        select: {
          id: true,
          name: true,
          sname: true,
          score: true,
          timeLimit: true,
          memoryLimit: true,
          show: true,
          recentShowTime: true,
          case: true,
          rating: true,
          submission: args.userId
            ? {
                select: {
                  id: true,
                  status: true,
                  userId: true,
                  public: true,
                },
                orderBy: { creationDate: 'desc' },
                where: { userId: args.userId },
                take: 1,
              }
            : undefined,
        },
        orderBy: { id: 'desc' },
      }),
      this.passedCountCaches[args.show === undefined ? 'all' : args.show ? 'visible' : 'hidden'].get(() =>
        this.prisma.$queryRaw<Array<{ id: number; passedCount: number }>>(Prisma.sql`
        SELECT S."problemId" AS id, COUNT(DISTINCT S."userId")::int AS "passedCount"
        FROM submission S
        JOIN "user" U ON U.id = S."userId"
        JOIN problem P ON P.id = S."problemId"
        WHERE P.area='otog' AND S.status = 'accept' AND U.role <> 'admin'
          ${args.show === undefined ? Prisma.empty : Prisma.sql`AND P.show = ${args.show}`}
        GROUP BY S."problemId"
      `)),
    ])

    const problemIdToPassedCount = new Map<number, number>()
    passedCounts.forEach((problem) => {
      problemIdToPassedCount.set(problem.id, problem.passedCount)
    })

    return problems.map((problem) => ({
      id: problem.id,
      name: problem.name,
      sname: problem.sname,
      score: problem.score,
      timeLimit: problem.timeLimit,
      memoryLimit: problem.memoryLimit,
      show: problem.show,
      recentShowTime: problem.recentShowTime,
      case: problem.case,
      rating: problem.rating,
      latestSubmission: problem.submission?.[0] ?? null,
      passedCount: problemIdToPassedCount.get(problem.id) ?? 0,
    }))
  }

  async findOneById(id: number) {
    return this.prisma.problem.findUnique({
      where: { id, area: 'otog' },
      select: WITHOUT_EXAMPLE,
    })
  }

  async findOneByIdWithExamples(id: number) {
    return this.prisma.problem.findFirst({ where: { id, area: 'otog' } })
  }

  async getProblemDocStream(problemId: number, filePath?: string) {
    const selected = filePath ?? (await resolveProblemStatement(problemId, this.fileManager)).filePath
    return this.fileManager.getFileReadStream(selected)
  }

  async getProblemDocMetadata(problemId: number, language: StatementLanguage = 'th') {
    return resolveProblemStatement(problemId, this.fileManager, language)
  }

  async changeProblemShowById(problemId: number, show: boolean) {
    return this.prisma.problem.update({
      where: { id: problemId, area: 'otog' },
      data: { show, recentShowTime: new Date() },
      select: WITHOUT_EXAMPLE,
    })
  }

  async findPassedUser(args: {
    problemId: number
  }): Promise<Array<PassedUserSchema>> {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        role: true,
        username: true,
        showName: true,
        rating: true,
        submission: {
          select: { id: true, status: true, userId: true, public: true },
          where: { status: SubmissionStatus.accept, problemId: args.problemId },
          orderBy: { creationDate: 'desc' },
          take: 1,
        },
      },
      where: {
        submission: {
          some: { problemId: args.problemId, status: SubmissionStatus.accept },
        },
        NOT: { role: UserRole.admin },
      },
      orderBy: { id: 'desc' },
    })
    return users.map(
      (user) =>
        ({
          id: user.id,
          role: user.role,
          username: user.username,
          showName: user.showName,
          rating: user.rating,
          passedSubmission: user.submission[0]!,
        }) satisfies PassedUserSchema
    )
  }

  async delete(problemId: number) {
    try {
      const problem = await this.prisma.problem.delete({
        where: { id: problemId, area: 'otog' },
        select: WITHOUT_EXAMPLE,
      })
      await removeProblemSource(`${problem.id}`, this.fileManager)
      return problem
    } catch (e) {
      console.log(e)
      throw new BadRequestException()
    }
  }

  async updateProblemExamples(problemId: number, examples: object) {
    try {
      return this.prisma.problem.update({
        data: { examples },
        where: { id: problemId, area: 'otog' },
        select: { examples: true },
      })
    } catch (e) {
      console.log(e)
      throw new BadRequestException()
    }
  }

  async getProblemsForAdmin(args: {
    skip: number
    limit: number
    search?: string
  }) {
    const problems = await this.prisma.problem.findMany({
      take: args.limit,
      skip: args.skip,
      where: { area: 'otog', AND: args.search
        ? { OR: [searchId(args.search),
          { name: { contains: args.search, mode: 'insensitive' } },
          { sname: { contains: args.search, mode: 'insensitive' } }] }
        : undefined },
      select: {
        id: true,
        name: true,
        sname: true,
        show: true,
        case: true,
        memoryLimit: true,
        timeLimit: true,
        recentShowTime: true,
        score: true,
        attachmentMetadata: true,
      },
      orderBy: { id: 'desc' },
    })
    const ids = problems.map(problem => problem.id)
    if (!ids.length) return []
    const rules = await this.prisma.$queryRaw<Array<KeywordRules & { problemId: number }>>`SELECT "problemId","requiredKeywords","bannedKeywords" FROM "otogProblemKeywordRules" WHERE "problemId"=ANY(${ids}::integer[])`
    const byId = new Map(rules.map(rule => [rule.problemId, rule]))
    return problems.map(problem => ({ ...problem, requiredKeywords: byId.get(problem.id)?.requiredKeywords ?? [], bannedKeywords: byId.get(problem.id)?.bannedKeywords ?? [] }))
  }
  async getProblemsCountForAdmin(args: { search?: string }) {
    return await this.prisma.problem.count({
      where: { area: 'otog', AND: args.search
        ? { OR: [searchId(args.search),
          { name: { contains: args.search, mode: 'insensitive' } },
          { sname: { contains: args.search, mode: 'insensitive' } }] }
        : undefined },
    })
  }

  async searchProblem(args: { skip: number; limit: number; search?: string }) {
    return await this.prisma.problem.findMany({
      take: args.limit,
      skip: args.skip,
      where: { area: 'otog', AND: args.search
        ? { OR: [searchId(args.search),
          { name: { contains: args.search, mode: 'insensitive' } },
          { sname: { contains: args.search, mode: 'insensitive' } }] }
        : undefined },
      select: {
        id: true,
        name: true,
        sname: true,
      },
      orderBy: { id: 'desc' },
    })
  }

  async uploadAttachment(args: {
    problemId: number
    body: {
      metadata: {
        type: string
        name: string
        size: number
        lastModified: number
      }
    }
  }) {
    const [url] = await Promise.all([
      this.attachmentManager.generatePutPresignedUrl(
        `attachment/${args.problemId}.zip`
      ),
      this.prisma.problem.update({
        where: { id: args.problemId, area: 'otog' },
        data: { attachmentMetadata: args.body.metadata },
      }),
    ])
    return { url }
  }

  async downloadAttachment(problemId: number) {
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId, area: 'otog' },
      select: { attachmentMetadata: true },
    })
    if (!problem || !problem.attachmentMetadata) {
      throw new NotFoundException('Attachment not found')
    }
    try {
      const url = await this.attachmentManager.generateGetPresignedUrl(
        `attachment/${problemId}.zip`
      )
      return { url, metadata: problem.attachmentMetadata as any }
    } catch (e) {
      if (e instanceof NotFound) {
        throw new NotFoundException('Attachment not found')
      }
      throw e
    }
  }
}
