import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendRoleChangedNotification } from '@/lib/email'

const VALID_ROLES = new Set(['studio_staff', 'studio_owner', 'super_admin'])
type StudioRole = 'studio_owner' | 'studio_staff' | 'super_admin'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId, studioId, role } = await request.json()
  if (!userId || !studioId || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  // Prevent changing your own role
  if (userId === user.id) {
    return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 })
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

  // Use the service client for everything that touches another user's studio_users
  // row. RLS only returns rows for studios the *requester* is a member of, so a
  // super_admin who has no `studio_users` row in `studioId` would otherwise read
  // null here and we'd 404 the request as "User not found in this studio."
  // (Same RLS gap as updateStudio + analyze-call-quality.)
  const serviceClient = createServiceClient()

  // Fetch target's current role
  const { data: targetMembership } = await serviceClient
    .from('studio_users')
    .select('role')
    .eq('user_id', userId)
    .eq('studio_id', studioId)
    .single()

  if (!targetMembership) {
    return NextResponse.json({ error: 'User not found in this studio.' }, { status: 404 })
  }

  // studio_owner cannot touch super_admin rows or elevate anyone to super_admin
  if (!requesterIsSuperAdmin) {
    if (targetMembership.role === 'super_admin') {
      return NextResponse.json({ error: 'Cannot change the role of a Super Admin.' }, { status: 403 })
    }
    if (role === 'super_admin') {
      return NextResponse.json({ error: 'Cannot assign Super Admin role.' }, { status: 403 })
    }
  }

  const previousRole = targetMembership.role as StudioRole

  const { error } = await serviceClient
    .from('studio_users')
    .update({ role })
    .eq('user_id', userId)
    .eq('studio_id', studioId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify the affected user via Resend so the dropdown path is consistent with
  // the invite-form path (which already sends `sendRoleChangedNotification`).
  // Email failures are non-fatal — surface as a `warning` so the UI can flag it
  // without rolling back the role change.
  const siteUrl = (request.headers.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  let emailWarning: string | undefined
  try {
    const [targetUserResult, studioResult] = await Promise.all([
      serviceClient.auth.admin.getUserById(userId),
      serviceClient.from('studios').select('name').eq('id', studioId).single(),
    ])
    const targetEmail = targetUserResult.data?.user?.email
    const studioName = studioResult.data?.name
    if (targetEmail && studioName) {
      await sendRoleChangedNotification({
        to: targetEmail,
        loginUrl: `${siteUrl}/login`,
        studioName,
        previousRole,
        newRole: role as StudioRole,
        invitedBy: user.email ?? 'your administrator',
      })
    } else {
      emailWarning = 'Role updated but notification email could not be sent (missing target email or studio name).'
    }
  } catch (e) {
    emailWarning = e instanceof Error ? e.message : 'Role updated but notification email failed.'
  }

  return NextResponse.json({ ok: true, previousRole, newRole: role, ...(emailWarning ? { warning: emailWarning } : {}) })
}
