import { createContext, createElement, ReactNode, useContext, useEffect, useState } from 'react'
import { jwtDecode } from 'jwt-decode'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { contestRouter } from '@otog/contract'
import { getAccessToken } from '../api/auth'
import { PageRequestOverlap } from '../api/page-request-overlap'
import { environment } from '../env'
import { problemRouteId } from '../api/contest-problem-page'

type PageResult = { status: number; body: unknown; headers: Headers }

const Context = createContext<{ overlap: PageRequestOverlap<PageResult>; key: string } | null>(null)

export function ProblemPageOverlapProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { data: session, status } = useSession()
  const isProblem = router.isReady && router.pathname === '/contest/[contestId]/problem/[problemId]'
  const contestId = isProblem ? problemRouteId(router.query.contestId) : null
  const problemId = isProblem ? problemRouteId(router.query.problemId) : null
  const loadingSession = status === 'loading'
  const invalidSession = status === 'unauthenticated'
    || (session as { error?: string } | null)?.error === 'RefreshAccessTokenError'
  const [overlap] = useState(() => new PageRequestOverlap<PageResult>())
  const key = `${contestId}/${problemId}`
  useEffect(() => () => overlap.cancel(), [overlap, key])
  useEffect(() => {
    if (invalidSession) { overlap.cancel(); return }
    if (!loadingSession || !contestId || !problemId) return
    const token = getAccessToken()
    if (!token) return
    // Near-expiry credentials take the existing session/refresh path instead.
    try {
      const { exp } = jwtDecode(token)
      if (typeof exp !== 'number' || exp * 1000 < Date.now() + 30000) return
    } catch { return }
    overlap.start(key, token, async signal => {
      const response = await fetch(`${environment.API_HOST}/contest/${contestId}/problem/${problemId}/page`, {
        headers: { Authorization: `Bearer ${token}` }, credentials: 'include', cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      })
      const json: unknown = await response.json()
      return { status: response.status, headers: response.headers, body: response.status === 200
        ? contestRouter.getContestProblemPage.responses[200].parse(json) : json }
    })
  }, [overlap, key, contestId, problemId, loadingSession, invalidSession])
  return createElement(Context.Provider, { value: { overlap, key } }, children)
}

export function useProblemPageOverlap() {
  const value = useContext(Context)
  if (!value) throw new Error('ProblemPageOverlapProvider is required')
  return value
}
