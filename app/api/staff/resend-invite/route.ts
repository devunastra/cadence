import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, LOGIN_LIMIT } from '@/lib/rate-limit'
import { sendStudioOwnerInvite, sendCoStaffInvite } from '@/lib/email'

// Public, unauthenticated endpoint (the invitee has no session). It re-sends a
// fresh invite link to an email that still has a PENDING invite. Responses are
// deliberately generic — same body whether or not the email exists — to avoid
// account enumeration.

async function findUserByEmail(serviceClient: SupabaseClient, email: string): Promise<User | null> {
  const target = email.trim().toLowerCase()
  const perPage = 1000
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage })
    if (error) return null
    const hit = data.users.find(u => (u.email ?? '').toLowerCase() === target)
    if (hit) return hit
    if (data.users.length < perPage) return null
  }
  return null
}

const GENERIC_OK = NextResponse.json({ ok: true })

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { allowed } = await checkRateLimit(`resend-invite:${ip}`, LOGIN_LIMIT)
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const email = (body as { email?: string }).email
  if (!email) return GENERIC_OK

  const serviceClient = createServiceClient()
  const existing = await findUserByEmail(serviceClient, email)
  // No account, or already finished onboarding → nothing pending to resend.
  if (!existing || existing.user_metadata?.onboarding_complete === true) return GENERIC_OK

  const siteUrl = (request.headers.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
  const meta = existing.user_metadata ?? {}
  const invitedBy = (meta.invited_by as string) ?? 'your administrator'

  // Existing user can't be re-issued a type:'invite' link (email_exists). A
  // magiclink token achieves the same thing — confirms email + establishes a
  // session — and /accept-invite verifies it on submit just like an invite token.
  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
    type: 'magiclink',
    email: existing.email ?? email,
    options: { redirectTo: `${siteUrl}/accept-invite` },
  })
  if (linkError || !linkData?.properties?.hashed_token) return GENERIC_OK

  const inviteUrl = `${siteUrl}/accept-invite?token_hash=${linkData.properties.hashed_token}&type=magiclink&by=${encodeURIComponent(invitedBy)}`

  // Pick the right branded template: co-staff/owner into an existing studio if a
  // membership exists, otherwise the blank-studio owner invite.
  const { data: membership } = await serviceClient
    .from('studio_users')
    .select('role, studios(name)')
    .eq('user_id', existing.id)
    .limit(1)
    .maybeSingle()

  try {
    if (membership) {
      const studioName = (membership.studios as unknown as { name?: string } | null)?.name ?? 'your studio'
      await sendCoStaffInvite({
        to: existing.email ?? email,
        inviteUrl,
        studioName,
        role: membership.role as 'studio_owner' | 'studio_staff' | 'super_admin',
        invitedBy,
      })
    } else {
      await sendStudioOwnerInvite({ to: existing.email ?? email, inviteUrl, invitedBy })
    }
  } catch {
    // Swallow — never reveal send success/failure to an unauthenticated caller.
  }

  return GENERIC_OK
}
