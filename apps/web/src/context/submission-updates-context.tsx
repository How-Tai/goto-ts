import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { SubmissionProgressSchema } from '@otog/contract'
import { submissionQuery } from '../api/query'
import { bindSubmissionTracker, SubmissionTracker } from '../api/submission-tracker'
import { useQueryClient } from '@tanstack/react-query'
import { useSocketContext } from './socket-context'
import { useUserContext } from './user-context'
import { backgroundDelay } from '../api/background-schedule'

const Context = createContext<SubmissionTracker | null>(null)

export function SubmissionUpdatesProvider({ children }: { children: ReactNode }) {
  const { user } = useUserContext()
  // Recreate all subscriptions and snapshots when the signed-in account changes.
  return <AccountUpdates key={user?.id ?? 'anonymous'}>{children}</AccountUpdates>
}

function AccountUpdates({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext()
  const [tracker] = useState(() => new SubmissionTracker())
  const queryClient = useQueryClient()
  useEffect(() => bindSubmissionTracker(queryClient, tracker), [queryClient, tracker])
  useEffect(() => {
    let stopped = false, inflight = false, generation = 0
    let watchTimer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    const receive = (value: unknown) => {
      const result = SubmissionProgressSchema.array().max(500).safeParse(value)
      if (result.success && !stopped) tracker.apply(result.data)
    }
    const watch = () => {
      if (stopped) return
      const current = ++generation
      if (!socket?.connected) { tracker.setReady(false); return }
      const ids = tracker.ids().slice(0, 500)
      socket.timeout(5000).emit('watch-submissions', { ids }, (error: unknown, reply: { live?: boolean } | undefined) => {
        if (!stopped && current === generation) tracker.setReady(!error && reply?.live === true && tracker.ids().length <= 500)
      })
    }
    tracker.onWatchChange = () => {
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(watch, 150)
    }
    const scheduleWatch = () => {
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(watch, backgroundDelay(50, 700))
    }
    const disconnected = () => { generation++; tracker.setReady(false) }
    const availability = (ready: boolean) => { tracker.setReady(ready === true && (socket?.connected ?? false)); if (ready) scheduleWatch() }
    const visible = () => { if (document.visibilityState === 'visible') { tracker.setReady(false); scheduleWatch() } }
    socket?.on('connect', scheduleWatch)
    socket?.on('disconnect', disconnected)
    socket?.on('submission-progress', receive)
    socket?.on('submission-live', availability)
    document.addEventListener('visibilitychange', visible)
    scheduleWatch()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      timer = setTimeout(poll, backgroundDelay(250, 250))
      if (inflight || stopped || document.visibilityState === 'hidden') return
      const ids = tracker.pending()
      if (!ids.length) return
      inflight = true
      try {
        for (let offset = 0; offset < ids.length && !stopped; offset += 100) {
          const group = ids.slice(offset, offset + 100)
          const response = await submissionQuery.getSubmissionProgressBatch.query({ query: { ids: group }, fetchOptions: { signal: abort.signal } })
          if (response.status === 200) receive(response.body)
          else tracker.retry(group, response.status === 429 || response.status === 503 ? 10000 : 3000)
        }
      } catch { tracker.retry(ids, 5000) }
      finally { inflight = false }
    }
    timer = setTimeout(poll, backgroundDelay(250, 250))
    return () => {
      stopped = true; generation++; abort.abort(); clearInterval(timer)
      if (watchTimer) clearTimeout(watchTimer)
      tracker.onWatchChange = () => {}; tracker.setReady(false)
      socket?.off('connect', scheduleWatch); socket?.off('disconnect', disconnected)
      socket?.off('submission-progress', receive); socket?.off('submission-live', availability)
      document.removeEventListener('visibilitychange', visible)
      if (socket?.connected) socket.emit('watch-submissions', { ids: [] })
    }
  }, [socket, tracker])
  return <Context.Provider value={tracker}>{children}</Context.Provider>
}

export function useSubmissionProgress(id: number | undefined, status = 'waiting', enabled = true) {
  const tracker = useContext(Context)
  if (!tracker) throw new Error('SubmissionUpdatesProvider is required.')
  const initialStatus = useRef(status); initialStatus.current = status
  const subscribe = useCallback((callback: () => void) => {
    if (!id || !enabled) return () => {}
    return tracker.subscribe(id, initialStatus.current, callback)
  }, [tracker, id, enabled])
  const snapshot = useCallback(() => id ? tracker.get(id) : undefined, [tracker, id])
  return useSyncExternalStore(subscribe, snapshot, () => undefined)
}
