type TimedPoint = { at: string; monotonicSeconds?: number }

export function historyTime(point: TimedPoint): number {
  return typeof point.monotonicSeconds === 'number' && Number.isFinite(point.monotonicSeconds)
    ? point.monotonicSeconds : Date.parse(point.at) / 1000
}

export function historySegments<T extends TimedPoint>(points: T[], keys: Array<keyof T>, maximumGapSeconds = 15): T[][] {
  const segments: T[][] = []
  let current: T[] = []
  for (const point of points) {
    const time = historyTime(point)
    const valid = Number.isFinite(time) && keys.every(key => typeof point[key] === 'number' && Number.isFinite(point[key]))
    const previous = current.at(-1)
    if (!valid || previous && (time <= historyTime(previous) || time - historyTime(previous) > maximumGapSeconds)) {
      if (current.length) segments.push(current)
      current = []
    }
    if (valid) current.push(point)
  }
  if (current.length) segments.push(current)
  return segments
}
