// Agents the /test page can call. Configured via TEST_AGENTS env var (JSON array).
// Format: [{"id":"agent_xxx","label":"My Agent","fromNumber":"+1XXXXXXXXXX"}]
// Falls back to empty list if not set or malformed.

export type TestAgent = { id: string; label: string; fromNumber: string }

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
