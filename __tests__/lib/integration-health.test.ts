import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  sanitizeErrorMessage,
  checkGHL,
  checkRetell,
  checkN8nCallbacks,
  checkStudioHealth,
  summarizeStudioHealth,
  type HealthCheckStudio,
  type StudioHealthSnapshot,
} from '@/lib/integration-health'

// ── fetch mock helpers ─────────────────────────────────────────────────────────

function mockResponse(status: number, body = '', ok?: boolean): Response {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    text: async () => body,
    json: async () => JSON.parse(body || '{}'),
  } as Response
}

function withFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl as unknown as typeof fetch)
  vi.stubGlobal('fetch', mock)
  return mock
}

const goodStudio: HealthCheckStudio = {
  id: 'studio-1',
  ghl_account_id: 'ghl-loc-1',
  ghl_api_key: 'ghl-key',
  retell_api_key: 'retell-key',
  retell_agent_id: 'agent-1',
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => {
  delete process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL
  delete process.env.N8N_SCHEDULED_CALLBACKS_SECRET
})

// ── sanitizeErrorMessage ───────────────────────────────────────────────────────

describe('sanitizeErrorMessage', () => {
  it('redacts bearer tokens', () => {
    const msg = 'Auth failed: Bearer abcdefghijklmnopqrstuvwxyz'
    expect(sanitizeErrorMessage(msg)).toBe('Auth failed: Bearer [redacted]')
  })

  it('redacts pit- prefixed tokens', () => {
    const msg = 'Invalid pit-abcdefghij1234567890abcd'
    expect(sanitizeErrorMessage(msg)).toBe('Invalid [redacted]')
  })

  it('redacts sk- and key- prefixes', () => {
    expect(sanitizeErrorMessage('bad sk-ABCDEFGHIJ1234567890')).toContain('[redacted]')
    expect(sanitizeErrorMessage('bad key-ABCDEFGHIJ1234567890')).toContain('[redacted]')
  })

  it('truncates messages over 240 chars', () => {
    const long = 'x'.repeat(500)
    expect(sanitizeErrorMessage(long)).toHaveLength(240)
  })

  it('leaves short benign messages alone', () => {
    expect(sanitizeErrorMessage('Not found')).toBe('Not found')
  })
})

// ── checkGHL ───────────────────────────────────────────────────────────────────

describe('checkGHL', () => {
  it('returns not_configured when api key is missing', async () => {
    const result = await checkGHL({ ...goodStudio, ghl_api_key: null })
    expect(result.status).toBe('not_configured')
  })

  it('returns not_configured when location id is missing', async () => {
    const result = await checkGHL({ ...goodStudio, ghl_account_id: null })
    expect(result.status).toBe('not_configured')
  })

  it('returns ok on 200', async () => {
    withFetch(async () => mockResponse(200, '{"conversations":[]}'))
    const result = await checkGHL(goodStudio)
    expect(result.status).toBe('ok')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('returns error on 401', async () => {
    withFetch(async () => mockResponse(401, 'Unauthorized'))
    const result = await checkGHL(goodStudio)
    expect(result.status).toBe('error')
    expect(result.message).toContain('credentials rejected')
  })

  it('returns error on 500', async () => {
    withFetch(async () => mockResponse(500, 'ISE'))
    const result = await checkGHL(goodStudio)
    expect(result.status).toBe('error')
    expect(result.message).toContain('unreachable')
  })

  it('returns unknown on 429', async () => {
    withFetch(async () => mockResponse(429, 'rate limit'))
    const result = await checkGHL(goodStudio)
    expect(result.status).toBe('unknown')
    expect(result.message).toContain('rate limit')
  })

  it('returns unknown on network failure', async () => {
    withFetch(async () => { throw new Error('ECONNREFUSED') })
    const result = await checkGHL(goodStudio)
    expect(result.status).toBe('unknown')
    expect(result.message).toBe('ECONNREFUSED')
  })

  it('sanitizes vendor error bodies that echo bearer tokens', async () => {
    withFetch(async () => mockResponse(400, 'Invalid Bearer abcdefghijklmnopqrstuvwxyz'))
    const result = await checkGHL(goodStudio)
    expect(result.status).toBe('error')
    expect(result.message).not.toContain('abcdefghijklmnop')
    expect(result.message).toContain('[redacted]')
  })

  it('sends the studio api key as Bearer auth', async () => {
    const spy = withFetch(async () => mockResponse(200))
    await checkGHL(goodStudio)
    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer ghl-key')
  })
})

// ── checkRetell ────────────────────────────────────────────────────────────────

describe('checkRetell', () => {
  it('returns not_configured when key is missing', async () => {
    const result = await checkRetell({ ...goodStudio, retell_api_key: null })
    expect(result.status).toBe('not_configured')
  })

  it('returns ok on 200 with agent filter', async () => {
    let capturedBody: string | undefined
    withFetch(async (_url, init) => {
      capturedBody = init?.body as string
      return mockResponse(200, '{"items":[]}')
    })
    const result = await checkRetell(goodStudio)
    expect(result.status).toBe('ok')
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.filter_criteria.agent_id).toEqual(['agent-1'])
    expect(parsed.limit).toBe(1)
  })

  it('omits agent filter when retell_agent_id is missing', async () => {
    let capturedBody: string | undefined
    withFetch(async (_url, init) => {
      capturedBody = init?.body as string
      return mockResponse(200, '{"items":[]}')
    })
    await checkRetell({ ...goodStudio, retell_agent_id: null })
    const parsed = JSON.parse(capturedBody ?? '{}')
    expect(parsed.filter_criteria.agent_id).toBeUndefined()
  })

  it('returns error on 403', async () => {
    withFetch(async () => mockResponse(403, 'forbidden'))
    const result = await checkRetell(goodStudio)
    expect(result.status).toBe('error')
    expect(result.message).toContain('credentials rejected')
  })

  it('returns error on 502', async () => {
    withFetch(async () => mockResponse(502, 'bad gateway'))
    const result = await checkRetell(goodStudio)
    expect(result.status).toBe('error')
    expect(result.message).toContain('unreachable')
  })
})

// ── checkN8nCallbacks ──────────────────────────────────────────────────────────

describe('checkN8nCallbacks', () => {
  it('returns not_configured when the URL env var is missing', async () => {
    process.env.N8N_SCHEDULED_CALLBACKS_SECRET = 'secret'
    const result = await checkN8nCallbacks()
    expect(result.status).toBe('not_configured')
  })

  it('returns not_configured when the secret env var is missing', async () => {
    process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL = 'https://n8n.example/webhook/list'
    const result = await checkN8nCallbacks()
    expect(result.status).toBe('not_configured')
  })

  it('returns ok on 200 empty body (matches the empty-data-table case)', async () => {
    process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL = 'https://n8n.example/webhook/list'
    process.env.N8N_SCHEDULED_CALLBACKS_SECRET = 'secret'
    withFetch(async () => mockResponse(200, ''))
    const result = await checkN8nCallbacks()
    expect(result.status).toBe('ok')
  })

  it('returns error on 401', async () => {
    process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL = 'https://n8n.example/webhook/list'
    process.env.N8N_SCHEDULED_CALLBACKS_SECRET = 'secret'
    withFetch(async () => mockResponse(401, 'unauthorized'))
    const result = await checkN8nCallbacks()
    expect(result.status).toBe('error')
    expect(result.message).toContain('credentials rejected')
  })

  it('sends the secret in X-Callbacks-Secret header', async () => {
    process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL = 'https://n8n.example/webhook/list'
    process.env.N8N_SCHEDULED_CALLBACKS_SECRET = 'sekret'
    const spy = withFetch(async () => mockResponse(200, ''))
    await checkN8nCallbacks()
    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-Callbacks-Secret']).toBe('sekret')
  })
})

// ── checkStudioHealth (orchestrator) ───────────────────────────────────────────

describe('checkStudioHealth', () => {
  it('runs all three probes and returns a snapshot', async () => {
    process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL = 'https://n8n.example/webhook/list'
    process.env.N8N_SCHEDULED_CALLBACKS_SECRET = 'secret'
    withFetch(async () => mockResponse(200, '{}'))
    const snap = await checkStudioHealth(goodStudio)
    expect(snap.studio_id).toBe('studio-1')
    expect(snap.results.ghl.status).toBe('ok')
    expect(snap.results.retell.status).toBe('ok')
    expect(snap.results.n8n_callbacks.status).toBe('ok')
  })

  it("one failing vendor doesn't fail the others", async () => {
    process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL = 'https://n8n.example/webhook/list'
    process.env.N8N_SCHEDULED_CALLBACKS_SECRET = 'secret'
    withFetch(async (url) => {
      if (url.includes('retellai.com')) return mockResponse(500, 'boom')
      return mockResponse(200, '{}')
    })
    const snap = await checkStudioHealth(goodStudio)
    expect(snap.results.ghl.status).toBe('ok')
    expect(snap.results.retell.status).toBe('error')
    expect(snap.results.n8n_callbacks.status).toBe('ok')
  })
})

// ── summarizeStudioHealth ──────────────────────────────────────────────────────

describe('summarizeStudioHealth', () => {
  const base = (statuses: {
    ghl: string; retell: string; n8n_callbacks: string
  }): StudioHealthSnapshot => ({
    studio_id: 's',
    probedAt: '2026-01-01T00:00:00.000Z',
    results: {
      ghl: { status: statuses.ghl as never, checkedAt: '' },
      retell: { status: statuses.retell as never, checkedAt: '' },
      n8n_callbacks: { status: statuses.n8n_callbacks as never, checkedAt: '' },
    },
  })

  it('returns error when any probe is error', () => {
    expect(summarizeStudioHealth(base({ ghl: 'ok', retell: 'error', n8n_callbacks: 'ok' })))
      .toBe('error')
  })

  it('returns warn when no error but a warn exists', () => {
    expect(summarizeStudioHealth(base({ ghl: 'ok', retell: 'warn', n8n_callbacks: 'ok' })))
      .toBe('warn')
  })

  it('returns unknown over ok', () => {
    expect(summarizeStudioHealth(base({ ghl: 'ok', retell: 'unknown', n8n_callbacks: 'ok' })))
      .toBe('unknown')
  })

  it('returns ok when all ok', () => {
    expect(summarizeStudioHealth(base({ ghl: 'ok', retell: 'ok', n8n_callbacks: 'ok' })))
      .toBe('ok')
  })

  it('returns not_configured only when nothing else applies', () => {
    expect(summarizeStudioHealth(base({ ghl: 'not_configured', retell: 'not_configured', n8n_callbacks: 'not_configured' })))
      .toBe('not_configured')
  })
})
