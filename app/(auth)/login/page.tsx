'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast-provider'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showError } = useToast()
  const inviteError = searchParams.get('error')
  // Start hidden — show the form only once we've confirmed there's no invite hash.
  const [checkingInvite, setCheckingInvite] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  useEffect(() => {
    if (inviteError === 'invalid_invite') showError('This invite link has expired or already been used. Contact your administrator for a new one.')
    else if (inviteError === 'missing_code') showError('Invalid invite link. Contact your administrator.')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle implicit-flow invite tokens delivered as a URL hash fragment.
  // Supabase appends #access_token=...&type=invite when the project uses
  // implicit (non-PKCE) auth and /auth/callback isn't in the allowed redirect
  // URLs list. The server never sees the hash, so we handle it here.
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) { setCheckingInvite(false); return }
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token') ?? ''
    const type = params.get('type')
    if (accessToken && type === 'invite') {
      const supabase = createClient()
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
        if (!error) {
          router.replace('/accept-invite')
        } else {
          setCheckingInvite(false)
        }
      })
    } else {
      setCheckingInvite(false)
    }
  }, [router])

  if (checkingInvite) return <div className="w-full max-w-sm h-48" />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      showError(error.message)
      setLoading(false)
      return
    }

    router.push('/leads')
    router.refresh()
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { showError('Enter your email address first.'); return }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    })
    setLoading(false)
    if (error) { showError(error.message); return }
    setResetSent(true)
  }

  if (forgotMode) {
    return (
      <div className="w-full max-w-sm">
        <div className="rounded-xl p-6 shadow-sm space-y-5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <div className="text-center">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Reset password</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {resetSent ? 'Check your email for a reset link.' : "Enter your email and we'll send you a reset link."}
            </p>
          </div>

          {!resetSent && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                  placeholder="you@example.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-colors"
                style={{ backgroundColor: 'var(--color-accent)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => { setForgotMode(false); setResetSent(false) }}
            className="w-full text-sm text-center transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-xl p-6 shadow-sm space-y-5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="text-center">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Sign in</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>Studio Management Platform</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="password" className="block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Password
              </label>
              <button
                type="button"
                onClick={() => setForgotMode(true)}
                className="text-xs transition-colors"
                style={{ color: 'var(--color-accent)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent)'}
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 pr-10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] [&::-ms-reveal]:hidden [&::-webkit-contacts-auto-fill-button]:hidden [&::-webkit-credentials-auto-fill-button]:hidden"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-colors"
            style={{ backgroundColor: 'var(--color-accent)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
          No account? Contact your administrator.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm h-48" />}>
      <LoginForm />
    </Suspense>
  )
}
