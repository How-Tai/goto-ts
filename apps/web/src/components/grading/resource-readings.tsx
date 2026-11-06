import { ReactNode, useEffect, useState } from 'react'

export type ResourceFreshness = {
  state: 'fresh' | 'stale' | 'unavailable'; sampledAt: string | null; ageMs: number | null
}

export function resourceExpiryDelay(freshness: ResourceFreshness, elapsedMs: number, requestDurationMs: number) {
  if (freshness.state !== 'fresh' || freshness.ageMs == null || !Number.isFinite(freshness.ageMs) ||
    !Number.isFinite(elapsedMs) || !Number.isFinite(requestDurationMs)) return 0
  return Math.max(0, 20000 - Math.max(0, freshness.ageMs) - Math.max(0, elapsedMs) - Math.max(0, requestDurationMs))
}

export function ResourceReadingsContent({freshness,elapsedMs,requestDurationMs,children}: {
  freshness: ResourceFreshness; elapsedMs: number; requestDurationMs: number; children: ReactNode
}) {
  const current = resourceExpiryDelay(freshness, elapsedMs, requestDurationMs) > 0
  if (!current) {
    const stale = freshness.state !== 'unavailable'
    return <div role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
      {stale ? <>Resource readings expired.{freshness.sampledAt && ` Last sample: ${new Date(freshness.sampledAt).toLocaleTimeString()}.`} Waiting for fresh data.</>
        : 'VM resource monitoring is unavailable.'}
      {' '}Queue and worker controls remain available.
    </div>
  }
  return <>
    <p className="text-xs text-muted-foreground" role="status">Resource sample: {new Date(freshness.sampledAt!).toLocaleTimeString()}. Readings expire after 20 seconds without a fresh sample.</p>
    {children}
  </>
}

export function ResourceReadings({freshness,receivedAt,requestDurationMs,children}: {
  freshness: ResourceFreshness; receivedAt: number; requestDurationMs: number; children: ReactNode
}) {
  const [clock,setClock] = useState(0)
  useEffect(() => {
    const tick = () => setClock(performance.now())
    tick()
    // A local deadline still expires the readings when polling stops. Recheck
    // immediately when returning to a tab whose timers were suspended.
    const delay = resourceExpiryDelay(freshness, performance.now() - receivedAt, requestDurationMs)
    const timer = window.setTimeout(tick, delay + 1)
    document.addEventListener('visibilitychange',tick)
    window.addEventListener('focus',tick)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange',tick)
      window.removeEventListener('focus',tick)
    }
  },[freshness,receivedAt,requestDurationMs])
  return <ResourceReadingsContent freshness={freshness} elapsedMs={Math.max(0,clock-receivedAt)} requestDurationMs={requestDurationMs}>
    {children}
  </ResourceReadingsContent>
}
