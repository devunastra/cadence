/**
 * Shared writer for studio_integration_health cache rows.
 *
 * Server-only. Extracted from app/actions.ts so both the interactive server
 * actions and the cron API route (/api/cron/probe-integrations) can share the
 * same probe-and-upsert code.
 *
 * Kept intentionally free of Next.js request/auth concerns — callers are
 * expected to have already authorized the operation and to hand in a service
 * client (RLS-bypassing) so cross-studio writes work.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkStudioHealth,
  summarizeStudioHealth,
  type HealthStatus,
  type HealthResult,
  type IntegrationKind,
  type StudioHealthSnapshot,
} from '@/lib/integration-health'

export interface ProbeableStudio {
  id: string
  name: string
  ghl_account_id: string | null
  ghl_api_key: string | null
  retell_api_key: string | null
  retell_agent_id: string | null
}

export interface StudioHealthEntry {
  studio_id: string
  studio_name: string
  snapshot: StudioHealthSnapshot
  overall: HealthStatus
}

export const REQUIRED_INTEGRATIONS: IntegrationKind[] = ['ghl', 'retell', 'n8n_callbacks']
export const PROBE_CHUNK = 5

interface CacheRow {
  studio_id: string
  integration: IntegrationKind
  status: HealthStatus
  message: string | null
  checked_at: string
  latency_ms: number | null
}

function toCacheRow(studioId: string, integration: IntegrationKind, r: HealthResult): CacheRow {
  return {
    studio_id: studioId,
    integration,
    status: r.status,
    message: r.message ?? null,
    checked_at: r.checkedAt,
    latency_ms: r.latencyMs ?? null,
  }
}

/**
 * Live-probes each studio (chunked so we don't burst-hammer vendors) and
 * upserts every result into studio_integration_health. Returns entries
 * suitable for direct rendering.
 */
export async function probeAndCacheStudios(
  service: SupabaseClient,
  studios: ProbeableStudio[],
): Promise<StudioHealthEntry[]> {
  if (studios.length === 0) return []
  const entries: StudioHealthEntry[] = []
  const cacheRows: CacheRow[] = []

  for (let i = 0; i < studios.length; i += PROBE_CHUNK) {
    const batch = studios.slice(i, i + PROBE_CHUNK)
    const snapshots = await Promise.all(batch.map(s => checkStudioHealth(s)))
    for (let j = 0; j < batch.length; j++) {
      const snapshot = snapshots[j]
      entries.push({
        studio_id: batch[j].id,
        studio_name: batch[j].name,
        snapshot,
        overall: summarizeStudioHealth(snapshot),
      })
      for (const key of REQUIRED_INTEGRATIONS) {
        cacheRows.push(toCacheRow(batch[j].id, key, snapshot.results[key]))
      }
    }
  }

  if (cacheRows.length > 0) {
    await service
      .from('studio_integration_health')
      .upsert(cacheRows, { onConflict: 'studio_id,integration' })
  }

  return entries
}

/**
 * Reads cached probe results for the given studios. Returns entries with
 * complete cache coverage and the ids of studios missing at least one
 * integration row (they'll need a live probe to complete the view).
 */
export async function readCachedEntries(
  service: SupabaseClient,
  studios: Array<{ id: string; name: string }>,
): Promise<{ entries: StudioHealthEntry[]; missing: Set<string> }> {
  if (studios.length === 0) return { entries: [], missing: new Set() }
  const studioIds = studios.map(s => s.id)
  const { data: rows } = await service
    .from('studio_integration_health')
    .select('studio_id, integration, status, message, checked_at, latency_ms')
    .in('studio_id', studioIds)

  const byStudio = new Map<string, Partial<Record<IntegrationKind, HealthResult>>>()
  for (const r of (rows ?? []) as Array<{
    studio_id: string
    integration: IntegrationKind
    status: HealthStatus
    message: string | null
    checked_at: string
    latency_ms: number | null
  }>) {
    if (!byStudio.has(r.studio_id)) byStudio.set(r.studio_id, {})
    byStudio.get(r.studio_id)![r.integration] = {
      status: r.status,
      message: r.message ?? undefined,
      checkedAt: r.checked_at,
      latencyMs: r.latency_ms ?? undefined,
    }
  }

  const entries: StudioHealthEntry[] = []
  const missing = new Set<string>()
  for (const s of studios) {
    const results = byStudio.get(s.id) ?? {}
    const complete = REQUIRED_INTEGRATIONS.every(k => results[k])
    if (!complete) {
      missing.add(s.id)
      continue
    }
    const full = results as Record<IntegrationKind, HealthResult>
    const probedAt = REQUIRED_INTEGRATIONS.map(k => full[k].checkedAt).sort().slice(-1)[0]
    const snapshot: StudioHealthSnapshot = { studio_id: s.id, results: full, probedAt }
    entries.push({
      studio_id: s.id,
      studio_name: s.name,
      snapshot,
      overall: summarizeStudioHealth(snapshot),
    })
  }
  return { entries, missing }
}
