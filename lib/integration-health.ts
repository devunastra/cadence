/**
 * Integration health probes for GHL, Retell, and n8n Scheduled Callbacks.
 *
 * Server-only (uses env-scoped fetch calls with API keys). Each probe:
 *  - times out at PROBE_TIMEOUT_MS to bound page latency
 *  - never throws — returns a HealthResult with a status enum
 *  - sanitizes vendor error messages before surfacing them (bearer tokens /
 *    key-shaped strings are redacted)
 *
 * Consumed by /settings/admin/integrations (super_admin) and later a
 * studio-owner-scoped view. Live probes only in v0/v1 — v3 adds a
 * `studio_integration_health` cache table populated by a cron.
 */

const PROBE_TIMEOUT_MS = 5000

export type HealthStatus = 'ok' | 'warn' | 'error' | 'not_configured' | 'unknown'

export interface HealthResult {
  status: HealthStatus
  message?: string
  checkedAt: string
  latencyMs?: number
}

export type IntegrationKind = 'ghl' | 'retell' | 'n8n_callbacks'

export interface StudioHealthSnapshot {
  studio_id: string
  results: Record<IntegrationKind, HealthResult>
  probedAt: string
}

export interface HealthCheckStudio {
  id: string
  ghl_account_id?: string | null
  ghl_api_key?: string | null
  retell_api_key?: string | null
  retell_agent_id?: string | null
}

/**
 * Strip anything that looks like a bearer token or key-shaped string from
 * vendor error messages before surfacing to the client. Vendor 4xx bodies
 * sometimes echo request auth back verbatim.
 */
export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g, 'Bearer [redacted]')
    .replace(/\b(?:pit-|sk-|key-|key_)[A-Za-z0-9_-]{16,}/g, '[redacted]')
    .slice(0, 240)
}

function now(): string {
  return new Date().toISOString()
}

/**
 * Fetch wrapper with an AbortController-backed timeout. Never throws — returns
 * `res: null` with an `error` string on timeout / network failure.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ res: Response | null; error?: string; latencyMs: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    return { res, latencyMs: Date.now() - started }
  } catch (err) {
    const latencyMs = Date.now() - started
    const name = (err as Error).name
    const message = name === 'AbortError'
      ? 'Probe timed out'
      : sanitizeErrorMessage((err as Error).message ?? 'Network error')
    return { res: null, error: message, latencyMs }
  } finally {
    clearTimeout(timer)
  }
}

// ── GHL ─────────────────────────────────────────────────────────────────────────

/**
 * Probes GHL via `GET /conversations/search?locationId=X&limit=1`. Cheap read
 * that validates BOTH the API key AND the location ID. Same endpoint used by
 * app/api/conversations/unread-count/route.ts, so we know it works in prod.
 */
export async function checkGHL(studio: HealthCheckStudio): Promise<HealthResult> {
  if (!studio.ghl_api_key || !studio.ghl_account_id) {
    return { status: 'not_configured', checkedAt: now() }
  }
  const url = `https://services.leadconnectorhq.com/conversations/search?locationId=${encodeURIComponent(studio.ghl_account_id)}&limit=1`
  const { res, error, latencyMs } = await fetchWithTimeout(
    url,
    {
      headers: {
        'Authorization': `Bearer ${studio.ghl_api_key}`,
        'Version': '2021-04-15',
      },
    },
    PROBE_TIMEOUT_MS,
  )
  return interpretResponse(res, error, latencyMs, 'GHL')
}

// ── Retell ──────────────────────────────────────────────────────────────────────

/**
 * Probes Retell via `POST /v3/list-calls` with `limit: 1`. Same endpoint the
 * app uses in syncRetellCallsNow, so shape is verified. Falls back to no
 * agent filter when the studio doesn't have retell_agent_id set yet.
 */
export async function checkRetell(studio: HealthCheckStudio): Promise<HealthResult> {
  if (!studio.retell_api_key) {
    return { status: 'not_configured', checkedAt: now() }
  }
  const filter_criteria: { agent_id?: string[] } = {}
  if (studio.retell_agent_id) filter_criteria.agent_id = [studio.retell_agent_id]
  const { res, error, latencyMs } = await fetchWithTimeout(
    'https://api.retellai.com/v3/list-calls',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${studio.retell_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filter_criteria, limit: 1, sort_order: 'descending' }),
    },
    PROBE_TIMEOUT_MS,
  )
  return interpretResponse(res, error, latencyMs, 'Retell')
}

// ── n8n Scheduled Callbacks ────────────────────────────────────────────────────

/**
 * Probes the n8n Scheduled Callbacks list webhook. There is no dedicated
 * health endpoint on the n8n side, so this hits the real list URL with an
 * empty body — the workflow returns fast and doesn't mutate state.
 *
 * Empty-body 200 responses are treated as OK because the workflow legitimately
 * returns an empty body when the callbacks data table is empty. A truly
 * inactive workflow returns a non-2xx from n8n.
 */
export async function checkN8nCallbacks(): Promise<HealthResult> {
  const url = process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL
  const secret = process.env.N8N_SCHEDULED_CALLBACKS_SECRET
  if (!url || !secret) {
    return { status: 'not_configured', checkedAt: now() }
  }
  const { res, error, latencyMs } = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Callbacks-Secret': secret,
      },
      body: JSON.stringify({}),
    },
    PROBE_TIMEOUT_MS,
  )
  return interpretResponse(res, error, latencyMs, 'n8n')
}

/**
 * Map a fetch outcome into a HealthResult with vendor-agnostic status codes.
 * Kept single-source so all three probes surface consistent messages.
 */
async function interpretResponse(
  res: Response | null,
  error: string | undefined,
  latencyMs: number,
  vendor: string,
): Promise<HealthResult> {
  if (!res) {
    return { status: 'unknown', message: error ?? 'Probe failed', checkedAt: now(), latencyMs }
  }
  if (res.status === 401 || res.status === 403) {
    return { status: 'error', message: `${vendor} credentials rejected`, checkedAt: now(), latencyMs }
  }
  if (res.status === 429) {
    return { status: 'unknown', message: `${vendor} rate limit hit`, checkedAt: now(), latencyMs }
  }
  if (res.status >= 500) {
    return { status: 'error', message: `${vendor} unreachable (${res.status})`, checkedAt: now(), latencyMs }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const snippet = sanitizeErrorMessage(body).slice(0, 120)
    return { status: 'error', message: `${vendor} error ${res.status}${snippet ? `: ${snippet}` : ''}`, checkedAt: now(), latencyMs }
  }
  return { status: 'ok', checkedAt: now(), latencyMs }
}

// ── Orchestrator ────────────────────────────────────────────────────────────────

/**
 * Runs all integration probes for a studio in parallel. Each probe carries its
 * own AbortController timeout, so this returns within PROBE_TIMEOUT_MS
 * regardless of vendor slowness. One dead vendor never blocks another.
 */
export async function checkStudioHealth(studio: HealthCheckStudio): Promise<StudioHealthSnapshot> {
  const [ghl, retell, n8nCallbacks] = await Promise.all([
    checkGHL(studio),
    checkRetell(studio),
    checkN8nCallbacks(),
  ])
  return {
    studio_id: studio.id,
    results: { ghl, retell, n8n_callbacks: n8nCallbacks },
    probedAt: now(),
  }
}

/** Worst-status-wins ordering. Used to color a per-studio summary pill. */
export function summarizeStudioHealth(snapshot: StudioHealthSnapshot): HealthStatus {
  const priority: Record<HealthStatus, number> = {
    error: 0,
    warn: 1,
    unknown: 2,
    ok: 3,
    not_configured: 4,
  }
  const statuses = Object.values(snapshot.results).map(r => r.status)
  if (statuses.length === 0) return 'unknown'
  return statuses.sort((a, b) => priority[a] - priority[b])[0]
}
