import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId, studioId } = await request.json()
  if (!userId || !studioId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Prevent removing yourself
  if (userId === user.id) {
    return NextResponse.json({ error: 'You cannot remove yourself.' }, { status: 400 })
  }

  // Authority: super_admin in ANY studio, else owner of the target studio.
  const { data: anyAdminRow } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'super_admin')
    .limit(1)
    .maybeSingle()
  const requesterIsSuperAdmin = !!anyAdminRow

  if (!requesterIsSuperAdmin) {
    const { data: requesterMembership } = await supabase
      .from('studio_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('studio_id', studioId)
      .single()
    if (!requesterMembership || requesterMembership.role !== 'studio_owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Prevent a non-super_admin from removing a super_admin
  const { data: targetSuperAdminRow } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'super_admin')
    .limit(1)
    .maybeSingle()

  if (targetSuperAdminRow && !requesterIsSuperAdmin) {
    return NextResponse.json({ error: 'Cannot remove a super_admin.' }, { status: 403 })
  }

  const serviceClient = createServiceClient()

  // Revoke access to this studio only. Hard-delete the studio_users row — it's
  // pure access control, no related data to preserve (leads.created_by_email,
  // activity_logs.actor_email are plain text columns, not FKs).
  const { error: membershipError } = await serviceClient
    .from('studio_users')
    .delete()
    .eq('user_id', userId)
    .eq('studio_id', studioId)

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 })
  }

  // We DO NOT auto-delete the auth account when this was the user's last
  // membership. Auto-deletion was too aggressive — a single mis-click could
  // permanently destroy a real user's account (login history, password, etc.),
  // with no Supabase-side recovery. Orphaned users now land on /no-access via
  // the (app) layout redirect, where they can sign out or wait for an admin to
  // re-grant access. A dedicated "Delete user account" flow can be built later
  // if super_admins actually need to purge users (see client-onboarding-spec
  // discussion 2026-06-01).
  return NextResponse.json({ ok: true, accountDeleted: false })
}
