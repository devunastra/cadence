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

  // Verify requester is owner or super_admin of this studio
  const { data: requesterMembership } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .single()

  if (!requesterMembership || requesterMembership.role === 'studio_staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Prevent removing yourself
  if (userId === user.id) {
    return NextResponse.json({ error: 'You cannot remove yourself.' }, { status: 400 })
  }

  // Prevent a non-super_admin from removing a super_admin
  const { data: targetSuperAdminRow } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'super_admin')
    .limit(1)
    .maybeSingle()

  const requesterIsSuperAdmin = requesterMembership.role === 'super_admin'
  if (targetSuperAdminRow && !requesterIsSuperAdmin) {
    return NextResponse.json({ error: 'Cannot remove a super_admin.' }, { status: 403 })
  }

  const serviceClient = createServiceClient()

  // Remove from studio_users
  const { error: membershipError } = await serviceClient
    .from('studio_users')
    .delete()
    .eq('user_id', userId)
    .eq('studio_id', studioId)

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 })
  }

  // Delete from auth entirely
  const { error: deleteError } = await serviceClient.auth.admin.deleteUser(userId)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
