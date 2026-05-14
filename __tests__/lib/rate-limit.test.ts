import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Upstash ratelimit before importing
const mockLimit = vi.fn()

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    constructor() {}
    limit = mockLimit
    static slidingWindow() { return {} }
  },
}))

vi.mock('@upstash/redis', () => ({
  Redis: { fromEnv: () => ({}) },
}))

import { checkRateLimit } from '@/lib/rate-limit'

describe('checkRateLimit', () => {
  beforeEach(() => {
    mockLimit.mockReset()
  })

  it('allows requests under the limit', async () => {
    mockLimit.mockResolvedValue({ success: true, remaining: 4, reset: Date.now() + 60000 })
    const result = await checkRateLimit('user-1', { limit: 5, windowMs: 60_000 })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks requests over the limit', async () => {
    mockLimit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60000 })
    const result = await checkRateLimit('user-blocked', { limit: 5, windowMs: 60_000 })
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })
})
