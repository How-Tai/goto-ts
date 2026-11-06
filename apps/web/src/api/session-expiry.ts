import { signOut } from 'next-auth/react'

import { api } from '.'
import { clearAccessToken } from './auth'

let logoutInFlight: Promise<void> | null = null

export function redirectToLogin() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (!logoutInFlight) {
    clearAccessToken()
    // Use the base client so a failed logout cannot recursively refresh itself.
    logoutInFlight = api.options({ signal: AbortSignal.timeout(3000) }).post({}, '/auth/logout').res()
      .catch(() => undefined)
      .then(() => signOut({ redirect: false }))
      .catch(() => undefined)
      .then(() => {
        if (window.location.pathname !== '/login') window.location.replace('/login')
        else logoutInFlight = null
      })
  }
  return logoutInFlight
}
