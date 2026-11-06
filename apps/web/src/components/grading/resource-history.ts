type Point = { monotonicSeconds?: number }
type Telemetry = { history: Point[]; historyReset?: boolean }

export function mergeResourceHistory<T extends Telemetry>(previous: T | null | undefined, next: T): T {
  const newest = next.history.at(-1)?.monotonicSeconds ?? previous?.history.at(-1)?.monotonicSeconds
  if (next.historyReset !== false || !previous || typeof newest !== 'number') return next
  const points = new Map<number, T['history'][number]>()
  for (const point of [...previous.history, ...next.history]) {
    const at = point.monotonicSeconds
    if (typeof at === 'number' && Number.isFinite(at) && at >= newest - 600) points.set(at, point)
  }
  return { ...next, history: [...points.entries()].sort(([a], [b]) => a - b).slice(-600).map(([, point]) => point) }
}
