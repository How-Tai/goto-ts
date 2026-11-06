import { CanActivate, ExecutionContext, HttpException, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { TokenBuckets } from '../../utils/token-bucket'

export const TOKEN_BUCKET_SCOPE = 'otog:token-bucket-scope'
export const SubmissionBucket = () => SetMetadata(TOKEN_BUCKET_SCOPE, 'submission')
export const ACCOUNT_BUCKETS = {
  api: { capacity: 300, refillPerSecond: 60 },
  submission: { capacity: 10, refillPerSecond: 1 },
  admin: { capacity: 600, refillPerSecond: 120 },
} as const

@Injectable()
export class AccountRateLimitGuard implements CanActivate {
  constructor(private reflector: Reflector, private buckets = new TokenBuckets()) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const http = context.switchToHttp()
    const user = http.getRequest().user
    // Runs after JWT verification. Never trust account IDs from request bodies or IPs.
    if (!Number.isSafeInteger(user?.id) || user.id < 1) return true
    const scope = this.reflector.getAllAndOverride<string>(TOKEN_BUCKET_SCOPE, [context.getHandler(), context.getClass()])
    const kind = scope === 'submission' ? 'submission' : user.role === 'admin' ? 'admin' : 'api'
    const decision = this.buckets.take(`${kind}:${user.id}`, ACCOUNT_BUCKETS[kind])
    if (decision.allowed) return true
    const status = decision.unavailable ? 503 : 429
    const response = http.getResponse()
    response.setHeader('Retry-After', String(decision.retryAfterSeconds))
    response.setHeader('Cache-Control', 'no-store')
    throw new HttpException({
      statusCode: status,
      code: decision.unavailable ? 'SERVER_BUSY' : 'RATE_LIMITED',
      message: 'กรุณารอสักครู่แล้วลองใหม่',
      retryAfterSeconds: decision.retryAfterSeconds,
    }, status)
  }
}
