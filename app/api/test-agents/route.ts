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

  // Fetch the user's memberships once. super_admin is stored per-studio in
  // studio_users but the app treats it as GLOBAL — a super_admin can switch to
  // any studio without an explicit membership row for it.
  const serviceClient = createServiceClient()
  const { data: memberships } = await serviceClient
    .from('studio_users')
    .select('studio_id, role')
    .eq('user_id', session.user.id)
  const isSuper = memberships?.some((m) => m.role === 'super_admin') ?? false

  // Resolve the selected studio (cookie), falling back to the user's first membership.
  let studioId = await getSelectedStudioId()
  if (!studioId) {
    studioId = memberships?.[0]?.studio_id ?? null
  }
  if (!studioId) {
    return NextResponse.json({ agents: [] })
  }

  // Guard: super_admins may view any studio; everyone else must be a member of the
  // resolved studio (the cookie is user-controlled and the service client bypasses RLS).
  const isMember = memberships?.some((m) => m.studio_id === studioId) ?? false
  if (!isSuper && !isMember) {
    return NextResponse.json({ agents: [] })
  }

  const agents = (await getStudioTestAgents(studioId)).map((a) => ({ id: a.id, label: a.label }))
  return NextResponse.json({ agents })
}
