import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../core/database/prisma.service'
import { compilationProblemIds } from './compilation-status'
import { resourceHistoryDelta } from './resource-history'

export function resourceFreshness(telemetry: unknown, now = Date.now()) {
  const shape = telemetry as { machine?: { cpuCount?: unknown; memoryTotalMb?: unknown }; history?: unknown; services?: unknown } | null
  if (!shape || typeof shape !== 'object' || !Number.isInteger(shape.machine?.cpuCount) ||
    Number(shape.machine?.cpuCount) < 1 || typeof shape.machine?.memoryTotalMb !== 'number' ||
    !Number.isFinite(shape.machine.memoryTotalMb) || shape.machine.memoryTotalMb <= 0 ||
    !Array.isArray(shape.history) || shape.history.length === 0 || !Array.isArray(shape.services)) {
    return { state: 'unavailable' as const, sampledAt: null, ageMs: null }
  }
  const sampledAt = telemetry && typeof telemetry === 'object' && 'observedAt' in telemetry &&
    typeof telemetry.observedAt === 'string' ? telemetry.observedAt : null
  const sampled = sampledAt ? Date.parse(sampledAt) : NaN
  if (!Number.isFinite(sampled) || sampled > now + 1000) {
    return { state: 'unavailable' as const, sampledAt: null, ageMs: null }
  }
  const ageMs = Math.max(0, now - sampled)
  return { state: ageMs >= 20000 ? 'stale' as const : 'fresh' as const, sampledAt, ageMs }
}

@Injectable()
export class GradingService {
  private cached: { until: number; value: unknown } | undefined
  private pending: Promise<unknown> | undefined
  private generation = 0

  constructor(private readonly prisma: PrismaService) {}

  invalidate() {
    this.generation++
    this.cached = undefined
    this.pending = undefined
  }

  status(after?: number): Promise<unknown> {
    if (this.cached && this.cached.until > Date.now()) return Promise.resolve(this.withFreshResources(this.cached.value, after))
    if (this.pending) return this.pending.then(value => this.withFreshResources(value, after))
    const generation = this.generation
    const pending = this.readStatus().then((value) => {
      if (generation === this.generation) this.cached = { until: Date.now() + 500, value }
      return value
    }).finally(() => { if (this.pending === pending) this.pending = undefined })
    this.pending = pending
    return pending.then(value => this.withFreshResources(value, after))
  }

  private withFreshResources(snapshot: unknown, after?: number) {
    const data = snapshot as { telemetry: { history: Array<{ monotonicSeconds?: number }> } }
    const resourceStatus = resourceFreshness(data.telemetry)
    return { ...data, telemetry: resourceStatus.state === 'fresh' ? resourceHistoryDelta(data.telemetry, after) : null, resourceStatus }
  }

  async setEnabled(workerId: number, enabled: boolean) {
    // claim() locks this same row before leasing: pause either precedes a claim,
    // or takes effect after that already-claimed job. It never kills that job.
    const rows = await this.prisma.$transaction(async tx => {
      const allocation = await tx.$queryRaw<{ count: number; revision: number; appliedRevision: number }[]>`
        SELECT count,revision,"appliedRevision" FROM "otogGraderAllocation" WHERE id=1 FOR SHARE`
      const current = allocation[0]
      if (!current || current.revision !== current.appliedRevision || (enabled && workerId > current.count)) {
        throw new ConflictException('Wait for CPU allocation to finish, or increase the active grader count first.')
      }
      return tx.$queryRaw<{ workerId: number; enabled: boolean }[]>`
        UPDATE "otogWorkerState" SET enabled=${enabled},"updatedAt"=NOW()
        WHERE "workerId"=${workerId} RETURNING "workerId",enabled`
    })
    if (!rows.length) throw new NotFoundException('Worker is not configured.')
    this.invalidate()
    return rows[0]
  }

  async setWorkerCount(count: number) {
    const allocation = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "otogGraderAllocation" WHERE id=1 FOR UPDATE`
      // Lock in order, using the same rows as claim(). Current leases finish;
      // later claims observe the complete new selection after this commits.
      const configured = await tx.$queryRaw<{ workerId: number }[]>`
        SELECT "workerId" FROM "otogWorkerState"
        WHERE "workerId" BETWEEN 1 AND 7 ORDER BY "workerId" FOR UPDATE`
      if (configured.length !== 7) throw new ConflictException('Seven graders are not configured. Refresh and try again.')
      // Only the host allocator enables additional workers, after removing
      // ordinary services from their CPUs. Excess workers stop claiming now.
      await tx.$executeRaw`
        UPDATE "otogWorkerState" SET enabled=false,"updatedAt"=NOW()
        WHERE "workerId">${count} AND "workerId"<=7 AND enabled`
      const rows = await tx.$queryRaw<{ count: number; revision: number; appliedRevision: number }[]>`
        UPDATE "otogGraderAllocation" SET count=${count},revision=revision+1,"updatedAt"=NOW()
        WHERE id=1 RETURNING count,revision,"appliedRevision"`
      if (!rows[0]) throw new ConflictException('CPU allocation is not configured.')
      return rows[0]
    })
    this.invalidate()
    // A hint only: durable requests are retried even after a missed wake-up.
    void fetch('http://127.0.0.1:8766/wake', { method: 'POST', signal: AbortSignal.timeout(500) }).catch(() => {})
    return { ...allocation, pending: true }
  }

  async setMaxWorkersPerUser(maxWorkersPerUser: number) {
    const rows = await this.prisma.$queryRaw<{ maxWorkersPerUser: number }[]>`
      UPDATE "otogGradingSettings" SET "maxWorkersPerUser"=${maxWorkersPerUser},"updatedAt"=NOW()
      WHERE id=1 RETURNING "maxWorkersPerUser"`
    if (!rows.length) throw new NotFoundException('Grading settings are not configured.')
    this.invalidate()
    return rows[0]
  }

  async setMemoryReservations(enabled: boolean) {
    // Same lock order as claim(): finish each admission before changing policy.
    const rows = await this.prisma.$queryRaw<{ memoryReservationsEnabled: boolean }[]>`
      WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(140014,1))
      UPDATE "otogGradingSettings" SET "memoryReservationsEnabled"=${enabled},"updatedAt"=NOW()
      FROM locked WHERE id=1 RETURNING "memoryReservationsEnabled"`
    if (!rows.length) throw new NotFoundException('Grading settings are not configured.')
    this.invalidate()
    return rows[0]
  }

  async setMaxCompilerJobs(maxCompilerJobs: number) {
    const rows = await this.prisma.$queryRaw<{ maxCompilerJobs: number }[]>`
      WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(140014,1))
      UPDATE "otogGradingSettings" SET "maxCompilerJobs"=${maxCompilerJobs},"updatedAt"=NOW()
      FROM locked WHERE id=1 RETURNING "maxCompilerJobs"`
    if (!rows.length) throw new NotFoundException('Grading settings are not configured.')
    this.invalidate()
    return rows[0]
  }

  private async readStatus() {
    // The six independent graders have no separate compiler slots. Avoid
    // rescanning every problem directory for a pipeline that is not configured.
    const configured = await this.prisma.$queryRaw<Array<{ configured: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM "otogCompilerState") AS configured`
    const eligible = configured[0]?.configured ? await compilationProblemIds() : []
    const [rows, telemetry, cpuAllocation] = await Promise.all([
      this.prisma.$queryRaw<{ data: Record<string, unknown> }[]>`
        WITH queued AS (
          SELECT S.id,S."userId",S."problemId",S.language,S."queuedAt",S."creationDate",
            CASE WHEN A.state='ready' THEN 'ready'
              WHEN A.state='bypass' THEN 'direct'
              WHEN NOT ${eligible !== null} THEN 'unknown'
              WHEN S.language IN ('c','cpp') AND S."problemId"=ANY(${eligible ?? []}::integer[]) THEN 'compile'
              ELSE 'direct' END AS stage
          FROM submission S LEFT JOIN "otogCompiledArtifact" A ON A."submissionId"=S.id
          WHERE S.status='waiting'
        )
        SELECT json_build_object(
          'observedAt',statement_timestamp(),
          'waiting', (SELECT COUNT(*)::integer FROM submission WHERE status='waiting'),
          'grading', (SELECT COUNT(*)::integer FROM submission S WHERE S.status='grading'
            AND NOT EXISTS (SELECT 1 FROM "otogWorkerJob" J JOIN "otogCompilerState" CS USING ("workerId") WHERE J."submissionId"=S.id)),
          'compilation', json_build_object(
            'waiting', CASE WHEN ${eligible !== null} THEN (SELECT COUNT(*)::integer FROM queued WHERE stage='compile') ELSE NULL END,
            'compiling', (SELECT COUNT(*)::integer FROM "otogWorkerJob" J JOIN "otogCompilerState" CS USING ("workerId")),
            'ready', (SELECT COUNT(*)::integer FROM queued WHERE stage='ready'),
            'directWaiting', CASE WHEN ${eligible !== null} THEN (SELECT COUNT(*)::integer FROM queued WHERE stage='direct') ELSE NULL END,
            'pausedForGraders', NOT EXISTS (SELECT 1 FROM "otogWorkerState" WHERE enabled),
            'slots', COALESCE((SELECT json_agg(C ORDER BY C.id) FROM (
              SELECT CS."workerId" AS id,CS.enabled,CS."cpuId",CS."startedAt",CS."lastHeartbeat",
                COALESCE(CS."lastHeartbeat">NOW()-INTERVAL '20 seconds',false)
                AND EXISTS (SELECT 1 FROM pg_locks L WHERE L.locktype='advisory' AND L.granted
                  AND L.classid=140011 AND L.objid=CS."workerId"::oid AND L.objsubid=2
                  AND L.database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS connected,
                J."submissionId",J."claimedAt",S."userId",S."problemId",P.name AS "problemName"
              FROM "otogCompilerState" CS LEFT JOIN "otogWorkerJob" J ON J."workerId"=CS."workerId"
              LEFT JOIN submission S ON S.id=J."submissionId" LEFT JOIN problem P ON P.id=S."problemId"
            ) C),'[]'::json)
          ),
          'memoryReservationsEnabled',(SELECT "memoryReservationsEnabled" FROM "otogGradingSettings" WHERE id=1),
          'maxCompilerJobs',(SELECT "maxCompilerJobs" FROM "otogGradingSettings" WHERE id=1),
          'queueLimit',100,
          'maxWorkersPerUser',(SELECT "maxWorkersPerUser" FROM "otogGradingSettings" WHERE id=1),
          'graderAllocation',(SELECT json_build_object('count',count,'revision',revision,'appliedRevision',"appliedRevision") FROM "otogGraderAllocation" WHERE id=1),
          'queue', COALESCE((SELECT json_agg(to_jsonb(Q)-'queueOrderAt' ORDER BY Q."queueOrderAt",Q.id) FROM (
            SELECT S.id,S."userId",S."problemId",P.name AS "problemName",S.language,
              S."queuedAt",S.stage,S."creationDate" AS "queueOrderAt",
              ((SELECT COUNT(*) FROM "otogWorkerJob" J JOIN submission E ON E.id=J."submissionId" WHERE E."userId"=S."userId")
                >= (SELECT "maxWorkersPerUser" FROM "otogGradingSettings" WHERE id=1)
                OR EXISTS (SELECT 1 FROM "otogWorkerJob" J WHERE J."submissionId"=S.id)
                OR EXISTS (SELECT 1 FROM queued E WHERE E."userId"=S."userId"
                  AND (S.stage='compile' OR E.stage<>'compile')
                  AND NOT EXISTS (SELECT 1 FROM "otogWorkerJob" J WHERE J."submissionId"=E.id)
                  AND (E."creationDate",E.id)<(S."creationDate",S.id))) AS "waitingForUser"
            FROM queued S JOIN problem P ON P.id=S."problemId"
            ORDER BY S."creationDate",S.id LIMIT 100
          ) Q),'[]'::json),
          'workers', COALESCE((SELECT json_agg(W ORDER BY W.id) FROM (
            SELECT WS."workerId" AS id,WS.enabled,WS."cpuId",WS."startedAt",WS."lastHeartbeat",
              COALESCE(WS."lastHeartbeat">NOW()-INTERVAL '20 seconds',false)
              AND EXISTS (SELECT 1 FROM pg_locks L WHERE L.locktype='advisory' AND L.granted
                AND L.classid=140011 AND L.objid=WS."workerId"::oid AND L.objsubid=2
                AND L.database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS connected,
              J."submissionId",J."claimedAt",S."userId",S."problemId",P.name AS "problemName"
            FROM "otogWorkerState" WS LEFT JOIN "otogWorkerJob" J ON J."workerId"=WS."workerId"
            LEFT JOIN submission S ON S.id=J."submissionId" LEFT JOIN problem P ON P.id=S."problemId"
          ) W),'[]'::json)
        ) AS data`,
      this.readTelemetry(),
      this.readCpuAllocation(),
    ])
    const row = rows[0]
    if (!row) throw new Error('Grading status query returned no snapshot.')
    return { ...row.data, telemetry, cpuAllocation }
  }

  private async readCpuAllocation() {
    try {
      const response = await fetch('http://127.0.0.1:8766/status', { signal: AbortSignal.timeout(500) })
      if (!response.ok) return null
      return await response.json()
    } catch { return null }
  }

  private async readTelemetry() {
    try {
      // Fixed loopback endpoint; requests never execute commands or accept URLs.
      const response = await fetch('http://127.0.0.1:8765/status', { signal: AbortSignal.timeout(1500) })
      if (!response.ok) return null
      return await response.json()
    } catch { return null }
  }
}
