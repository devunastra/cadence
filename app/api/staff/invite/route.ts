import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendStudioOwnerInvite } from '@/lib/email'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { email, role, studioId } = body

  if (!email || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!['studio_owner', 'studio_staff', 'super_admin'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  // Check if requester is a super_admin in any studio (global authority)
  const { data: anyAdminRow } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'super_admin')
    .limit(1)
    .maybeSingle()

  const isSuperAdmin = !!anyAdminRow

  const serviceClient = createServiceClient()

  // ── Studio-less invite: onboard a brand-new studio owner ──
  // No studio exists yet — the owner creates it in the /onboarding wizard.
  // role_intent + studio_setup_complete:false drive the proxy gate to /onboarding.
  if (!studioId) {
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Only a super admin can invite a new studio owner.' }, { status: 403 })
    }
    if (role !== 'studio_owner') {
      return NextResponse.json({ error: 'A new-studio invite must use the Owner role.' }, { status: 400 })
    }
    // Use the origin the invite was triggered from (e.g. the staging branch deploy) so the
    // link + redirect stay on that same deploy; fall back to the configured site URL.
    const siteUrl = (request.headers.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
    // Create the invited user + a one-time token WITHOUT sending Supabase's email,
    // then send our own branded invite via Resend (see lib/email.ts).
    const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
        data: {
          invited_by: user.email ?? 'your administrator',
          onboarding_complete: false,
          studio_setup_complete: false,
          role_intent: 'studio_owner',
        },
      },
    })
    if (linkError || !linkData?.properties?.hashed_token) {
      return NextResponse.json({ error: linkError?.message ?? 'Failed to create invite.' }, { status: 400 })
    }
    const inviteUrl = `${siteUrl}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=invite`
    try {
      await sendStudioOwnerInvite({
        to: email,
        inviteUrl,
        invitedBy: user.email ?? 'your administrator',
      })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to send invite email.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  }

  // ── Invite into an existing studio ──
  if (!isSuperAdmin) {
    // Verify requester is an owner of this specific studio
    const { data: requesterMembership } = await supabase
      .from('studio_users')
      .select('role')
      .eq('user_id', user.id)
      .eq('studio_id', studioId)
      .single()

    if (!requesterMembership || requesterMembership.role === 'studio_staff') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Only super_admin can invite other super_admins
  if (role === 'super_admin' && !isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: inviteData, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')}/auth/callback?type=invite`,
    data: { invited_by: user.email ?? 'your administrator', onboarding_complete: false },
  })

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 })
  }

  // Add to studio_users
  const { error: membershipError } = await serviceClient
    .from('studio_users')
    .upsert({
      studio_id: studioId,
      user_id: inviteData.user.id,
      role,
    }, { onConflict: 'studio_id,user_id' })

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
