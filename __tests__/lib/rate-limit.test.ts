import { describe, it, expect } from 'vitest'
import { checkRateLimit } from '@/lib/rate-limit'

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const store = new Map()
    const result = checkRateLimit('user-1', { limit: 5, windowMs: 60_000 }, store)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks requests over the limit', () => {
    const store = new Map()
    const key = 'user-blocked'
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, { limit: 5, windowMs: 60_000 }, store)
    }
    const result = checkRateLimit(key, { limit: 5, windowMs: 60_000 }, store)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })
})
