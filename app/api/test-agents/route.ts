import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getSelectedStudioId } from '@/lib/data-cache'
import { getStudioTestAgents } from '@/lib/test-agents'

// Returns the list of test agents available to the /test page dropdown for the
// currently selected studio. Source of truth is the `studio_test_agents` table.
// Only returns id (= Retell agent_id) + label — from_number stays server-side.
export async function GET() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve the selected studio (cookie), falling back to the user's first membership.
  const serviceClient = createServiceClient()
  let studioId = await getSelectedStudioId()
  if (!studioId) {
    const { data: memberships } = await serviceClient
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', session.user.id)
      .limit(1)
    studioId = memberships?.[0]?.studio_id ?? null
  }
  if (!studioId) {
    return NextResponse.json({ agents: [] })
  }

  // Guard: confirm the user actually belongs to the resolved studio before returning
  // its agents (the cookie is user-controlled; service client bypasses RLS).
  const { data: membership } = await serviceClient
    .from('studio_users')
    .select('studio_id')
    .eq('user_id', session.user.id)
    .eq('studio_id', studioId)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ agents: [] })
  }

  const agents = (await getStudioTestAgents(studioId)).map((a) => ({ id: a.id, label: a.label }))
  return NextResponse.json({ agents })
}
