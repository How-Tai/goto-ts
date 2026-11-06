import { createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { Request } from 'express'

export function loginCredentials(req: Pick<Request, 'body' | 'query'>) {
  const body = req.body
  if (req.query?.username !== undefined || req.query?.password !== undefined ||
      !body || Array.isArray(body) || typeof body.username !== 'string' ||
      typeof body.password !== 'string' || body.username.length < 1 ||
      body.username.length > 255 || body.password.length < 1 || body.password.length > 255) return null
  // Authentication and admission use these exact, case-sensitive strings.
  return { username: body.username, password: body.password }
}

function normalizedIp(value: string) {
  const ip = value.startsWith('::ffff:') ? value.slice(7) : value
  return isIP(ip) ? ip : ''
}
export function ingressAddress(req: Pick<Request, 'headers' | 'socket'>) {
  const peer = normalizedIp(req.socket.remoteAddress || '')
  const trusted = new Set((process.env.OTOG_TRUSTED_PROXY_IPS || '127.0.0.1,::1').split(',').map(x => normalizedIp(x.trim())))
  if (!trusted.has(peer)) return peer || 'unknown'
  const raw = req.headers['x-forwarded-for']
  if (typeof raw !== 'string' || raw.length > 2048) return peer
  for (const part of raw.split(',').reverse()) {
    const ip = normalizedIp(part.trim())
    if (!ip) return peer
    if (!trusted.has(ip)) return ip
  }
  return peer
}

export function loginClientAddress(req: Request) {
  const secret = process.env.OTOG_AUTH_PROXY_SECRET
  const ip = req.headers['x-otog-client-ip'], stamp = req.headers['x-otog-client-time'], signature = req.headers['x-otog-client-signature']
  if (secret && secret.length >= 32 && typeof ip === 'string' && normalizedIp(ip) === ip &&
      typeof stamp === 'string' && /^\d{13}$/.test(stamp) && Math.abs(Date.now() - Number(stamp)) <= 30000 &&
      typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature)) {
    const expected = createHmac('sha256', secret).update(`v1\nPOST /auth/login\n${stamp}\n${ip}`).digest()
    if (timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return ip
  }
  return ingressAddress(req)
}
