import { Resend } from 'resend'

// From-address is configurable so we can switch between Resend's test sender and a
// verified domain without code changes. Resend's `onboarding@resend.dev` only delivers
// to the email the Resend account was created with.
const FROM = process.env.RESEND_FROM ?? 'Cadence <onboarding@resend.dev>'

// ── Design tokens (mirrors app/globals.css; email clients can't read CSS vars) ─

// Single-quotes around "Segoe UI" so the value is safe inside style="…" HTML attributes.
// (Double-quotes inside a double-quoted attribute close the attribute and drop every
// declaration after font-family — silently broke the CTA's white text + no-underline.)
const FONT = `Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`

const C = {
  bg: '#f7f7f7',
  card: '#ffffff',
  border: '#e5e5e3',
  textPrimary: '#111111',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  accent: '#2383E2',
} as const

// ── Small helpers ────────────────────────────────────────────────────────────

/** HTML-escape user-supplied strings before injecting into templates. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Hidden snippet that shows in inbox previews but not in the body. */
function preheaderHtml(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.bg};opacity:0;">${esc(text)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>`
}

/** Primary CTA button (left-aligned, matches original style). */
function cta(label: string, href: string): string {
  // Put color/text-decoration first so any later attribute-parse weirdness can't
  // strip the white text + no-underline. Belt-and-suspenders: also wrap the label
  // in a <span> with the same styles in case a client's CSS resets <a> defaults.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
    <tr>
      <td style="border-radius:8px;background:${C.accent};">
        <a href="${href}" style="color:#ffffff;text-decoration:none;display:inline-block;padding:12px 28px;border-radius:8px;font-family:${FONT};font-size:14px;font-weight:600;font-style:normal;line-height:1;"><span style="color:#ffffff;text-decoration:none;font-weight:600;">${esc(label)}</span></a>
      </td>
    </tr>
  </table>`
}

/** "If the button doesn't work, paste this link…" fallback. */
function fallbackUrl(href: string): string {
  return `<p class="cd-muted" style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.textMuted};">If the button doesn&rsquo;t work, paste this link into your browser:</p>
    <p style="margin:0 0 24px 0;font-family:${FONT};font-size:12px;line-height:1.6;word-break:break-all;">
      <a href="${href}" style="font-family:${FONT};color:${C.accent};">${esc(href)}</a>
    </p>`
}

// ── Shell ────────────────────────────────────────────────────────────────────

interface ShellOpts {
  preheader: string
  title: string
  body: string
}

function emailShell({ preheader, title, body }: ShellOpts): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${esc(title)}</title>
    <style>
      @media (max-width: 480px) {
        .cd-card { width: 100% !important; border-radius: 0 !important; border-left: none !important; border-right: none !important; }
        .cd-pad { padding: 28px 22px 8px 22px !important; }
      }
      @media (prefers-color-scheme: dark) {
        body, .cd-bg { background: #111111 !important; }
        .cd-card { background: #1a1a1a !important; border-color: #2a2a2a !important; }
        .cd-footer { background: #161616 !important; border-color: #2a2a2a !important; }
        .cd-primary { color: rgba(255,255,255,0.92) !important; }
        .cd-secondary { color: rgba(255,255,255,0.62) !important; }
        .cd-muted { color: rgba(255,255,255,0.42) !important; }
      }
    </style>
  </head>
  <body class="cd-bg" style="margin:0;padding:0;background:${C.bg};font-family:${FONT};-webkit-font-smoothing:antialiased;">
    ${preheaderHtml(preheader)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="cd-bg" style="background:${C.bg};padding:32px 0;font-family:${FONT};">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" class="cd-card" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;overflow:hidden;max-width:480px;font-family:${FONT};">
            <tr>
              <td class="cd-pad" style="padding:32px 32px 8px 32px;font-family:${FONT};">
                ${body}
              </td>
            </tr>
            <tr>
              <td class="cd-footer" style="padding:16px 32px;background:${C.bg};border-top:1px solid ${C.border};">
                <p class="cd-muted" style="margin:0;font-family:${FONT};font-size:12px;color:${C.textMuted};">Didn&rsquo;t expect this email? You can safely ignore it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

// ── Plain-text builder ───────────────────────────────────────────────────────

interface PlainTextOpts {
  heading: string
  paragraphs: string[]
  ctaLabel?: string
  ctaUrl?: string
}

function buildPlainText({ heading, paragraphs, ctaLabel, ctaUrl }: PlainTextOpts): string {
  const lines: string[] = [heading, '']
  for (const p of paragraphs) lines.push(p, '')
  if (ctaLabel && ctaUrl) lines.push(`${ctaLabel}: ${ctaUrl}`, '')
  lines.push('—', "Didn't expect this email? You can safely ignore it.")
  return lines.join('\n')
}

// ── Body helpers ─────────────────────────────────────────────────────────────

function h1(text: string): string {
  return `<h1 class="cd-primary" style="margin:0 0 12px 0;font-family:${FONT};font-size:20px;font-weight:600;line-height:1.3;color:${C.textPrimary};">${text}</h1>`
}

function p(html: string, mb = 16): string {
  return `<p class="cd-secondary" style="margin:0 0 ${mb}px 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.textSecondary};">${html}</p>`
}

function strong(text: string): string {
  return `<strong class="cd-primary" style="color:${C.textPrimary};">${esc(text)}</strong>`
}

const ROLE_TEXT = {
  studio_owner: 'an owner',
  studio_staff: 'staff',
  super_admin: 'a super admin',
} as const

const ROLE_FULL = {
  studio_owner: 'Owner',
  studio_staff: 'Staff',
  super_admin: 'Super Admin',
} as const

type StudioRole = keyof typeof ROLE_TEXT

// ── 1. Studio owner invite (scenario a) ──────────────────────────────────────

interface StudioOwnerInviteOpts {
  to: string
  inviteUrl: string // /auth/callback?token_hash=...&type=invite
  invitedBy: string
  /** Optional Loom walkthrough URL. Falls back to the Loom homepage as a deliberate
   * placeholder until a real walkthrough exists. */
  loomUrl?: string
}

/**
 * Branded "set up your studio" invite (scenario a — new email, blank studio).
 * Generates the auth link via admin.generateLink and sends it here so the email
 * is fully branded and doesn't touch Supabase's shared SMTP config.
 */
export async function sendStudioOwnerInvite(opts: StudioOwnerInviteOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const loomUrl = opts.loomUrl ?? 'https://www.loom.com/' // TODO: replace with the real walkthrough
  const subject = "You're invited to set up your studio on Cadence"

  const body = `
    ${h1("You're invited to Cadence")}
    ${p(`${strong(opts.invitedBy)} has invited you to set up your dance studio on Cadence.`)}
    ${p(`<a href="${loomUrl}" style="color:${C.accent};text-decoration:none;font-weight:500;">&#9656;&nbsp;Watch this short walkthrough first</a>, then set up your studio:`, 24)}
    ${cta('Set up your studio', opts.inviteUrl)}
    ${fallbackUrl(opts.inviteUrl)}
  `

  const html = emailShell({
    preheader: 'Set up your dance studio on Cadence — quick walkthrough included.',
    title: subject,
    body,
  })

  const text = buildPlainText({
    heading: `You're invited to Cadence`,
    paragraphs: [
      `${opts.invitedBy} has invited you to set up your dance studio on Cadence.`,
      `Watch this short walkthrough first: ${loomUrl}`,
    ],
    ctaLabel: 'Set up your studio',
    ctaUrl: opts.inviteUrl,
  })

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({ from: FROM, to: opts.to, subject, html, text })
  if (error) throw new Error(error.message ?? 'Failed to send invite email')
}

// ── 2. Co-staff invite (scenario b) ──────────────────────────────────────────

interface CoStaffInviteOpts {
  to: string
  inviteUrl: string
  studioName: string
  role: StudioRole
  invitedBy: string
}

/**
 * Branded invite (scenario b — new email being added to an existing studio).
 * Mirrors the password-setup CTA from the owner-invite path.
 */
export async function sendCoStaffInvite(opts: CoStaffInviteOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const subject = `You're invited to ${opts.studioName} on Cadence`
  const studio = strong(opts.studioName)

  const body = `
    ${h1(`You're invited to ${esc(opts.studioName)}`)}
    ${p(`${strong(opts.invitedBy)} has invited you to join ${studio} as ${ROLE_TEXT[opts.role]} on Cadence. Set a password to get started.`, 24)}
    ${cta('Set password & sign in', opts.inviteUrl)}
    ${fallbackUrl(opts.inviteUrl)}
  `

  const html = emailShell({
    preheader: `Set a password and sign in to ${opts.studioName} on Cadence.`,
    title: subject,
    body,
  })

  const text = buildPlainText({
    heading: `You're invited to ${opts.studioName} on Cadence`,
    paragraphs: [
      `${opts.invitedBy} has invited you to join ${opts.studioName} as ${ROLE_TEXT[opts.role]} on Cadence.`,
      `Set a password to get started.`,
    ],
    ctaLabel: 'Set password & sign in',
    ctaUrl: opts.inviteUrl,
  })

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({ from: FROM, to: opts.to, subject, html, text })
  if (error) throw new Error(error.message ?? 'Failed to send invite email')
}

// ── 3. Existing owner, new studio (scenario c) ───────────────────────────────

interface ExistingOwnerNewStudioOpts {
  to: string
  loginUrl: string // /login — proxy redirects to /onboarding once signed in
  invitedBy: string
}

/**
 * Existing user is being asked to onboard another studio. They already have an
 * account, so no password setup — sign in and the proxy routes them to
 * /onboarding (studio_setup_complete=false is set on their metadata).
 */
export async function sendExistingOwnerNewStudioInvite(opts: ExistingOwnerNewStudioOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const subject = 'Set up another studio on Cadence'

  const body = `
    ${h1('Set up another studio on Cadence')}
    ${p(`${strong(opts.invitedBy)} has asked you to set up a new studio on your existing Cadence account. Sign in to continue &mdash; you&rsquo;ll be taken straight to the studio setup wizard.`, 24)}
    ${cta('Sign in & set up studio', opts.loginUrl)}
    ${fallbackUrl(opts.loginUrl)}
  `

  const html = emailShell({
    preheader: 'Sign in and finish setting up your new studio on Cadence.',
    title: subject,
    body,
  })

  const text = buildPlainText({
    heading: 'Set up another studio on Cadence',
    paragraphs: [
      `${opts.invitedBy} has asked you to set up a new studio on your existing Cadence account.`,
      `Sign in to continue — you'll be taken straight to the studio setup wizard.`,
    ],
    ctaLabel: 'Sign in & set up studio',
    ctaUrl: opts.loginUrl,
  })

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({ from: FROM, to: opts.to, subject, html, text })
  if (error) throw new Error(error.message ?? 'Failed to send invite email')
}

// ── 4. Studio-membership notification (scenarios e/f) ────────────────────────

interface StudioMembershipNotificationOpts {
  to: string
  loginUrl: string
  studioName: string
  role: StudioRole
  invitedBy: string
}

/**
 * Existing user was added to an existing studio. No password setup, no
 * onboarding — they sign in and the studio appears in their sidebar.
 */
export async function sendStudioMembershipNotification(opts: StudioMembershipNotificationOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const subject = `You've been added to ${opts.studioName} on Cadence`
  const studio = strong(opts.studioName)

  const body = `
    ${h1(`You've been added to ${esc(opts.studioName)}`)}
    ${p(`${strong(opts.invitedBy)} added you to ${studio} as ${ROLE_TEXT[opts.role]}. Sign in to your Cadence account and the studio will appear in your sidebar.`, 24)}
    ${cta('Sign in to Cadence', opts.loginUrl)}
    ${fallbackUrl(opts.loginUrl)}
  `

  const html = emailShell({
    preheader: `Sign in and ${opts.studioName} will appear in your sidebar.`,
    title: subject,
    body,
  })

  const text = buildPlainText({
    heading: `You've been added to ${opts.studioName} on Cadence`,
    paragraphs: [
      `${opts.invitedBy} added you to ${opts.studioName} as ${ROLE_TEXT[opts.role]}.`,
      `Sign in to your Cadence account and the studio will appear in your sidebar.`,
    ],
    ctaLabel: 'Sign in to Cadence',
    ctaUrl: opts.loginUrl,
  })

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({ from: FROM, to: opts.to, subject, html, text })
  if (error) throw new Error(error.message ?? 'Failed to send notification email')
}

// ── 5. Role-changed notification (scenario i) ────────────────────────────────

interface RoleChangedNotificationOpts {
  to: string
  loginUrl: string
  studioName: string
  previousRole: StudioRole
  newRole: StudioRole
  invitedBy: string
}

/** Existing user's role inside a studio was changed via the invite form. */
export async function sendRoleChangedNotification(opts: RoleChangedNotificationOpts): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')

  const subject = `Your role at ${opts.studioName} changed`
  const studio = strong(opts.studioName)

  const body = `
    ${h1(`Your role at ${esc(opts.studioName)} changed`)}
    ${p(`${strong(opts.invitedBy)} changed your role at ${studio} from ${strong(ROLE_FULL[opts.previousRole])} to ${strong(ROLE_FULL[opts.newRole])}.`, 24)}
    ${cta('Open Cadence', opts.loginUrl)}
  `

  const html = emailShell({
    preheader: `Your access level at ${opts.studioName} was updated by ${opts.invitedBy}.`,
    title: subject,
    body,
  })

  const text = buildPlainText({
    heading: `Your role at ${opts.studioName} changed`,
    paragraphs: [
      `${opts.invitedBy} changed your role at ${opts.studioName} from ${ROLE_FULL[opts.previousRole]} to ${ROLE_FULL[opts.newRole]}.`,
    ],
    ctaLabel: 'Open Cadence',
    ctaUrl: opts.loginUrl,
  })

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({ from: FROM, to: opts.to, subject, html, text })
  if (error) throw new Error(error.message ?? 'Failed to send notification email')
}
