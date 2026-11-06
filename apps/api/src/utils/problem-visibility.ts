import type { Prisma } from '@otog/database'

export type ProblemViewer = { id: number; role: string }
export function readableProblemFilter(viewer?: ProblemViewer, now = new Date()): Prisma.ProblemWhereInput {
  if (viewer?.role === 'admin') return { area: 'otog' }
  return { area: 'otog', OR: [
    { show: true },
    ...(viewer ? [{ contestProblem: { some: { contest: { timeStart: { lte: now }, timeEnd: { gte: now } } } } }] : []),
  ] }
}
