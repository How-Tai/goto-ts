import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { request } from 'node:http'
import { PrismaService } from '../../core/database/prisma.service'
import { GradingService } from './grading.service'

const targets = [
  { name: 'otog-grader-1', service: 'grader' },
  { name: 'otog-grader2-1', service: 'grader2' },
  { name: 'otog-grader3-1', service: 'grader3' },
  { name: 'otog-grader4-1', service: 'grader4' },
  { name: 'otog-grader5-1', service: 'grader5' },
  { name: 'otog-grader6-1', service: 'grader6' },
  { name: 'otog-grader7-1', service: 'grader7' },
] as const

const graderImages = new Set(['otog-grader', 'otog-grader:glibc-20261012', 'otog-grader:security-20261016', 'otog-grader:cve-20261025'])

type Container = { Id: string; Config: { Image: string; Env: string[]; Labels: Record<string, string> } }
type WorkerSnapshot = { startedAt: string; submissionId: number | null }

@Injectable()
export class WorkerControlService {
  private readonly logger = new Logger(WorkerControlService.name)
  private readonly busy = new Set<number>()
  private readonly cooldown = new Map<number, number>()

  constructor(private readonly prisma: PrismaService, private readonly grading: GradingService) {}

  async kill(workerId: number, expected: WorkerSnapshot, administratorId: number) {
    const target = targets[workerId - 1]
    if (!target) throw new ConflictException('Worker is not configured.')
    if (this.busy.has(workerId) || (this.cooldown.get(workerId) ?? 0) > Date.now()) {
      throw new ConflictException('This worker is restarting. Refresh before trying again.')
    }
    this.busy.add(workerId)
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Freeze new claims while checking the exact worker/job shown in the
        // confirmation. Results already committing may still finish normally.
        const rows = await tx.$queryRaw<{ startedAt: Date | null }[]>`
          SELECT "startedAt" FROM "otogWorkerState"
          WHERE "workerId"=${workerId} FOR UPDATE`
        // A separate statement gets a fresh snapshot after any claim that
        // held this row lock has committed; a joined query could see its old job.
        const jobs = await tx.$queryRaw<{ submissionId: number }[]>`
          SELECT "submissionId" FROM "otogWorkerJob" WHERE "workerId"=${workerId}`
        const submissionId = jobs[0]?.submissionId ?? null
        const state = rows[0]
        if (!state?.startedAt || state.startedAt.getTime() !== Date.parse(expected.startedAt)
          || submissionId !== expected.submissionId) {
          throw new ConflictException('The worker or current job changed. Refresh and confirm again.')
        }
        const container = JSON.parse(await this.dockerRequest('GET', `/v1.44/containers/${target.name}/json`, 3000)) as Container
        if (!/^[a-f0-9]{64}$/.test(container.Id)
          || !graderImages.has(container.Config?.Image)
          || container.Config.Labels?.['com.docker.compose.project'] !== 'otog'
          || container.Config.Labels?.['com.docker.compose.service'] !== target.service
          || !container.Config.Env?.includes(`OTOG_WORKER_ID=${workerId}`)) {
          throw new ServiceUnavailableException('Worker container identity could not be verified.')
        }
        this.cooldown.set(workerId, Date.now() + 15000)
        // Kill the entire container, including contestant/checker children,
        // and explicitly restart it. Its exclusive DB lock then recovers only
        // its own unfinished lease. Pause state and finished scores survive.
        await this.dockerRequest('POST', `/v1.44/containers/${container.Id}/restart?t=0&signal=SIGKILL`, 10000)
        this.grading.invalidate()
        this.logger.warn(JSON.stringify({ action: 'kill-and-restart-worker', administratorId,
          workerId, submissionId }))
        return { workerId, restarted: true, submissionId }
      }, { maxWait: 2000, timeout: 18000 })
    } catch (error) {
      if (error instanceof ConflictException || error instanceof ServiceUnavailableException) throw error
      this.logger.error(`Worker ${workerId} restart failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      throw new ServiceUnavailableException('Could not verify the worker restart. Refresh its status before retrying.')
    } finally {
      this.busy.delete(workerId)
      this.grading.invalidate()
    }
  }

  private dockerRequest(method: 'GET' | 'POST', path: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: '/run/otog-worker-control/control.sock', method, path }, (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 256 * 1024) req.destroy(new Error('Unexpected Docker response size'))
          else chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          if (response.statusCode !== 200 && response.statusCode !== 204) reject(new Error(`Docker HTTP ${response.statusCode}`))
          else resolve(Buffer.concat(chunks).toString('utf8'))
        })
      })
      const timer = setTimeout(() => req.destroy(new Error('Docker request timed out')), timeout)
      req.once('close', () => clearTimeout(timer))
      req.once('error', reject)
      req.end()
    })
  }
}
