import { Resend } from 'resend'

// From-address is configurable so we can switch between Resend's test sender and a
// verified domain without code changes. Resend's `onboarding@resend.dev` only delivers
// to the email the Resend account was created with.
const FROM = process.env.RESEND_FROM ?? 'Cadence <onboarding@resend.dev>'

function emailShell(innerHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e5e3;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                ${innerHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f7f7f7;border-top:1px solid #e5e5e3;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">Didn't expect this email? You can safely ignore it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

interface StudioOwnerInviteOpts {
  to: string
  inviteUrl: string // points to /auth/callback?token_hash=...&type=invite
  invitedBy: string
  loomUrl?: string
}

/**
 * Sends the branded "set up your studio" invite via Resend. We generate the auth
 * link ourselves (admin.generateLink) and send it here, instead of using Supabase's
 * built-in invite email — so the email is branded and doesn't touch Supabase's
 * shared SMTP config.
 */
export async function sendStudioOwnerInvite(opts: StudioOwnerInviteOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const loomUrl = opts.loomUrl ?? 'https://www.loom.com/' // TODO: replace with the real walkthrough

  const html = emailShell(`
                <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#111111;">You're invited to Cadence</h1>
                <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#6b7280;">
                  <strong style="color:#111111;">${opts.invitedBy}</strong> has invited you to set up your dance studio on Cadence.
                </p>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#6b7280;">
                  ▶ <a href="${loomUrl}" style="color:#2383E2;text-decoration:none;">Watch this short walkthrough first</a>, then set up your studio:
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#2383E2;">
                      <a href="${opts.inviteUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Set up your studio</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  If the button doesn't work, paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:12px;line-height:1.6;word-break:break-all;">
                  <a href="${opts.inviteUrl}" style="color:#2383E2;">${opts.inviteUrl}</a>
                </p>
`)

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: "You're invited to set up your studio on Cadence",
    html,
  })
  if (error) throw new Error(error.message ?? 'Failed to send invite email')
}

interface CoStaffInviteOpts {
  to: string
  inviteUrl: string // /auth/callback?token_hash=...&type=invite
  studioName: string
  role: 'studio_owner' | 'studio_staff' | 'super_admin'
  invitedBy: string
}

/**
 * Branded invite for scenario b — a brand-new email being added to an existing
 * studio (co-owner / staff). Replaces the default Supabase invite email; mirrors
 * the password-setup CTA used by `sendStudioOwnerInvite`.
 */
export async function sendCoStaffInvite(opts: CoStaffInviteOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const roleLabel = opts.role === 'studio_owner' ? 'an owner' : opts.role === 'studio_staff' ? 'staff' : 'a super admin'

  const html = emailShell(`
                <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#111111;">You're invited to ${opts.studioName}</h1>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#6b7280;">
                  <strong style="color:#111111;">${opts.invitedBy}</strong> has invited you to join <strong style="color:#111111;">${opts.studioName}</strong> as ${roleLabel} on Cadence. Set a password to get started.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#2383E2;">
                      <a href="${opts.inviteUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Set password & sign in</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  If the button doesn't work, paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:12px;line-height:1.6;word-break:break-all;">
                  <a href="${opts.inviteUrl}" style="color:#2383E2;">${opts.inviteUrl}</a>
                </p>
`)

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `You're invited to ${opts.studioName} on Cadence`,
    html,
  })
  if (error) throw new Error(error.message ?? 'Failed to send invite email')
}

interface ExistingOwnerNewStudioOpts {
  to: string
  loginUrl: string // points to /login — proxy will then redirect to /onboarding
  invitedBy: string
}

/**
 * Existing user is being asked to onboard another studio. They already have an
 * account, so no password setup — they just sign in and the proxy redirects them
 * to /onboarding (because studio_setup_complete=false was set on their metadata).
 */
export async function sendExistingOwnerNewStudioInvite(opts: ExistingOwnerNewStudioOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const html = emailShell(`
                <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#111111;">Set up another studio on Cadence</h1>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#6b7280;">
                  <strong style="color:#111111;">${opts.invitedBy}</strong> has asked you to set up a new studio on your existing Cadence account. Sign in to continue — you'll be taken straight to the studio setup wizard.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#2383E2;">
                      <a href="${opts.loginUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Sign in & set up studio</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  If the button doesn't work, paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:12px;line-height:1.6;word-break:break-all;">
                  <a href="${opts.loginUrl}" style="color:#2383E2;">${opts.loginUrl}</a>
                </p>
`)

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: 'Set up another studio on Cadence',
    html,
  })
  if (error) throw new Error(error.message ?? 'Failed to send invite email')
}

type StudioRole = 'studio_owner' | 'studio_staff' | 'super_admin'

interface StudioMembershipNotificationOpts {
  to: string
  loginUrl: string
  studioName: string
  role: StudioRole
  invitedBy: string
}

const ROLE_LABEL: Record<StudioRole, string> = {
  studio_owner: 'an owner',
  studio_staff: 'staff',
  super_admin: 'a super admin',
}

/**
 * Existing user was added to an existing studio. No password setup, no onboarding
 * — they sign in and the studio appears in their sidebar.
 */
export async function sendStudioMembershipNotification(opts: StudioMembershipNotificationOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const html = emailShell(`
                <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#111111;">You've been added to ${opts.studioName}</h1>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#6b7280;">
                  <strong style="color:#111111;">${opts.invitedBy}</strong> added you to <strong style="color:#111111;">${opts.studioName}</strong> as ${ROLE_LABEL[opts.role]}. Sign in to your Cadence account and the studio will appear in your sidebar.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#2383E2;">
                      <a href="${opts.loginUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Sign in to Cadence</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  If the button doesn't work, paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:12px;line-height:1.6;word-break:break-all;">
                  <a href="${opts.loginUrl}" style="color:#2383E2;">${opts.loginUrl}</a>
                </p>
`)

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `You've been added to ${opts.studioName} on Cadence`,
    html,
  })
  if (error) throw new Error(error.message ?? 'Failed to send notification email')
}

interface RoleChangedNotificationOpts {
  to: string
  loginUrl: string
  studioName: string
  previousRole: StudioRole
  newRole: StudioRole
  invitedBy: string
}

const FULL_ROLE_LABEL: Record<StudioRole, string> = {
  studio_owner: 'Owner',
  studio_staff: 'Staff',
  super_admin: 'Super Admin',
}

/** Existing user's role inside a studio was changed via the invite form. */
export async function sendRoleChangedNotification(opts: RoleChangedNotificationOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const html = emailShell(`
                <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#111111;">Your role at ${opts.studioName} changed</h1>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#6b7280;">
                  <strong style="color:#111111;">${opts.invitedBy}</strong> changed your role at <strong style="color:#111111;">${opts.studioName}</strong> from <strong style="color:#111111;">${FULL_ROLE_LABEL[opts.previousRole]}</strong> to <strong style="color:#111111;">${FULL_ROLE_LABEL[opts.newRole]}</strong>.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#2383E2;">
                      <a href="${opts.loginUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open Cadence</a>
                    </td>
                  </tr>
                </table>
`)

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `Your role at ${opts.studioName} changed`,
    html,
  })
  if (error) throw new Error(error.message ?? 'Failed to send notification email')
}
