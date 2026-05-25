'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast-provider'

export default function AcceptInvitePage() {
  const router = useRouter()
  const { showError } = useToast()
  const [invitedBy, setInvitedBy] = useState<string>('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata
      setInvitedBy(meta?.invited_by ?? 'your administrator')
    })
  }, [])

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
    const { error } = await supabase.auth.updateUser({
      password,
      data: { onboarding_complete: true },
    })

    if (error) {
      showError(error.message)
      setLoading(false)
      return
    }

    router.push('/leads')
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-xl p-6 shadow-sm space-y-5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="text-center">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Set your password</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            You&apos;ve been invited by{' '}
            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {invitedBy || 'your administrator'}
            </span>
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
