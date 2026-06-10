// Agents the /test page can call.
//
// Source of truth is the per-studio `studio_test_agents` table (see migration 043) —
// use `getStudioTestAgents(studioId)`. The legacy global TEST_AGENTS env var below is
// kept only as a dormant fallback and is no longer wired into the /test routes.

import { createServiceClient } from '@/lib/supabase/server'

export type TestAgent = { id: string; label: string; fromNumber: string }

// Per-studio agents from the database. Holds no secrets — id and fromNumber are
// identifiers; the Retell API key stays in RETELL_API_KEY. Uses the service-role
// client (bypasses RLS); callers must scope to the user's selected studio first.
export async function getStudioTestAgents(studioId: string): Promise<TestAgent[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('studio_test_agents')
    .select('agent_id, label, from_number')
    .eq('studio_id', studioId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[test-agents] Failed to load studio_test_agents:', error.message)
    return []
  }
  return (data ?? []).map((r) => ({ id: r.agent_id, label: r.label, fromNumber: r.from_number }))
}

// Legacy: agents configured via the TEST_AGENTS env var (JSON array).
// Format: [{"id":"agent_xxx","label":"My Agent","fromNumber":"+1XXXXXXXXXX"}]
// Falls back to empty list if not set or malformed. No longer used by the /test routes.
export function getTestAgents(): TestAgent[] {
  const raw = process.env.TEST_AGENTS
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (a): a is TestAgent =>
        typeof a?.id === 'string' && typeof a?.label === 'string' && typeof a?.fromNumber === 'string',
    )
  } catch {
    console.error('[test-agents] Failed to parse TEST_AGENTS env var as JSON')
    return []
  }
}
