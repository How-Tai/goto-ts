// Collapse bursts of identical reads without retaining failed or invalidated reads.
export class ShortLivedCache<T> {
  private cached: { until: number; value: T } | undefined
  private pending: Promise<T> | undefined
  private generation = 0

  constructor(private readonly lifetimeMs = 1000, private readonly now = Date.now) {}

  clear() {
    this.generation++
    this.cached = undefined
    this.pending = undefined
  }

  get(load: () => Promise<T>): Promise<T> {
    if (this.cached && this.cached.until > this.now()) return Promise.resolve(this.cached.value)
    if (this.pending) return this.pending
    const generation = this.generation
    const pending = Promise.resolve().then(load).then(value => {
      if (generation === this.generation) this.cached = { until: this.now() + this.lifetimeMs, value }
      return value
    }).finally(() => { if (this.pending === pending) this.pending = undefined })
    this.pending = pending
    return pending
  }
}
