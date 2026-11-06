// Queue admission never changes the amount of work or its security parameters.
export class BoundedWorkQueue {
  private active = 0
  private waiting: Array<() => void> = []

  constructor(
    private readonly concurrency: number,
    private readonly maximumWaiting: number,
    private readonly maximumWaitMs: number,
    private readonly busy: () => Error
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maximumWaiting) throw this.busy()
      await new Promise<void>((resolve, reject) => {
        const admit = () => { clearTimeout(timer); resolve() }
        const timer = setTimeout(() => {
          const index = this.waiting.indexOf(admit)
          if (index !== -1) this.waiting.splice(index, 1)
          reject(this.busy())
        }, this.maximumWaitMs)
        this.waiting.push(admit)
      })
    } else this.active++
    try {
      return await work()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }
}
