import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { ServiceUnavailableException } from '@nestjs/common'
import { BoundedWorkQueue } from './bounded-work-queue'

const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
// Login verification and registration hashing share the same admission limit.
const queue = new BoundedWorkQueue(2, 10, 30000, () => new ServiceUnavailableException({
  statusCode: 503,
  message: 'Password processing is busy. Try again shortly.',
  retryAfterSeconds: 1,
}))
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return queue.run(() => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, parameters,
    (error, value) => error ? reject(error) : resolve(value))))
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return `scrypt$32768$8$3$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string) {
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    return timingSafeEqual(Buffer.from(stored, 'hex'), createHash('sha256').update(password).digest())
  }
  const parts = stored.split('$')
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3') return false
  const salt = Buffer.from(parts[4]!, 'base64url'), expected = Buffer.from(parts[5]!, 'base64url')
  if (salt.length !== 16 || expected.length !== 64) return false
  return timingSafeEqual(expected, await derive(password, salt))
}
