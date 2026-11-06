export type BucketPolicy = { capacity: number; refillPerSecond: number }
type Bucket = { tokens: number; updatedAt: number; policy: BucketPolicy }
export type BucketDecision = { allowed: boolean; retryAfterSeconds: number; unavailable?: boolean }

// One synchronous admission operation in the single API process; no database work.
export class TokenBuckets {
  private buckets = new Map<string, Bucket>()
  private nextSweep = 0

  constructor(private maximumEntries = 20000, private clock = () => performance.now()) {}

  private sweep(now: number) {
    for (const [key, bucket] of this.buckets) {
      // Dropping a fully replenished bucket is equivalent to retaining it.
      if (bucket.tokens + Math.max(0, now - bucket.updatedAt) * bucket.policy.refillPerSecond / 1000 >= bucket.policy.capacity) {
        this.buckets.delete(key)
      }
    }
    this.nextSweep = now + 30000
  }

  take(key: string, policy: BucketPolicy): BucketDecision {
    const now = this.clock()
    if (now >= this.nextSweep) this.sweep(now)
    let bucket = this.buckets.get(key)
    if (!bucket) {
      if (this.buckets.size >= this.maximumEntries) this.sweep(now)
      // Never evict a depleted account and give it a fresh burst.
      if (this.buckets.size >= this.maximumEntries) return { allowed: false, retryAfterSeconds: 1, unavailable: true }
      bucket = { tokens: policy.capacity, updatedAt: now, policy }
      this.buckets.set(key, bucket)
    }
    bucket.tokens = Math.min(policy.capacity, bucket.tokens + Math.max(0, now - bucket.updatedAt) * policy.refillPerSecond / 1000)
    bucket.updatedAt = Math.max(now, bucket.updatedAt)
    if (bucket.tokens < 1) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / policy.refillPerSecond)) }
    }
    bucket.tokens -= 1
    return { allowed: true, retryAfterSeconds: 0 }
  }
}
