// Server-only: imported by the NextAuth API route, never a browser module.
import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

type Ingress = { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }
export function authProxyHeaders(req: Ingress): Record<string, string> {
  const secret = process.env.OTOG_AUTH_PROXY_SECRET
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('Authentication proxy is not configured.')
    return {}
  }
  const normalized = (value: string) => {
    const ip = value.startsWith('::ffff:') ? value.slice(7) : value
    return isIP(ip) ? ip : ''
  }
  const peer = normalized(req.socket?.remoteAddress || '')
  const trusted = new Set((process.env.OTOG_TRUSTED_PROXY_IPS || '127.0.0.1,::1').split(',').map(x => normalized(x.trim())))
  let ip = peer
  const raw = req.headers?.['x-forwarded-for']
  if (trusted.has(peer) && typeof raw === 'string' && raw.length <= 2048) {
    for (const part of raw.split(',').reverse()) {
      const candidate = normalized(part.trim())
      if (!candidate) { ip = peer; break }
      if (!trusted.has(candidate)) { ip = candidate; break }
    }
  }
  if (!ip) return {}
  const stamp = String(Date.now())
  return { 'x-otog-client-ip': ip, 'x-otog-client-time': stamp,
    'x-otog-client-signature': createHmac('sha256', secret).update(`v1\nPOST /auth/login\n${stamp}\n${ip}`).digest('hex') }
}
