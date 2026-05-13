interface RateLimitOptions {
  limit: number
  windowMs: number
}

interface RateLimitRecord {
  count: number
  resetAt: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

// In-memory store — suitable for single-instance Vercel serverless functions.
// For multi-region deployments, replace with Upstash Redis or Vercel KV.
const defaultStore = new Map<string, RateLimitRecord>()

export function checkRateLimit(
  key: string,
  options: RateLimitOptions,
  store: Map<string, RateLimitRecord> = defaultStore
): RateLimitResult {
  const now = Date.now()
  const record = store.get(key)

  if (!record || now > record.resetAt) {
    const resetAt = now + options.windowMs
    store.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: options.limit - 1, resetAt }
  }

  if (record.count >= options.limit) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt }
  }

  record.count += 1
  return { allowed: true, remaining: options.limit - record.count, resetAt: record.resetAt }
}

// Pre-configured limiters for different endpoint types
export const LOGIN_LIMIT   = { limit: 10,  windowMs: 15 * 60 * 1000 } // 10/15min per IP
export const MESSAGE_LIMIT = { limit: 100, windowMs: 60 * 60 * 1000 } // 100/hr per user
export const GENERAL_LIMIT = { limit: 100, windowMs: 60 * 1000 }      // 100/min per user
