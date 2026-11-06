type Point = { monotonicSeconds?: number }

export function resourceHistoryDelta<T extends { history: Point[] }>(telemetry: T, after?: number) {
  const first = telemetry.history[0]?.monotonicSeconds
  const last = telemetry.history[telemetry.history.length - 1]?.monotonicSeconds
  const cursor = after ?? -1
  const delta = after !== undefined && Number.isFinite(after) &&
    typeof first === 'number' && typeof last === 'number' && after >= first && after <= last
  return {
    ...telemetry,
    historyReset: !delta,
    history: delta ? telemetry.history.filter(point => typeof point.monotonicSeconds === 'number' && point.monotonicSeconds > cursor) : telemetry.history,
  }
}
