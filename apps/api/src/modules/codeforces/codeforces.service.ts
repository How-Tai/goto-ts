import { canReadActivity } from '../../utils/activity-visibility'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { createReadStream } from 'node:fs'
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
import type { z } from 'zod'

import { CfContestSettings, CfProblemSettings, cfPoints } from '@otog/contract'
import { CfHackForm, CfSubmitForm } from '@otog/contract'
import { Prisma } from '@otog/database'

import { PrismaService } from '../../core/database/prisma.service'
import { ShortLivedCache } from '../../utils/short-lived-cache'

type Viewer = { id: number; role: string }
type Tx = Prisma.TransactionClient
const running = (c: any) =>
  c.phase === 'scheduled' &&
  new Date(c.now).getTime() >= new Date(c.timeStart).getTime() &&
  new Date(c.now).getTime() < new Date(c.timeEnd).getTime()
const hash = (v: string) => createHash('sha256').update(v).digest('hex')
const accepted = (v: any) => v?.verdict === 'accepted'
const active = (s: string) => s === 'waiting' || s === 'grading'

@Injectable()
export class CodeforcesService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private coordinating = false
  private snapshotBusy = false
  private readonly boards = new Map<string, ShortLivedCache<any>>()
  constructor(private readonly db: PrismaService) {}
  onModuleInit() {
    this.timer = setInterval(
      () =>
        void this.coordinate().catch((e) =>
          console.error('CF coordinator:', e?.message)
        ),
      5000
    )
    this.timer.unref()
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }
  private async lock(tx: Tx, id: number) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(140131,${id}::int)`
    const [c] = await tx.$queryRaw<
      any[]
    >`SELECT C.*,F.phase,F.settings,clock_timestamp() AS now FROM contest C JOIN "cfContest" F ON F."contestId"=C.id WHERE C.id=${id}`
    if (!c) throw new NotFoundException()
    return c
  }
  private assertRunning(c: any) {
    if (!running(c))
      throw new ConflictException(
        'This action is only available during the contest.'
      )
  }
  private async member(tx: Tx, id: number, user: Viewer) {
    if (
      !(await tx.userContest.findUnique({
        where: { userId_contestId: { userId: user.id, contestId: id } },
      }))
    )
      throw new ForbiddenException('Register for this contest first.')
  }
  private async problem(tx: Tx, id: number, problemId: number) {
    const [p] = await tx.$queryRaw<
      any[]
    >`SELECT F.*,P.name,P."timeLimit",P."memoryLimit",P."attachmentMetadata" FROM "cfProblem" F JOIN problem P ON P.id=F."problemId" WHERE F."contestId"=${id} AND F."problemId"=${problemId}`
    if (!p) throw new NotFoundException('Problem not found in this contest.')
    return p
  }
  private async capacity(tx: Tx, userId: number) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(140014,1)`
    const [v] = await tx.$queryRaw<
      any[]
    >`SELECT count(*)::int AS total,count(*) FILTER(WHERE "userId"=${userId})::int AS mine FROM submission WHERE status IN ('waiting','grading')`
    if (v.total >= 5000 || v.mine >= 200)
      throw new ConflictException('กรุณารอสักครู่แล้วลองใหม่')
  }
  private async queue(
    tx: Tx,
    userId: number,
    p: any,
    kind: string,
    phase: string,
    sourceCode: string,
    language: string,
    requestId: string,
    extra: any = {}
  ) {
    await this.capacity(tx, userId)
    const s = await tx.submission.create({
      data: {
        userId,
        problemId: p.problemId,
        contestId: p.contestId,
        sourceCode,
        language,
        status: 'waiting',
      },
    })
    const plan = JSON.stringify({
      bundle: p.bundle,
      config: p.config,
      timeLimit: p.timeLimit,
      memoryLimit: p.memoryLimit,
      ...extra,
    })
    await tx.$executeRaw`INSERT INTO "cfRun"("submissionId","cfProblemId",kind,phase,plan,"requestId") VALUES(${s.id},${p.id},${kind},${phase},${plan}::jsonb,${requestId})`
    await tx.$executeRaw`SELECT pg_notify('otog_queue_wakeup','codeforces')`
    return { id: s.id }
  }
  async list(admin = false) {
    return this.db.$queryRaw<
      any[]
    >`SELECT C.id,C.name,C."timeStart",C."timeEnd",F.phase FROM contest C JOIN "cfContest" F ON F."contestId"=C.id WHERE (${admin} OR F.phase<>'draft') ORDER BY C."timeStart" DESC LIMIT 200`
  }
  async create(settings: CfContestSettings) {
    if (Date.parse(settings.timeStart) <= Date.now())
      throw new BadRequestException(
        'Create a contest with a future start time.'
      )
    return this.db.$transaction(async (tx) => {
      const c = await tx.contest.create({
        data: {
          name: settings.name,
          timeStart: settings.timeStart,
          timeEnd: settings.timeEnd,
          mode: 'unrated',
          gradingMode: 'classic',
          scoreboardPolicy: 'AFTER_CONTEST',
        },
      })
      await tx.$executeRaw`INSERT INTO "cfContest"("contestId",settings) VALUES(${c.id},${JSON.stringify(settings)}::jsonb)`
      return { id: c.id }
    })
  }
  async detail(id: number, user?: Viewer, admin = false) {
    const [c] = await this.db.$queryRaw<
      any[]
    >`SELECT C.id,C.name,C."timeStart",C."timeEnd",F.phase,F.settings,clock_timestamp() AS now FROM contest C JOIN "cfContest" F ON F."contestId"=C.id WHERE C.id=${id}`
    if (!c || (c.phase === 'draft' && !admin)) throw new NotFoundException()
    const visible =
      admin || (c.phase !== 'draft' && new Date(c.now) >= new Date(c.timeStart))
    const rows = !visible
      ? []
      : admin
        ? await this.db.$queryRaw<
            any[]
          >`SELECT F.*,P.name,P."timeLimit",P."memoryLimit",P."attachmentMetadata" FROM "cfProblem" F JOIN problem P ON P.id=F."problemId" WHERE F."contestId"=${id} ORDER BY F.letter`
        : await this.db.$queryRaw<
            any[]
          >`SELECT F.id,F."problemId",F.letter,F.points,P.name,P."attachmentMetadata",(F.config->>'timeLimit')::int AS "timeLimit",(F.config->>'memoryLimit')::int AS "memoryLimit",F.config->>'taskType' AS "taskType" FROM "cfProblem" F JOIN problem P ON P.id=F."problemId" WHERE F."contestId"=${id} ORDER BY F.letter`
    const locks = user
      ? await this.db.$queryRaw<
          any[]
        >`SELECT L."cfProblemId" FROM "cfLock" L JOIN "cfProblem" P ON P.id=L."cfProblemId" WHERE L."userId"=${user.id} AND P."contestId"=${id}`
      : []
    return {
      ...c,
      registered:
        !!user &&
        !!(await this.db.userContest.findUnique({
          where: { userId_contestId: { userId: user.id, contestId: id } },
        })),
      problems: rows.map((p) =>
        admin
          ? p
          : {
              problemId: p.problemId,
              letter: p.letter,
              name: p.name,
              points: p.points,
              timeLimit: p.timeLimit,
              memoryLimit: p.memoryLimit,
              taskType: p.taskType || 'batch',
              hasAttachment: !!p.attachmentMetadata,
              locked: locks.some((l) => l.cfProblemId === p.id),
            }
      ),
    }
  }
  async settings(id: number, settings: CfContestSettings) {
    return this.db.$transaction(async (tx) => {
      const c = await this.lock(tx, id)
      if (c.phase !== 'draft' || Date.parse(settings.timeStart) <= Date.now())
        throw new ConflictException(
          'Only future draft schedules and scoring settings can be changed.'
        )
      await tx.contest.update({
        where: { id },
        data: {
          name: settings.name,
          timeStart: settings.timeStart,
          timeEnd: settings.timeEnd,
        },
      })
      await tx.$executeRaw`UPDATE "cfContest" SET settings=${JSON.stringify(settings)}::jsonb,"updatedAt"=now() WHERE "contestId"=${id}`
      return { saved: true }
    })
  }
  async register(id: number, user: Viewer) {
    return this.db.$transaction(async (tx) => {
      const c = await this.lock(tx, id)
      if (c.phase !== 'scheduled' || new Date(c.now) >= new Date(c.timeEnd))
        throw new ConflictException('Registration is closed.')
      await tx.userContest.upsert({
        where: { userId_contestId: { userId: user.id, contestId: id } },
        create: { userId: user.id, contestId: id },
        update: {},
      })
      return { registered: true }
    })
  }
  private async snapshot(problemId: number, cfg: CfProblemSettings) {
    if (this.snapshotBusy)
      throw new ConflictException('กรุณารอสักครู่แล้วลองใหม่')
    this.snapshotBusy = true
    try {
      return await this.snapshotData(problemId, cfg)
    } finally {
      this.snapshotBusy = false
    }
  }
  private async snapshotData(problemId: number, cfg: CfProblemSettings) {
    const base = resolve('source', String(problemId)),
      bundle = randomUUID().replaceAll('-', ''),
      root = resolve('source/.codeforces'),
      dest = join(root, bundle)
    await mkdir(root, { recursive: true, mode: 0o750 })
    const disk = await statfs(root)
    if (Number(disk.bavail) * Number(disk.bsize) < 3 * 1024 ** 3)
      throw new ConflictException(
        'Insufficient disk space for a testcase snapshot.'
      )
    await mkdir(dest, { mode: 0o750 })
    let total = 0
    const manifest: Record<string, string> = {}
    try {
      const names = await readdir(base).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT')
            throw new BadRequestException(
              'Upload the CF problem testcase ZIP before validating its contest bundle.'
            )
          throw error
        }
      )
      if (names.includes('interactive_script.py'))
        throw new BadRequestException(
          'This CF format currently supports batch problems; interactive protocols need a separate hack validator.'
        )
      const selected = new Set(
        cfg.fullTests.flatMap((n) => [`${n}.in`, `${n}.sol`])
      )
      const permitted = names.filter(
        (n) =>
          selected.has(n) ||
          (/^[A-Za-z0-9_-]+\.(?:h|hpp|c|cpp|py)$/.test(n) &&
            ![
              'check.cpp',
              'thaco.cpp',
              'partial.cpp',
              'validator.cpp',
              'reference.cpp',
            ].includes(n))
      )
      for (const n of selected)
        if (!names.includes(n))
          throw new BadRequestException(`Missing testcase file: ${n}`)
      for (const n of cfg.graderFiles ?? [])
        if (!permitted.includes(n))
          throw new BadRequestException(`Missing library grader: ${n}`)
      for (const n of permitted) {
        const s = await lstat(join(base, n))
        if (!s.isFile() || s.isSymbolicLink())
          throw new BadRequestException(
            'Testcase bundles must contain regular files.'
          )
        total += s.size
        if (
          total > 2 * 1024 ** 3 ||
          (!selected.has(n) && s.size > 8 * 1024 ** 2)
        )
          throw new BadRequestException('Testcase bundle is too large.')
        await copyFile(join(base, n), join(dest, n), constants.COPYFILE_EXCL)
        const digest = createHash('sha256')
        for await (const chunk of createReadStream(join(dest, n)))
          digest.update(chunk)
        manifest[n] = digest.digest('hex')
      }
      const vendor = process.env.OTOG_CF_TESTLIB
      if (!manifest['testlib.h'] && vendor) {
        const header = await readFile(vendor)
        if (header.length > 2 * 1024 ** 2)
          throw new BadRequestException('Invalid configured testlib header.')
        await writeFile(join(dest, 'testlib.h'), header, { mode: 0o640 })
        manifest['testlib.h'] = createHash('sha256')
          .update(header)
          .digest('hex')
      }
      await writeFile(join(dest, 'manifest.json'), JSON.stringify(manifest), {
        mode: 0o640,
      })
      return bundle
    } catch (e) {
      await rm(dest, { recursive: true, force: true })
      throw e
    }
  }
  async saveProblem(id: number, cfg: CfProblemSettings, user: Viewer) {
    const current = await this.detail(id, user, true)
    if (current.phase !== 'draft')
      throw new ConflictException('Published problem bundles are immutable.')
    const original = await this.db.problem.findUnique({
      where: { id: cfg.problemId, area: 'codeforces' },
    })
    if (!original)
      throw new NotFoundException(
        'Choose a CF problem ID. Import the OTOG problem into the CF problem set first.'
      )
    if (
      original.memoryLimit < 1 ||
      original.memoryLimit > 1024 ||
      original.timeLimit < 1
    )
      throw new BadRequestException(
        'CF batch problems need a positive time limit and 1–1024 MiB memory limit.'
      )
    const bundle = await this.snapshot(cfg.problemId, cfg)
    try {
      return await this.db.$transaction(
        async (tx) => {
          const c = await this.lock(tx, id)
          if (c.phase !== 'draft')
            throw new ConflictException(
              'Contest was published while preparing the bundle.'
            )
          const [pending] = await tx.$queryRaw<
            any[]
          >`SELECT 1 FROM "cfRun" R JOIN "cfProblem" P ON P.id=R."cfProblemId" JOIN submission S ON S.id=R."submissionId" WHERE P."contestId"=${id} AND P."problemId"=${cfg.problemId} AND S.status IN ('waiting','grading') LIMIT 1`
          if (pending)
            throw new ConflictException(
              'Wait for the current validation jobs to finish.'
            )
          const [taken] = await tx.$queryRaw<
            any[]
          >`SELECT 1 FROM "cfProblem" WHERE "contestId"=${id} AND letter=${cfg.letter} AND "problemId"<>${cfg.problemId}`
          if (taken)
            throw new ConflictException(
              'That problem letter is already used in this contest.'
            )
          const config = JSON.stringify({
            ...cfg,
            timeLimit: original.timeLimit,
            memoryLimit: original.memoryLimit,
          })
          await tx.$executeRaw`INSERT INTO "cfProblem"("contestId","problemId",letter,points,bundle,config) VALUES(${id},${cfg.problemId},${cfg.letter},${cfg.points},${bundle},${config}::jsonb) ON CONFLICT("contestId","problemId") DO UPDATE SET letter=excluded.letter,points=excluded.points,bundle=excluded.bundle,config=excluded.config,validation='pending'`
          await tx.contestProblem.upsert({
            where: {
              contestId_problemId: { contestId: id, problemId: cfg.problemId },
            },
            create: { contestId: id, problemId: cfg.problemId },
            update: {},
          })
          const p = await this.problem(tx, id, cfg.problemId)
          const validator = await this.queue(
            tx,
            user.id,
            p,
            'validator',
            'validation',
            cfg.validatorSource,
            'cpp',
            randomUUID()
          )
          const reference = await this.queue(
            tx,
            user.id,
            p,
            'reference',
            'validation',
            cfg.referenceSource,
            'cpp',
            randomUUID()
          )
          return { bundle, validator, reference }
        },
        { timeout: 15000 }
      )
    } catch (e) {
      await rm(resolve('source/.codeforces', bundle), {
        recursive: true,
        force: true,
      })
      throw e
    }
  }
  async publish(id: number) {
    return this.db.$transaction(async (tx) => {
      const c = await this.lock(tx, id)
      if (c.phase !== 'draft' || new Date(c.now) >= new Date(c.timeStart))
        throw new ConflictException(
          'Only future draft contests can be published.'
        )
      const problems = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "cfProblem" WHERE "contestId"=${id}`
      if (!problems.length || problems.some((p) => p.validation !== 'valid'))
        throw new ConflictException(
          'Every problem needs a passing validator and reference run before publishing.'
        )
      await tx.$executeRaw`UPDATE "cfContest" SET phase='scheduled',"updatedAt"=now() WHERE "contestId"=${id}`
      return { published: true }
    })
  }
  async cancel(id: number) {
    return this.db.$transaction(async (tx) => {
      const c = await this.lock(tx, id)
      if (['draft', 'final', 'cancelled'].includes(c.phase))
        throw new ConflictException(
          'Only a published, unfinished contest can be cancelled.'
        )
      await tx.$executeRaw`UPDATE "cfContest" SET phase='cancelled',"updatedAt"=now() WHERE "contestId"=${id}`
      return { cancelled: true }
    })
  }
  async submit(id: number, data: z.infer<typeof CfSubmitForm>, user: Viewer) {
    return this.db.$transaction(async (tx) => {
      const c = await this.lock(tx, id),
        requestId = `${user.id}:${data.requestId}`,
        fingerprint = hash(JSON.stringify(data))
      const [old] = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "cfRun" WHERE "requestId"=${requestId}`
      if (old) {
        if (old.plan.fingerprint !== fingerprint)
          throw new ConflictException('Request ID was already used.')
        return { id: old.submissionId }
      }
      this.assertRunning(c)
      await this.member(tx, id, user)
      const p = await this.problem(tx, id, data.problemId)
      if (p.config.taskType === 'library' && data.language !== 'cpp')
        throw new BadRequestException('Library tasks require GNU C++17.')
      const [locked] = await tx.$queryRaw<
        any[]
      >`SELECT 1 FROM "cfLock" WHERE "cfProblemId"=${p.id} AND "userId"=${user.id}`
      if (locked)
        throw new ConflictException(
          'This problem is locked. You can no longer submit solutions to it.'
        )
      return this.queue(
        tx,
        user.id,
        p,
        'contest',
        'pretest',
        data.sourceCode,
        data.language,
        requestId,
        { fingerprint }
      )
    })
  }
  async practice(
    problemId: number,
    data: z.infer<typeof CfSubmitForm>,
    user: Viewer
  ) {
    return this.db.$transaction(async (tx) => {
      const [p] = await tx.$queryRaw<
        any[]
      >`SELECT F.*,P."timeLimit",P."memoryLimit" FROM "cfProblem" F JOIN problem P ON P.id=F."problemId" JOIN "cfContest" C ON C."contestId"=F."contestId" WHERE P.id=${problemId} AND P.area='codeforces' AND P.show AND C.phase='final' AND F.validation='valid' ORDER BY F.id DESC LIMIT 1`
      if (!p)
        throw new NotFoundException(
          'Practice opens after this problem has a validated, finalized contest bundle and is released to the problem set.'
        )
      await this.lock(tx, p.contestId)
      if (p.config.taskType === 'library' && data.language !== 'cpp')
        throw new BadRequestException('Library tasks require GNU C++17.')
      const requestId = `${user.id}:${data.requestId}`,
        fingerprint = hash(JSON.stringify({ ...data, problemId }))
      const [old] = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "cfRun" WHERE "requestId"=${requestId}`
      if (old) {
        if (old.kind !== 'practice' || old.plan.fingerprint !== fingerprint)
          throw new ConflictException('Request ID was already used.')
        return { id: old.submissionId }
      }
      return this.queue(
        tx,
        user.id,
        { ...p, contestId: null },
        'practice',
        'system',
        data.sourceCode,
        data.language,
        requestId,
        { fingerprint }
      )
    })
  }

  async practiceSubmissions(problemId: number, user: Viewer) {
    return this.db.$queryRaw<
      any[]
    >`SELECT S.id,S.status,S.language,S."creationDate",R.kind,R.phase,R.outcome FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" WHERE R.kind='practice' AND S."problemId"=${problemId} AND S."userId"=${user.id} ORDER BY S.id DESC LIMIT 50`
  }

  async lockProblem(id: number, problemId: number, user: Viewer) {
    return this.db.$transaction(async (tx) => {
      const c = await this.lock(tx, id)
      this.assertRunning(c)
      await this.member(tx, id, user)
      const p = await this.problem(tx, id, problemId)
      const runs = await tx.$queryRaw<
        any[]
      >`SELECT R.*,S.status FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" WHERE R."cfProblemId"=${p.id} AND R.kind='contest' AND S."userId"=${user.id} ORDER BY S.id DESC`
      const passed = runs.find((r) => r.verified)
      const [hacked] = passed
        ? await tx.$queryRaw<
            any[]
          >`SELECT 1 FROM "cfHack" WHERE "targetId"=${passed.submissionId} AND state='successful' LIMIT 1`
        : []
      if (
        !passed ||
        !accepted(passed.preOutcome) ||
        hacked ||
        runs.some((r) => active(r.status))
      )
        throw new ConflictException(
          'Pass pretests and wait for your pending submissions before locking.'
        )
      await tx.$executeRaw`INSERT INTO "cfLock"("cfProblemId","userId") VALUES(${p.id},${user.id}) ON CONFLICT DO NOTHING`
      return { locked: true }
    })
  }
  async hack(id: number, data: z.infer<typeof CfHackForm>, user: Viewer) {
    return this.db.$transaction(async (tx) => {
      const c = await this.lock(tx, id),
        requestId = `${user.id}:${data.requestId}`,
        fingerprint = hash(JSON.stringify(data))
      const [old] = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "cfRun" WHERE "requestId"=${requestId}`
      if (old) {
        if (old.plan.fingerprint !== fingerprint)
          throw new ConflictException('Request ID was already used.')
        return { id: old.submissionId }
      }
      this.assertRunning(c)
      await this.member(tx, id, user)
      const [target] = await tx.$queryRaw<
        any[]
      >`SELECT R.*,S."userId",S.language,S."sourceCode",S.status FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE R."submissionId"=${data.targetId} AND R.kind='contest' AND P."contestId"=${id} AND (${user.role === 'admin'} OR EXISTS(SELECT 1 FROM "user" U WHERE U.id=S."userId" AND U.role<>'admin'))`
      if (
        !target ||
        target.userId === user.id ||
        !accepted(target.preOutcome) ||
        target.outcome?.verdict === 'hacked' ||
        active(target.status)
      )
        throw new BadRequestException(
          'Choose another participant’s current pretest-passing solution.'
        )
      const p = await this.problem(tx, id, target.plan.config.problemId)
      await this.assertHackAccess(tx, p.id, user.id)
      const [latest] = await tx.$queryRaw<
        any[]
      >`SELECT R."submissionId" FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" WHERE R."cfProblemId"=${p.id} AND R.kind='contest' AND S."userId"=${target.userId} AND R.verified ORDER BY S.id DESC LIMIT 1`
      if (latest?.submissionId !== data.targetId)
        throw new ConflictException(
          'That solution has been superseded. Refresh and choose the participant’s current solution.'
        )
      const [load] = await tx.$queryRaw<
        any[]
      >`SELECT count(*) FILTER(WHERE H.state='pending')::int AS pending,count(*) FILTER(WHERE H.state='successful')::int AS successful,count(*) FILTER(WHERE H.state='pending' AND S."userId"=${user.id})::int AS mine,coalesce(sum(octet_length(H.input)+coalesce(octet_length(H.answer),0)) FILTER(WHERE H.state='successful'),0)::float8 AS bytes FROM "cfHack" H JOIN "cfRun" R ON R."submissionId"=H."submissionId" JOIN submission S ON S.id=H."submissionId" WHERE R."cfProblemId"=${p.id}`
      if (
        load.pending >= 20 ||
        load.mine >= 3 ||
        load.successful + load.pending >= 1000 ||
        load.bytes + (load.pending + 1) * 5 * 1024 ** 2 > 256 * 1024 ** 2
      )
        throw new ConflictException('กรุณารอสักครู่แล้วลองใหม่')
      const [duplicate] = await tx.$queryRaw<
        any[]
      >`SELECT 1 FROM "cfHack" H JOIN "cfRun" R ON R."submissionId"=H."submissionId" WHERE R."cfProblemId"=${p.id} AND H."targetId"=${data.targetId} AND H."inputDigest"=${hash(data.input)} AND H.state IN ('pending','successful') LIMIT 1`
      if (duplicate)
        throw new ConflictException(
          'This counterexample is already pending or successful.'
        )
      const result = await this.queue(
        tx,
        user.id,
        p,
        'hack',
        'hack',
        target.sourceCode,
        target.language,
        requestId,
        { fingerprint, targetId: data.targetId, targetUserId: target.userId }
      )
      await tx.$executeRaw`INSERT INTO "cfHack"("submissionId","targetId",input,"inputDigest") VALUES(${result.id},${data.targetId},${data.input},${hash(data.input)})`
      return result
    })
  }
  private async assertHackAccess(tx: Tx, cfProblemId: number, userId: number) {
    const [lock] = await tx.$queryRaw<
      any[]
    >`SELECT 1 FROM "cfLock" WHERE "cfProblemId"=${cfProblemId} AND "userId"=${userId}`
    if (!lock)
      throw new ForbiddenException(
        'Pass pretests and lock this problem before viewing or hacking solutions.'
      )
  }
  async source(id: number, submissionId: number, user: Viewer) {
    const [r] = await this.db.$queryRaw<
      any[]
    >`SELECT R.*,S."sourceCode",S."userId",P."contestId",U.role AS "ownerRole" FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "user" U ON U.id=S."userId" JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE R."submissionId"=${submissionId} AND R.kind='contest' AND P."contestId"=${id}`
    if (!r || !canReadActivity({ id: r.userId, role: r.ownerRole }, user)) throw new NotFoundException()
    const c = await this.detail(id, user, user.role === 'admin')
    if (user.role !== 'admin' && r.userId !== user.id && c.phase !== 'final') {
      this.assertRunning(c)
      await this.member(this.db, id, user)
      await this.assertHackAccess(this.db, r.cfProblemId, user.id)
      if (!accepted(r.preOutcome)) throw new ForbiddenException()
    }
    const compilerLog =
      user.id === r.userId || user.role === 'admin'
        ? (
            await this.db.submissionResult.findUnique({
              where: { submissionId },
              select: { errmsg: true },
            })
          )?.errmsg
        : null
    return { sourceCode: r.sourceCode, compilerLog }
  }
  async job(id: number, submissionId: number) {
    const [job] = await this.db.$queryRaw<
      any[]
    >`SELECT R.kind,R.phase,R.outcome,S.status,V.errmsg FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "cfProblem" P ON P.id=R."cfProblemId" LEFT JOIN "submissionResult" V ON V."submissionId"=S.id WHERE P."contestId"=${id} AND S.id=${submissionId}`
    if (!job) throw new NotFoundException()
    return job
  }
  async submissions(id: number, user: Viewer, admin = false) {
    admin = user.role === 'admin'
    const c = await this.detail(id, user, admin)
    if (new Date(c.now) < new Date(c.timeStart) && !admin) return []
    return this.db.$queryRaw<
      any[]
    >`SELECT S.id,S."userId",U."showName",S.language,S.status,S."creationDate",P.letter,P."problemId",R.kind,R.phase,R.outcome,R."preOutcome",H."targetId",H.state AS "hackState" FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "user" U ON U.id=S."userId" JOIN "cfProblem" P ON P.id=R."cfProblemId" LEFT JOIN "cfHack" H ON H."submissionId"=S.id LEFT JOIN submission T ON T.id=H."targetId" LEFT JOIN "user" V ON V.id=T."userId" WHERE P."contestId"=${id} AND (${admin} OR R.kind IN ('contest','hack')) AND (${admin} OR U.role<>'admin' OR S."userId"=${user.id}) AND (${admin} OR V.role IS NULL OR V.role<>'admin' OR T."userId"=${user.id}) ORDER BY S.id DESC LIMIT 300`
  }
  async standings(id: number, user?: Viewer) {
    const c = await this.detail(id, user, user?.role === 'admin')
    // Authorize before accessing a shared result. Separate pre-start admin
    // visibility so a cached draft/problem list never reaches participants.
    const key = `${id}:${c.phase}:${c.problems.length > 0}`
    if (!this.boards.has(key)) {
      if (this.boards.size >= 64)
        this.boards.delete(this.boards.keys().next().value!)
      this.boards.set(key, new ShortLivedCache(1000))
    }
    return this.boards.get(key)!.get(() => this.buildStandings(id, c))
  }
  private async buildStandings(id: number, c: any) {
    const rows = await this.db.$queryRaw<
      any[]
    >`SELECT S.id,S."userId",U."showName",S.status,S."creationDate",P.letter,P.points,R.kind,R.phase,R.outcome,R."preOutcome",R.verified,H.state AS "hackState",EXISTS(SELECT 1 FROM "cfHack" X WHERE X."targetId"=S.id AND X.state='successful') AS hacked FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "user" U ON U.id=S."userId" JOIN "cfProblem" P ON P.id=R."cfProblemId" LEFT JOIN "cfHack" H ON H."submissionId"=S.id WHERE P."contestId"=${id} AND R.kind IN ('contest','hack') AND U.role='user' ORDER BY S.id`
    const members = await this.db.userContest.findMany({
      where: { contestId: id, user: { role: 'user' } },
      select: { userId: true, user: { select: { showName: true } } },
    })
    const board = members
      .map((m) => {
        const mine = rows.filter((r) => r.userId === m.userId),
          problems: any[] = []
        for (const p of c.problems) {
          const all = mine.filter(
              (r) => r.kind === 'contest' && r.letter === p.letter
            ),
            selected = all.filter((r) => r.verified).at(-1)
          const attempts = selected
            ? all.filter(
                (r) =>
                  r.id < selected.id &&
                  !active(r.status) &&
                  r.preOutcome?.verdict !== 'compile_error' &&
                  r.preOutcome?.verdict !== 'judge_error' &&
                  !(
                    (r.preOutcome?.failedTestIndex ??
                      r.preOutcome?.failedTest) === 1 && !accepted(r.preOutcome)
                  )
              ).length
            : 0
          const minutes = selected
            ? (new Date(selected.creationDate).getTime() -
                new Date(c.timeStart).getTime()) /
              60000
            : 0
          const passed =
            selected &&
            accepted(selected.preOutcome) &&
            !selected.hacked &&
            (c.phase !== 'final' ||
              (selected.phase === 'system' && accepted(selected.outcome)))
          problems.push({
            letter: p.letter,
            submissionId: selected?.id ?? null,
            points: passed
              ? cfPoints(p.points, minutes, attempts, c.settings)
              : 0,
            minutes,
            attempts,
            pending: all.some((r) => active(r.status)),
            hacked: !!selected?.hacked,
          })
        }
        const successful = mine.filter(
            (r) => r.kind === 'hack' && r.hackState === 'successful'
          ).length,
          unsuccessful = mine.filter(
            (r) => r.kind === 'hack' && r.hackState === 'unsuccessful'
          ).length
        return {
          userId: m.userId,
          showName: m.user.showName,
          problems,
          successfulHacks: successful,
          unsuccessfulHacks: unsuccessful,
          total:
            problems.reduce((sum, p) => sum + p.points, 0) +
            successful * c.settings.successfulHackPoints -
            unsuccessful * c.settings.unsuccessfulHackPenalty,
          tieTime: Math.max(
            0,
            ...problems.filter((p) => p.points > 0).map((p) => p.minutes)
          ),
        }
      })
      .sort((a, b) => b.total - a.total || a.userId - b.userId)
    let rank = 0
    return {
      phase: c.phase,
      rows: board.map((r, i) => {
        if (!i || r.total !== board[i - 1]!.total) rank = i + 1
        return { ...r, rank }
      }),
    }
  }
  async retry(id: number, submissionId: number) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx, id)
      const [r] = await tx.$queryRaw<
        any[]
      >`SELECT R.*,S.status FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE P."contestId"=${id} AND S.id=${submissionId} FOR UPDATE OF S`
      if (!r || r.status !== 'judgeError')
        throw new ConflictException(
          'Only infrastructure-failed jobs can be retried here.'
        )
      await tx.$executeRaw`DELETE FROM "submissionResult" WHERE "submissionId"=${submissionId}`
      await tx.$executeRaw`DELETE FROM "otogWorkerAttempt" WHERE "submissionId"=${submissionId}`
      await tx.$executeRaw`UPDATE "cfRun" SET outcome=NULL WHERE "submissionId"=${submissionId}`
      await tx.$executeRaw`UPDATE submission SET status='waiting',"updateDate"=now() WHERE id=${submissionId}`
      await tx.$executeRaw`SELECT pg_notify('otog_queue_wakeup','cf-retry')`
      return { queued: true }
    })
  }
  async coordinate() {
    if (this.coordinating) return
    this.coordinating = true
    try {
      const contests = await this.db.$queryRaw<
        any[]
      >`SELECT F."contestId" FROM "cfContest" F JOIN contest C ON C.id=F."contestId" WHERE F.phase IN ('scheduled','system_pending','system_testing') AND C."timeEnd"<=now() LIMIT 20`
      for (const { contestId: id } of contests)
        await this.db.$transaction(
          async (tx) => {
            const c = await this.lock(tx, id)
            if (c.phase === 'final') return
            const [pending] = await tx.$queryRaw<
              any[]
            >`SELECT 1 FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE P."contestId"=${id} AND S.status IN ('waiting','grading') LIMIT 1`
            if (pending) {
              if (c.phase === 'scheduled')
                await tx.$executeRaw`UPDATE "cfContest" SET phase='system_pending' WHERE "contestId"=${id}`
              return
            }
            const [error] = await tx.$queryRaw<
              any[]
            >`SELECT 1 FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE P."contestId"=${id} AND R.kind IN ('contest','hack') AND S.status='judgeError' LIMIT 1`
            if (error) return
            if (c.phase === 'system_testing') {
              await tx.$executeRaw`UPDATE "cfContest" SET phase='final',"updatedAt"=now() WHERE "contestId"=${id}`
              return
            }
            const selected = await tx.$queryRaw<
              any[]
            >`SELECT DISTINCT ON(S."userId",R."cfProblemId") S.id FROM "cfRun" R JOIN submission S ON S.id=R."submissionId" JOIN "cfProblem" P ON P.id=R."cfProblemId" WHERE P."contestId"=${id} AND R.kind='contest' AND R.verified ORDER BY S."userId",R."cfProblemId",S.id DESC`
            for (const { id: submissionId } of selected) {
              const [hacked] = await tx.$queryRaw<
                any[]
              >`SELECT 1 FROM "cfHack" WHERE "targetId"=${submissionId} AND state='successful' LIMIT 1`
              if (hacked) {
                await tx.$executeRaw`UPDATE "cfRun" SET phase='system',outcome=jsonb_build_object('verdict','hacked') WHERE "submissionId"=${submissionId}`
                continue
              }
              await tx.$executeRaw`DELETE FROM "submissionResult" WHERE "submissionId"=${submissionId}`
              await tx.$executeRaw`DELETE FROM "otogWorkerAttempt" WHERE "submissionId"=${submissionId}`
              await tx.$executeRaw`UPDATE "cfRun" SET phase='system',outcome=NULL WHERE "submissionId"=${submissionId}`
              await tx.$executeRaw`UPDATE submission SET status='waiting',"updateDate"=now() WHERE id=${submissionId}`
            }
            await tx.$executeRaw`UPDATE "cfContest" SET phase='system_testing',"updatedAt"=now() WHERE "contestId"=${id}`
            await tx.$executeRaw`SELECT pg_notify('otog_queue_wakeup','cf-system-testing')`
          },
          { timeout: 20000 }
        )
    } finally {
      this.coordinating = false
    }
  }
}
