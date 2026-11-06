import type { Request, Response, NextFunction } from 'express'
import { ingressAddress, loginClientAddress, loginCredentials } from './auth-admission'

const buckets = new Map<string, { until: number; count: number }>()
export function allowedOrigins() {
  return new Set((process.env.OTOG_ALLOWED_ORIGINS || 'http://localhost:3030,http://127.0.0.1:3030').split(',').map(x => x.trim()).filter(Boolean))
}
function permit(key: string, count: number, duration: number) {
  const now = Date.now()
  let value = buckets.get(key)
  if (buckets.size > 10000) for (const [k, b] of buckets) if (b.until <= now) buckets.delete(k)
  if (!value || value.until <= now) {
    if (buckets.size >= 20000) return false
    value = { until: now + duration, count: 0 }; buckets.set(key, value)
  }
  return ++value.count <= count
}
export function securityMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Express matches routes case-insensitively and permits a trailing slash.
  const route = req.path.replace(/\/+$/, '').toLowerCase()
  if (req.method === 'POST' && route === '/auth/login') {
    const credentials = loginCredentials(req)
    if (!credentials) { res.status(400).json({ message: 'Credentials must be supplied in the request body.' }); return }
    req.body = credentials
    const client = loginClientAddress(req)
    const accountAtClient = JSON.stringify([client, credentials.username])
    if (!permit('login-ip:' + client, 120, 60000) ||
        !permit('login-ip-name:' + accountAtClient, 30, 60000) ||
        !permit('login-global', 1000, 60000)) {
      res.setHeader('Retry-After', '60'); res.status(429).json({ message: 'Too many login attempts. Try again in a minute.' }); return
    }
  }
  if (req.method === 'POST' && route === '/auth/register' && !permit('register:' + ingressAddress(req), 120, 3600000)) {
    res.setHeader('Retry-After', '3600'); res.status(429).json({ message: 'Too many registrations. Try again later.' }); return
  }
  next()
}
