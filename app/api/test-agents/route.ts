import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTestAgents } from '@/lib/test-agents'

// Returns the list of test agents available to the /test page dropdown.
// Source of truth is the TEST_AGENTS env var (JSON array).
// Only returns id + label — fromNumber stays server-side.
export async function GET() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const agents = getTestAgents().map((a) => ({ id: a.id, label: a.label }))
  return NextResponse.json({ agents })
}
