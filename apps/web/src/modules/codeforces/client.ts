import { getAccessToken } from '../../api/auth'
import { redirectToLogin } from '../../api/session-expiry'
import { environment } from '../../env'

export async function cfApi<T = any>(
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const token = getAccessToken()
  const response = await fetch(
    `${environment.API_HOST.replace(/\/$/, '')}/codeforces${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    }
  )
  if (response.status === 401) {
    await redirectToLogin()
    throw new Error('Please log in again.')
  }
  const data = await response
    .json()
    .catch(() => ({ message: 'The server could not complete this request.' }))
  if (!response.ok)
    throw new Error(
      Array.isArray(data.message)
        ? data.message.join('; ')
        : data.message || `Request failed (${response.status})`
    )
  return data
}
export const field =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
export const button =
  'inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
export const primary =
  button + ' bg-primary text-primary-foreground hover:opacity-90'
export const panel = 'rounded-lg border border-border bg-card p-5 shadow-sm'
