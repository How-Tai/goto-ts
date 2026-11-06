// Positive jitter spreads background work; foreground requests never use it.
export function backgroundDelay(base: number, spread: number, random = Math.random) {
  return base + Math.floor(Math.max(0, Math.min(.999999, random())) * spread)
}

export function scheduleBackground(task: () => void, base = 100, spread = 650) {
  const timer = setTimeout(task, backgroundDelay(base, spread))
  return () => clearTimeout(timer)
}
