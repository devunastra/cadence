'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MailCheck, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast-provider'
import type { EmailOtpType } from '@supabase/supabase-js'

// Verifying the one-time token on SUBMIT (not on mount) is what makes this page
// safe against email link-scanners: a scanner GET just renders the form and does
// nothing. Only a human submitting the password actually consumes the token.
const VALID_OTP_TYPES: EmailOtpType[] = ['invite', 'magiclink', 'recovery', 'email', 'signup']

function AcceptInviteForm() {
  const router = useRouter()
  const params = useSearchParams()
  const { showError } = useToast()

  const tokenHash = params.get('token_hash')
  const code = params.get('code')
  const rawType = params.get('type')
  const otpType: EmailOtpType = VALID_OTP_TYPES.includes(rawType as EmailOtpType)
    ? (rawType as EmailOtpType)
    : 'invite'
  const invitedBy = params.get('by') || 'your administrator'
  const hasToken = !!tokenHash || !!code

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  // Flips to true when the token is expired/consumed/missing — shows the resend UI.
  const [linkDead, setLinkDead] = useState(params.get('error') === 'expired' || !hasToken)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      showError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      showError('Passwords do not match.')
      return
    }
    setLoading(true)

    const supabase = createClient()

    // Consume the one-time token now (on submit). Establishes the session so the
    // updateUser call below can set the password.
    const verify = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType })
      : await supabase.auth.exchangeCodeForSession(code!)

    if (verify.error) {
      // Expired or already-used link → show the resend panel instead of a dead end.
      setLinkDead(true)
      setLoading(false)
      return
    }

    const { data: updated, error } = await supabase.auth.updateUser({
      password,
      data: { onboarding_complete: true },
    })
    if (error) {
      showError(error.message)
      setLoading(false)
      return
    }

    // Fresh JWT so the proxy sees onboarding_complete=true immediately.
    await supabase.auth.refreshSession()

    // Blank-studio owners still need the wizard; everyone else goes straight in.
    const meta = updated.user?.user_metadata
    const goOnboarding = meta?.role_intent === 'studio_owner' && meta?.studio_setup_complete === false
    router.push(goOnboarding ? '/onboarding' : '/leads')
  }

  if (linkDead) {
    return <ExpiredLinkPanel />
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-xl p-6 shadow-sm space-y-5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="text-center">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Set your password</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            You&apos;ve been invited by{' '}
            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{invitedBy}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>New Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              className="w-full px-3 py-2 rounded-lg text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              required
              className="w-full px-3 py-2 rounded-lg text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !password || !confirmPassword}
            className="w-full py-2 px-4 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: 'var(--color-accent)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
          >
            {loading ? 'Setting password…' : 'Set password & sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

// Fix 3 — graceful recovery when the invite link is expired/used, instead of
// dumping the invitee on a bare /login screen. Lets them resend themselves a
// fresh link.
function ExpiredLinkPanel() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleResend(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    // Response is intentionally generic (no account enumeration) — always show
    // the same "check your email" confirmation.
    await fetch('/api/staff/resend-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {})
    setSending(false)
    setSent(true)
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-xl p-6 shadow-sm space-y-5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        {sent ? (
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--color-accent-subtle)' }}>
              <MailCheck size={22} style={{ color: 'var(--color-accent)' }} />
            </div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Check your email</h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              If <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{email}</span> has a pending invite,
              a fresh link is on its way. Open it and set your password to finish.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--color-surface)' }}>
                <AlertCircle size={22} style={{ color: 'var(--color-text-secondary)' }} />
              </div>
              <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>This link expired</h1>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                Your invite link has expired or was already used. Enter your email and we&apos;ll send a fresh one.
              </p>
            </div>

            <form onSubmit={handleResend} className="space-y-4">
              <div>
                <label htmlFor="resend-email" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Your email</label>
                <input
                  id="resend-email"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 rounded-lg text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                />
              </div>
              <button
                type="submit"
                disabled={sending || !email}
                className="w-full py-2 px-4 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: 'var(--color-accent)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
              >
                {sending ? 'Sending…' : 'Send me a new link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  )
}
