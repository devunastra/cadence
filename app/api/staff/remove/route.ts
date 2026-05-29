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

  // Revoke access to this studio only.
  const { error: membershipError } = await serviceClient
    .from('studio_users')
    .delete()
    .eq('user_id', userId)
    .eq('studio_id', studioId)

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 })
  }

  // Only delete the auth account if this was the user's last studio membership.
  const { data: remaining } = await serviceClient
    .from('studio_users')
    .select('id')
    .eq('user_id', userId)
    .limit(1)

  if (!remaining || remaining.length === 0) {
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(userId)
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, accountDeleted: true })
  }

  return NextResponse.json({ ok: true, accountDeleted: false })
}
