import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'

interface RateLimitOptions {
  limit: number
  windowMs: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

const redis = Redis.fromEnv()

// Cache Ratelimit instances to avoid recreating on every call
const limiters = new Map<string, Ratelimit>()

function getLimiter(options: RateLimitOptions): Ratelimit {
  const key = `${options.limit}:${options.windowMs}`
  let limiter = limiters.get(key)
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(options.limit, `${options.windowMs} ms`),
    })
    limiters.set(key, limiter)
  }
  return limiter
}

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const limiter = getLimiter(options)
  const { success, remaining, reset } = await limiter.limit(key)
  return { allowed: success, remaining, resetAt: reset }
}

// Pre-configured limiters for different endpoint types
export const LOGIN_LIMIT   = { limit: 10,  windowMs: 15 * 60 * 1000 } // 10/15min per IP
export const MESSAGE_LIMIT = { limit: 100, windowMs: 60 * 60 * 1000 } // 100/hr per user
export const GENERAL_LIMIT = { limit: 100, windowMs: 60 * 1000 }      // 100/min per user
