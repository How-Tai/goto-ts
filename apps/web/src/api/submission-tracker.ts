import type { SubmissionProgressSchema } from '@otog/contract'
import { backgroundDelay } from './background-schedule'

export class SubmissionTracker {
  ready = false
  onWatchChange = () => {}
  private watched = new Map<number, Set<() => void>>()
  private values = new Map<number, SubmissionProgressSchema>()
  private states = new Map<number, string>()
  private due = new Map<number, number>()
  private forcedPending = new Set<number>()
  constructor(private readonly random = Math.random) {}

  ids() { return [...this.watched.keys()].sort((a, b) => a - b) }
  get(id: number) { return this.values.get(id) }
  subscribe(id: number, initialStatus: string, callback: () => void) {
    let callbacks = this.watched.get(id)
    if (!callbacks) {
      callbacks = new Set(); this.watched.set(id, callbacks)
      this.states.set(id, initialStatus); this.due.set(id, Date.now() + backgroundDelay(0, 500, this.random))
      this.onWatchChange()
    }
    callbacks.add(callback)
    return () => {
      callbacks!.delete(callback)
      if (!callbacks!.size) {
        this.watched.delete(id); this.values.delete(id); this.states.delete(id); this.due.delete(id)
        this.forcedPending.delete(id)
        this.onWatchChange()
      }
    }
  }
  setReady(ready: boolean) {
    if (this.ready === ready) return
    this.ready = ready
    if (!ready) for (const id of this.watched.keys()) this.due.set(id, Date.now() + backgroundDelay(0, 750, this.random))
  }
  apply(rows: SubmissionProgressSchema[]) {
    for (const row of rows) {
      if (!this.watched.has(row.id)) continue
      const previous = this.values.get(row.id)
      if (previous && new Date(row.updateDate).getTime() < new Date(previous.updateDate).getTime()) continue
      if (this.forcedPending.has(row.id) && previous && !['waiting', 'grading'].includes(row.status)
          && new Date(row.updateDate).getTime() <= new Date(previous.updateDate).getTime()) continue
      this.forcedPending.delete(row.id)
      this.states.set(row.id, row.status)
      this.due.set(row.id, Date.now() + this.interval(row.status))
      if (JSON.stringify(this.values.get(row.id)) === JSON.stringify(row)) continue
      this.values.set(row.id, row)
      for (const callback of this.watched.get(row.id)!) callback()
    }
  }
  queue(id: number) {
    if (!this.watched.has(id)) return
    const previous = this.values.get(id)
    this.apply([{ id, status: 'waiting', updateDate: previous?.updateDate ?? new Date(0),
      queuedAt: previous?.queuedAt ?? new Date(0), submissionResult: null }])
    this.forcedPending.add(id)
  }
  private interval(status: string) {
    const base = status === 'grading' ? 1000 : status === 'waiting' ? 3000 : 15000
    return backgroundDelay(base, base * .15, this.random)
  }
  pending(now = Date.now()) {
    if (this.ready) return []
    const ids = this.ids().filter(id => (this.due.get(id) ?? 0) <= now)
    for (const id of ids) this.due.set(id, now + this.interval(this.states.get(id)!))
    return ids
  }
  retry(ids: number[], milliseconds = 3000) {
    for (const id of ids) if (this.watched.has(id)) this.due.set(id, Date.now() + backgroundDelay(milliseconds, milliseconds * .2, this.random))
  }
}

const trackers = new WeakMap<object, SubmissionTracker>()
export const submissionTrackerFor = (client: object) => trackers.get(client)
export function bindSubmissionTracker(client: object, tracker: SubmissionTracker) {
  trackers.set(client, tracker)
  return () => { if (trackers.get(client) === tracker) trackers.delete(client) }
}
