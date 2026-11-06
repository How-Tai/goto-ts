// One request owned by one mounted page. Never shared across tabs or users.
export class PageRequestOverlap<T> {
  private candidate?: { key: string; token: string; abort: AbortController; result: Promise<T | null> }

  start(key: string, token: string, load: (signal: AbortSignal) => Promise<T>) {
    if (this.candidate?.key === key && this.candidate.token === token) return
    this.cancel()
    const abort = new AbortController()
    const result = Promise.resolve().then(() => load(abort.signal)).catch(() => null)
    this.candidate = { key, token, abort, result }
  }

  async take(key: string, sessionToken: string | undefined, currentToken: () => string | null) {
    const candidate = this.candidate
    if (!candidate || candidate.key !== key || !sessionToken
        || candidate.token !== sessionToken || currentToken() !== sessionToken) {
      this.cancel()
      return null
    }
    try {
      const value = await candidate.result
      return this.candidate === candidate && !candidate.abort.signal.aborted
        && currentToken() === sessionToken ? value : null
    } finally {
      if (this.candidate === candidate) this.candidate = undefined
    }
  }

  cancel() {
    this.candidate?.abort.abort()
    this.candidate = undefined
  }
}
