import { contestKey } from './query'

export function problemRouteId(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? String(id) : null
}

export function contestProblemPageOptions(contestId: string, problemId: string, viewerId: number) {
  const options = contestKey.getContestProblemPage({ params: { contestId, problemId } })
  return {
    ...options,
    // Personal code is never shared between signed-in identities or retained
    // after this page's last observer goes away.
    queryKey: [...options.queryKey, 'viewer', viewerId] as const,
    staleTime: 0,
    gcTime: 0,
    retry: (count: number, error: unknown) => count < 1
      && ![400, 401, 403, 404].includes((error as { status?: number })?.status ?? 0),
  }
}
