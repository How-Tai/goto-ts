import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { constants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

import { Prisma } from '@otog/database'

import { PrismaService } from '../../core/database/prisma.service'
import { LocalFileManager, S3FileManager } from '../../core/fileManager'
import { environment } from '../../env'
import { statementFiles } from '../../utils/problem-statement'
import { updateProblemDoc, updateProblemTestCase } from '../../utils/file.util'
import type { UploadedFilesObject } from '../problem/dto/problem.dto'

export type CfUploadedFiles = UploadedFilesObject & {
  attachment?: Express.Multer.File[]
}

export const CatalogForm = z
  .object({
    name: z.string().trim().min(1).max(255),
    sname: z.string().trim().max(255).default(''),
    score: z.coerce.number().int().min(1).max(100000).default(100),
    timeLimit: z.coerce.number().int().min(1).max(600000),
    memoryLimit: z.coerce.number().int().min(1).max(1024),
    case: z
      .string()
      .regex(/^[0-9,\s-]*$/)
      .max(255)
      .default(''),
  })
  .strict()
type Viewer = { id: number; role: string } | undefined

// Files remain in the judge's existing numeric-ID storage. The area is an
// authorization boundary, not a second pointer to an OTOG problem.
@Injectable()
export class CfCatalogService {
  private copying = false
  constructor(private readonly db: PrismaService) {}

  async list(admin = false, search = '', skip = 0) {
    const where = {
      area: 'codeforces',
      ...(!admin ? { show: true } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              ...(/^[1-9][0-9]*$/.test(search) && Number(search) <= 2147483647
                ? [{ id: Number(search) }]
                : []),
            ],
          }
        : {}),
    }
    const [data, total] = await Promise.all([
      this.db.problem.findMany({
        where,
        skip,
        take: 50,
        orderBy: { id: 'desc' },
        select: {
          id: true,
          name: true,
          sname: true,
          show: true,
          timeLimit: true,
          memoryLimit: true,
          score: true,
          case: true,
        },
      }),
      this.db.problem.count({ where }),
    ])
    return { data, total }
  }

  async get(id: number, user?: Viewer) {
    const p = await this.db.problem.findFirst({
      where: {
        id,
        area: 'codeforces',
        ...(user?.role === 'admin' ? {} : { show: true }),
      },
      select: {
        id: true,
        name: true,
        sname: true,
        score: true,
        show: true,
        timeLimit: true,
        memoryLimit: true,
        case: true,
        examples: true,
        attachmentMetadata: true,
      },
    })
    if (!p) throw new NotFoundException()
    const [bundle] = await this.db.$queryRaw<
      any[]
    >`SELECT F.config->>'taskType' AS "taskType" FROM "cfProblem" F JOIN "cfContest" C ON C."contestId"=F."contestId" WHERE F."problemId"=${id} AND F.validation='valid' AND C.phase='final' ORDER BY F.id DESC LIMIT 1`
    return {
      ...p,
      canPractice: p.show && !!bundle,
      taskType: bundle?.taskType ?? 'batch',
    }
  }

  async assertStatement(id: number, user?: Viewer, contestId?: number) {
    const p = await this.db.problem.findFirst({
      where: { id, area: 'codeforces' },
      select: { show: true },
    })
    if (!p) throw new NotFoundException()
    if (user?.role === 'admin' || p.show) return
    if (contestId) {
      const [c] = await this.db.$queryRaw<
        any[]
      >`SELECT 1 FROM "cfProblem" P JOIN "cfContest" F ON F."contestId"=P."contestId" JOIN contest C ON C.id=F."contestId" WHERE P."problemId"=${id} AND P."contestId"=${contestId} AND F.phase NOT IN ('draft','cancelled') AND C."timeStart"<=now()`
      if (c) return
    }
    throw new NotFoundException()
  }

  async create(data: z.infer<typeof CatalogForm>) {
    return this.db.problem.create({
      data: { ...data, area: 'codeforces', show: false },
    })
  }

  async update(id: number, data: z.infer<typeof CatalogForm>) {
    return this.db.problem.update({ where: { id, area: 'codeforces' }, data })
  }

  async visibility(id: number, show: boolean) {
    // Publishing a private statement used by an upcoming/running contest must
    // not accidentally bypass its time gate through the public problem set.
    if (show) {
      const [blocked] = await this.db.$queryRaw<
        any[]
      >`SELECT 1 FROM "cfProblem" P JOIN "cfContest" F ON F."contestId"=P."contestId" WHERE P."problemId"=${id} AND F.phase NOT IN ('final','cancelled') LIMIT 1`
      if (blocked)
        throw new ConflictException(
          'Finish or cancel contests using this problem before releasing it to the public problem set.'
        )
    }
    return this.db.problem.update({
      where: { id, area: 'codeforces' },
      data: { show, recentShowTime: new Date() },
    })
  }

  async files(id: number, files: CfUploadedFiles) {
    const local = new LocalFileManager()
    try {
      await this.get(id, { id: 0, role: 'admin' })
      if (files?.pdf?.[0])
        await updateProblemDoc(String(id), files.pdf[0].path, local)
      for (const [field, language] of [['pdfTh', 'th'], ['pdfEn', 'en']] as const) {
        if (files?.[field]?.[0]) await updateProblemDoc(String(id), files[field]![0].path, local, language)
      }
      if (files?.zip?.[0])
        await updateProblemTestCase(String(id), files.zip[0].path, local)
      const attachment = files?.attachment?.[0]
      if (attachment) {
        if (
          attachment.size > 16 * 1024 ** 2 ||
          !attachment.originalname.toLowerCase().endsWith('.zip')
        )
          throw new BadRequestException(
            'Starter files must be a ZIP no larger than 16 MiB.'
          )
        await new S3FileManager(environment.S3_BUCKET).putFile(
          `attachment/${id}.zip`,
          await readFile(attachment.path),
          { ContentType: 'application/zip' }
        )
        await this.db.problem.update({
          where: { id, area: 'codeforces' },
          data: {
            attachmentMetadata: {
              name: attachment.originalname,
              size: attachment.size,
              type: 'application/zip',
              lastModified: Date.now(),
            },
          },
        })
      }
      return { saved: true }
    } catch (e) {
      if (e instanceof HttpException) throw e
      throw new BadRequestException(
        'Upload a valid PDF statement and testcase ZIP.'
      )
    } finally {
      for (const f of [
        ...(files?.pdf ?? []),
        ...(files?.pdfTh ?? []),
        ...(files?.pdfEn ?? []),
        ...(files?.zip ?? []),
        ...(files?.attachment ?? []),
      ])
        await rm(f.path, { force: true })
    }
  }

  async copy(id: number, destination: 'otog' | 'codeforces') {
    if (this.copying) throw new ConflictException('กรุณารอสักครู่แล้วลองใหม่')
    this.copying = true
    let created: number | undefined
    try {
      const original = await this.db.problem.findFirst({
        where: { id, area: destination === 'otog' ? 'codeforces' : 'otog' },
      })
      if (!original) throw new NotFoundException()
      if (destination === 'codeforces') {
        try {
          await lstat(resolve('source', String(id), 'interactive_script.py'))
          throw new BadRequestException(
            'CF import supports batch and library tasks; interactive tasks need a separate protocol.'
          )
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        }
      }
      const p = await this.db.problem.create({
        data: {
          area: destination,
          name: original.name,
          sname: original.sname,
          score: original.score,
          timeLimit: original.timeLimit,
          memoryLimit: original.memoryLimit,
          case: original.case,
          rating: original.rating,
          examples: original.examples ?? Prisma.DbNull,
          show: false,
        },
      })
      created = p.id
      await copyProblemFiles(id, p.id)
      if (destination === 'otog') {
        const [cf] = await this.db.$queryRaw<
          any[]
        >`SELECT id,bundle,config FROM "cfProblem" WHERE "problemId"=${id} AND validation='valid' ORDER BY id DESC LIMIT 1`
        if (cf) await this.exportTests(p.id, cf)
        if (cf?.config.checkerSource)
          await writeFile(
            resolve('source', String(p.id), 'check.cpp'),
            cf.config.checkerSource
          )
        if (cf?.config.taskType === 'library') {
          const names = cf.config.graderFiles as string[]
          if (
            !names.length ||
            names.some((n) => !/^[A-Za-z0-9_-]+\.(?:cpp|c)$/.test(n))
          )
            throw new BadRequestException(
              'Invalid library grader configuration.'
            )
          await writeFile(
            resolve('source', String(p.id), 'command.yaml'),
            JSON.stringify({
              cpp: {
                compile:
                  '/usr/bin/g++ -std=gnu++17 -O2 -pipe -I/box [sourcePath] ' +
                  names.map((n) => '/box/' + n).join(' ') +
                  ' -o [binPath]',
              },
            })
          )
        }
      }
      // Attachments are copied as objects too, not aliased by presigned URL.
      if (original.attachmentMetadata) {
        await new S3FileManager(environment.S3_BUCKET).copyObject(
          `attachment/${id}.zip`,
          `attachment/${p.id}.zip`
        )
        await this.db.problem.update({
          where: { id: p.id },
          data: { attachmentMetadata: original.attachmentMetadata },
        })
      }
      const rules = await this.db.problemKeywordRules.findUnique({
        where: { problemId: id },
      })
      if (rules)
        await this.db.problemKeywordRules.create({
          data: {
            problemId: p.id,
            requiredKeywords: rules.requiredKeywords,
            bannedKeywords: rules.bannedKeywords,
          },
        })
      return { id: p.id, importedFrom: id, area: destination, show: false }
    } catch (e) {
      if (created !== undefined) {
        await this.db.problem.delete({ where: { id: created } })
        await rm(resolve('source', String(created)), {
          recursive: true,
          force: true,
        })
        for (const file of statementFiles(created)) await rm(resolve(file), { force: true })
      }
      throw e
    } finally {
      this.copying = false
    }
  }

  async migrateLegacy() {
    const originals = await this.db.problem.findMany({
      where: { area: 'otog', cfProblems: { some: {} } },
      select: { id: true },
    })
    const migrated: Array<{ from: number; to: number }> = []
    for (const old of originals) {
      const copy = await this.copy(old.id, 'codeforces')
      try {
        await this.db.$transaction(
          async (tx) => {
            const problems = await tx.cfProblem.findMany({
              where: { problemId: old.id },
              orderBy: { contestId: 'asc' },
            })
            for (const contestId of [
              ...new Set(problems.map((p) => p.contestId)),
            ])
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(140131,${contestId}::int)`
            const ids = problems.map((p) => p.id)
            const current = await tx.cfProblem.count({
              where: { id: { in: ids }, problemId: old.id },
            })
            if (!ids.length || current !== ids.length)
              throw new ConflictException(
                'Another catalog migration changed these links; retry.'
              )
            const [busy] = await tx.$queryRaw<
              any[]
            >`SELECT 1 FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" WHERE R."cfProblemId"=ANY(${ids}::int[]) AND S.status IN ('waiting','grading') LIMIT 1`
            if (busy)
              throw new ConflictException(
                'Wait for CF jobs to finish before migrating existing links.'
              )
            await tx.$executeRaw`UPDATE submission S SET "problemId"=${copy.id} FROM "cfRun" R WHERE R."submissionId"=S.id AND R."cfProblemId"=ANY(${ids}::int[])`
            await tx.$executeRaw`UPDATE "cfRun" SET plan=jsonb_set(plan,'{config,problemId}',to_jsonb(${copy.id}::int)) WHERE "cfProblemId"=ANY(${ids}::int[])`
            await tx.$executeRaw`UPDATE "cfProblem" SET "problemId"=${copy.id},config=jsonb_set(config,'{problemId}',to_jsonb(${copy.id}::int)) WHERE id=ANY(${ids}::int[])`
            for (const contestId of [
              ...new Set(problems.map((p) => p.contestId)),
            ]) {
              await tx.contestProblem.deleteMany({
                where: { contestId, problemId: old.id },
              })
              await tx.contestProblem.create({
                data: { contestId, problemId: copy.id },
              })
            }
          },
          { timeout: 15000 }
        )
      } catch (e) {
        await this.db.problem.delete({ where: { id: copy.id } })
        await rm(resolve('source', String(copy.id)), {
          recursive: true,
          force: true,
        })
        for (const file of statementFiles(copy.id)) await rm(resolve(file), { force: true })
        throw e
      }
      migrated.push({ from: old.id, to: copy.id })
    }
    return { migrated }
  }

  private async exportTests(id: number, cf: any) {
    if (!/^[a-f0-9]{32}$/.test(cf.bundle))
      throw new BadRequestException('Invalid CF bundle.')
    const source = resolve('source/.codeforces', cf.bundle),
      target = resolve('source', String(id))
    const info = await lstat(source)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new BadRequestException('CF bundle is unavailable.')
    for (const name of await readdir(target))
      if (
        /^[0-9]+\.(?:in|sol)$/.test(name) ||
        ['check.cpp', 'thaco.cpp', 'partial.cpp', 'command.yaml'].includes(name)
      )
        await rm(join(target, name))
    let total = 0,
      number = 0
    const disk = await statfs(target),
      budget = Math.min(
        2 * 1024 ** 3,
        Number(disk.bavail) * Number(disk.bsize) - 3 * 1024 ** 3
      )
    async function copy(name: string, destination: string) {
      const s = await lstat(join(source, name))
      total += s.size
      if (!s.isFile() || s.isSymbolicLink() || total > budget)
        throw new BadRequestException(
          'CF export exceeds its allowance or contains an invalid file.'
        )
      await copyFile(join(source, name), join(target, destination))
    }
    for (const name of await readdir(source))
      if (/^[A-Za-z0-9_-]+\.(?:h|hpp|c|cpp|py)$/.test(name))
        await copy(name, name)
    const tests = cf.config.fullTests as number[]
    if (
      !Array.isArray(tests) ||
      !tests.length ||
      tests.length > 1000 ||
      tests.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 2147483647)
    )
      throw new BadRequestException('Invalid full test list.')
    for (const test of tests) {
      number++
      await copy(`${test}.in`, `${number}.in`)
      await copy(`${test}.sol`, `${number}.sol`)
    }
    const hacks = await this.db.$queryRaw<
      Array<{ input: string; answer: string }>
    >`SELECT H.input,H.answer FROM "cfHack" H JOIN "cfRun" R ON R."submissionId"=H."submissionId" WHERE R."cfProblemId"=${cf.id} AND H.state='successful' AND H.answer IS NOT NULL ORDER BY H."submissionId" LIMIT 10001`
    for (const h of hacks) {
      total += Buffer.byteLength(h.input) + Buffer.byteLength(h.answer)
      if (++number > 10000 || total > budget)
        throw new BadRequestException(
          'CF system tests exceed the export allowance.'
        )
      await writeFile(join(target, number + '.in'), h.input)
      await writeFile(join(target, number + '.sol'), h.answer)
    }
    await this.db.problem.update({
      where: { id },
      data: {
        case: String(number),
        timeLimit: cf.config.timeLimit,
        memoryLimit: cf.config.memoryLimit,
      },
    })
  }
}

export async function copyProblemFiles(from: number, to: number) {
  if (
    !Number.isSafeInteger(from) ||
    from < 1 ||
    !Number.isSafeInteger(to) ||
    to < 1 ||
    from === to
  )
    throw new Error('Invalid copy IDs')
  const base = resolve('source'),
    target = join(base, String(to))
  await mkdir(base, { recursive: true })
  const disk = await statfs(base)
  const budget = Math.min(
    2 * 1024 ** 3,
    Number(disk.bavail) * Number(disk.bsize) - 3 * 1024 ** 3
  )
  if (budget <= 0)
    throw new ConflictException(
      'Insufficient disk space to import this problem.'
    )
  let count = 0,
    bytes = 0
  async function copy(source: string, dest: string) {
    const info = await lstat(source)
    if (++count > 10000 || info.isSymbolicLink())
      throw new BadRequestException(
        'Problem import contains links or too many files.'
      )
    if (info.isDirectory()) {
      await mkdir(dest)
      for (const name of await readdir(source))
        await copy(join(source, name), join(dest, name))
    } else if (info.isFile()) {
      bytes += info.size
      if (bytes > budget)
        throw new BadRequestException(
          'Problem import exceeds its disk allowance.'
        )
      await copyFile(source, dest, constants.COPYFILE_EXCL)
    } else
      throw new BadRequestException('Problem imports require regular files.')
  }
  const original = join(base, String(from))
  const exists = await lstat(original).then(
    () => true,
    (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw e
    }
  )
  if (exists) await copy(original, target)
  else await mkdir(target)
  await mkdir(resolve('docs'), { recursive: true })
  const originals = statementFiles(from), targets = statementFiles(to)
  for (let i = 0; i < originals.length; i++) {
    try { await copy(resolve(originals[i]!), resolve(targets[i]!)) } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
  }
}
