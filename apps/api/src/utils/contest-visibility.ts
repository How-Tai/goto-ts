import type { Prisma } from '@otog/database'

type ResultsContest = { scoreboardPolicy: string; timeStart: Date; timeEnd: Date }

export function contestResultsVisible(
  contest: ResultsContest,
  viewer: { role: string } | undefined,
  now = new Date()
) {
  return viewer?.role === 'admin' ||
    contest.scoreboardPolicy === 'DURING_CONTEST' && contest.timeStart < now ||
    contest.scoreboardPolicy === 'AFTER_CONTEST' && contest.timeEnd < now
}

export function contestResultsFilter(now = new Date()): Prisma.ContestWhereInput {
  return { OR: [
    { scoreboardPolicy: 'DURING_CONTEST', timeStart: { lt: now } },
    { scoreboardPolicy: 'AFTER_CONTEST', timeEnd: { lt: now } },
  ] }
}
