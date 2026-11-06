import { Injectable } from '@nestjs/common'
import { readableProblemFilter, ProblemViewer } from '../../utils/problem-visibility'
import { PrismaService } from '../../core/database/prisma.service'
import { ContestService } from '../contest/contest.service'
import { SubmissionService } from './submission.service'
import { pageMetadata } from '../../utils/page-metadata-cache'

type Gate = { id: number; contestVersion: string; timeStart: Date; timeEnd: Date;
  scoreboardPolicy: string; problemId: number | null; problemVersion: string | null; show: boolean | null }

@Injectable()
export class ContestPageService {
  constructor(private readonly prisma: PrismaService,
    private readonly contests: ContestService,
    private readonly submissions: SubmissionService) {}

  async contestPage(contestId: number) {
    const rows = await this.prisma.$queryRaw<Gate[]>`SELECT id, xmin::text AS "contestVersion",
      "timeStart", "timeEnd", "scoreboardPolicy" FROM contest WHERE id=${contestId}`
    const gate = rows[0]
    if (!gate) return null
    const metadata = await pageMetadata(this.prisma, `contest:${gate.id}:${gate.contestVersion}`,
      () => this.contests.findOneById(gate.id))
    if (!metadata) return null
    return { contest: { ...metadata, timeStart: gate.timeStart, timeEnd: gate.timeEnd,
      scoreboardPolicy: gate.scoreboardPolicy as typeof metadata.scoreboardPolicy }, serverTime: new Date() }
  }

  async problemPage(contestId: number, problemId: number, viewer: ProblemViewer) {
    const rows = await this.prisma.$queryRaw<Gate[]>`SELECT c.id, c.xmin::text AS "contestVersion",
      c."timeStart", c."timeEnd", c."scoreboardPolicy", p.id AS "problemId",
      p.xmin::text AS "problemVersion", p.show FROM contest c
      LEFT JOIN "contestProblem" cp ON cp."contestId"=c.id AND cp."problemId"=${problemId}
      LEFT JOIN problem p ON p.id=cp."problemId" WHERE c.id=${contestId}`
    const gate = rows[0]
    if (!gate) return { status: 404 as const }
    if (viewer.role !== 'admin' && gate.timeStart.getTime() > Date.now()) return { status: 403 as const }
    if (!gate.problemId) return { status: 404 as const }
    // Recheck authorization before consulting the metadata cache on every request.
    const authorized = await this.prisma.problem.findFirst({ where: { id: problemId, ...readableProblemFilter(viewer) }, select: { id: true } })
    if (!authorized) return { status: 403 as const }
    const [metadata, problem, latestSubmission] = await Promise.all([
      pageMetadata(this.prisma, `contest:${gate.id}:${gate.contestVersion}`,
        () => this.contests.findOneById(gate.id)),
      pageMetadata(this.prisma, `problem:${problemId}:${gate.problemVersion}`,
        () => this.prisma.problem.findUnique({ where: { id: problemId } })),
      this.submissions.findFirstByProblemIdAndUserId(problemId, viewer.id),
    ])
    if (!metadata || !problem) return { status: 404 as const }
    return { status: 200 as const, body: {
      contest: { ...metadata, timeStart: gate.timeStart, timeEnd: gate.timeEnd,
        scoreboardPolicy: gate.scoreboardPolicy as typeof metadata.scoreboardPolicy },
      problem: { ...problem, show: gate.show! }, latestSubmission, serverTime: new Date(),
    } }
  }
}
