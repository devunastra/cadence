import { Resend } from 'resend'

// From-address is configurable so we can switch between Resend's test sender and a
// verified domain without code changes. Resend's `onboarding@resend.dev` only delivers
// to the email the Resend account was created with.
const FROM = process.env.RESEND_FROM ?? 'Cadence <onboarding@resend.dev>'

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

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e5e3;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
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
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f7f7f7;border-top:1px solid #e5e5e3;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">Didn't expect this invite? You can safely ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: "You're invited to set up your studio on Cadence",
    html,
  })
  if (error) throw new Error(error.message ?? 'Failed to send invite email')
}
