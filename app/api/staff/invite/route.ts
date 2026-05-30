import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  sendStudioOwnerInvite,
  sendCoStaffInvite,
  sendExistingOwnerNewStudioInvite,
  sendStudioMembershipNotification,
  sendRoleChangedNotification,
} from '@/lib/email'

// Walk auth.users (no email-filter on listUsers) to find an existing account.
// Capped at 10k users — sufficient for the foreseeable future; revisit if scale changes.
async function findUserByEmail(serviceClient: SupabaseClient, email: string): Promise<User | null> {
  const target = email.trim().toLowerCase()
  const perPage = 1000
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(error.message)
    const users = data.users
    const hit = users.find(u => (u.email ?? '').toLowerCase() === target)
    if (hit) return hit
    if (users.length < perPage) return null
  }
  return null
}

// Supabase signals "email already registered" via different shapes across SDK versions
// — sniff message + status to detect it. Used as the fallback trigger for race
// scenario j (two super_admins inviting the same brand-new email at the same time).
function isEmailExistsError(err: { message?: string; status?: number } | null): boolean {
  if (!err) return false
  const msg = (err.message ?? '').toLowerCase()
  return msg.includes('already') && msg.includes('registered') || msg.includes('email_exists') || err.status === 422
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { email, role, studioId, confirmRoleChange } = body as {
    email?: string; role?: string; studioId?: string; confirmRoleChange?: boolean
  }

  if (!email || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!['studio_owner', 'studio_staff', 'super_admin'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  // (g) Self-invite guard — case-insensitive email match against the requester.
  if ((user.email ?? '').toLowerCase() === email.trim().toLowerCase()) {
    return NextResponse.json({ error: "You can't invite yourself." }, { status: 400 })
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

  // Same origin/site-URL logic used in both branches so links stay on the deploy
  // the invite was triggered from (staging-- vs production).
  const siteUrl = (request.headers.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')

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

    // (c) Existing user — skip the password flow and just flip the onboarding gate.
    let existing = await findUserByEmail(serviceClient, email)
    if (existing) {
      return await reArmExistingOwnerForOnboarding(serviceClient, existing, user, email, siteUrl)
    }

    // New user — generate an invite link + send our branded email.
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

    // (j) Race fallback: another inviter beat us to it and the email is now taken.
    if (linkError && isEmailExistsError(linkError)) {
      existing = await findUserByEmail(serviceClient, email)
      if (existing) {
        return await reArmExistingOwnerForOnboarding(serviceClient, existing, user, email, siteUrl)
      }
    }
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

  // (h) Studio must exist and not be soft-deleted.
  const { data: studioRow } = await serviceClient
    .from('studios')
    .select('id, name, deleted_at')
    .eq('id', studioId)
    .maybeSingle()
  if (!studioRow || studioRow.deleted_at) {
    return NextResponse.json({ error: 'Studio not found.' }, { status: 400 })
  }
  const studioName = studioRow.name as string

  // If the email already has an account, branch on existing membership state.
  let existing = await findUserByEmail(serviceClient, email)

  // New user path: generate an invite link (creates user, NO Supabase email) and
  // send our own branded Resend invite. (j) race-fallback to existing-user path if
  // another inviter slipped in.
  if (!existing) {
    const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
        data: { invited_by: user.email ?? 'your administrator', onboarding_complete: false },
      },
    })
    if (linkError && isEmailExistsError(linkError)) {
      existing = await findUserByEmail(serviceClient, email)
    } else if (linkError || !linkData?.properties?.hashed_token || !linkData.user) {
      return NextResponse.json({ error: linkError?.message ?? 'Failed to create invite.' }, { status: 400 })
    } else {
      // Brand-new user: insert their membership row before sending the email so
      // the studio_users row exists by the time they sign in.
      const { error: membershipError } = await serviceClient
        .from('studio_users')
        .upsert({ studio_id: studioId, user_id: linkData.user.id, role }, { onConflict: 'studio_id,user_id' })
      if (membershipError) {
        return NextResponse.json({ error: membershipError.message }, { status: 500 })
      }
      const inviteUrl = `${siteUrl}/auth/callback?token_hash=${linkData.properties.hashed_token}&type=invite`
      try {
        await sendCoStaffInvite({
          to: email,
          inviteUrl,
          studioName,
          role: role as 'studio_owner' | 'studio_staff' | 'super_admin',
          invitedBy: user.email ?? 'your administrator',
        })
      } catch (e) {
        // Membership is created; the super_admin can resend if email fails.
        return NextResponse.json({
          ok: true,
          warning: e instanceof Error ? e.message : 'Membership added but invite email failed.',
        })
      }
      return NextResponse.json({ ok: true })
    }
  }

  // Existing user path — covers d (already a member), e/f (added to new studio),
  // and i (role change via re-invite).
  if (!existing) {
    return NextResponse.json({ error: 'Failed to resolve invitee account.' }, { status: 500 })
  }

  const { data: currentMembership } = await serviceClient
    .from('studio_users')
    .select('id, role')
    .eq('studio_id', studioId)
    .eq('user_id', existing.id)
    .maybeSingle()

  if (currentMembership) {
    // (d) Already a member with the same role — no-op success, no email.
    if (currentMembership.role === role) {
      return NextResponse.json({ ok: true, already: true })
    }
    // (i) Different role — require explicit confirmation before changing.
    if (!confirmRoleChange) {
      return NextResponse.json({
        ok: false,
        requires_role_change_confirmation: true,
        current_role: currentMembership.role,
        new_role: role,
        studio_name: studioName,
      }, { status: 409 })
    }
    const previousRole = currentMembership.role as 'studio_owner' | 'studio_staff' | 'super_admin'
    const { error: updateError } = await serviceClient
      .from('studio_users')
      .update({ role })
      .eq('id', currentMembership.id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    try {
      await sendRoleChangedNotification({
        to: email,
        loginUrl: `${siteUrl}/login`,
        studioName,
        previousRole,
        newRole: role as 'studio_owner' | 'studio_staff' | 'super_admin',
        invitedBy: user.email ?? 'your administrator',
      })
    } catch (e) {
      return NextResponse.json({
        ok: true,
        role_changed: { from: previousRole, to: role },
        warning: e instanceof Error ? e.message : 'Role updated but notification email failed.',
      })
    }
    return NextResponse.json({ ok: true, role_changed: { from: previousRole, to: role } })
  }

  // (e/f) Existing user being added to a NEW-to-them studio.
  const { error: membershipError } = await serviceClient
    .from('studio_users')
    .upsert({ studio_id: studioId, user_id: existing.id, role }, { onConflict: 'studio_id,user_id' })
  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 })
  }
  try {
    await sendStudioMembershipNotification({
      to: email,
      loginUrl: `${siteUrl}/login`,
      studioName,
      role: role as 'studio_owner' | 'studio_staff' | 'super_admin',
      invitedBy: user.email ?? 'your administrator',
    })
  } catch (e) {
    return NextResponse.json({
      ok: true,
      warning: e instanceof Error ? e.message : 'Membership added but notification email failed.',
    })
  }
  return NextResponse.json({ ok: true })
}

// (c + j) Helper for the studio-less + existing-user path.
async function reArmExistingOwnerForOnboarding(
  serviceClient: SupabaseClient,
  existing: User,
  inviter: User,
  email: string,
  siteUrl: string,
): Promise<NextResponse> {
  const meta = existing.user_metadata ?? {}
  const { error: metaError } = await serviceClient.auth.admin.updateUserById(existing.id, {
    user_metadata: {
      ...meta,
      role_intent: 'studio_owner',
      studio_setup_complete: false,
      invited_by: inviter.email ?? meta.invited_by ?? 'your administrator',
    },
  })
  if (metaError) {
    return NextResponse.json({ error: metaError.message }, { status: 500 })
  }
  try {
    await sendExistingOwnerNewStudioInvite({
      to: email,
      loginUrl: `${siteUrl}/login`,
      invitedBy: inviter.email ?? 'your administrator',
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to send invite email.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
