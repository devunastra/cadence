'use client'

import { useRouter } from 'next/navigation'
import { LogOut, ShieldOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function NoAccessPage() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div
      className="w-full max-w-md rounded-xl p-8 text-center"
      style={{
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
      }}
    >
      <div
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-secondary)',
        }}
      >
        <ShieldOff size={26} />
      </div>

      <h1
        className="text-xl font-semibold mb-2"
        style={{ color: 'var(--color-text-primary)' }}
      >
        No studio access
      </h1>

      <p
        className="text-sm mb-6 leading-relaxed"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Your account is signed in, but it isn&rsquo;t assigned to any studio. This usually means your
        access was removed, or you haven&rsquo;t been added yet. Contact your administrator to get
        access — once they add you to a studio, sign back in and you&rsquo;ll be all set.
      </p>

      <button
        type="button"
        onClick={handleSignOut}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
      >
        <LogOut size={16} />
        Sign out
      </button>
    </div>
  )
}
