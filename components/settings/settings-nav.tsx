'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, User, Users, LayoutGrid, LogOut, ScrollText, Activity } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useIsMobile, useMounted } from '@/lib/hooks'
import type { Role } from '@/lib/types'

interface SettingsNavProps {
  role: Role
}

export function SettingsNav({ role }: SettingsNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const mounted = useMounted()
  const isMobile = useIsMobile()
  const showMobile = mounted && isMobile
  const isOwner = role === 'studio_owner' || role === 'super_admin'
  const isSuperAdmin = role === 'super_admin'

  const items = [
    ...(isOwner ? [{ href: '/settings/business-profile', label: 'Business Profile', mobileLabel: 'Business', Icon: Building2 }] : []),
    { href: '/settings/my-profile', label: 'My Profile', mobileLabel: 'Profile', Icon: User },
    ...(isOwner ? [{ href: '/settings/my-staff', label: 'My Staff', mobileLabel: 'Staff', Icon: Users }] : []),
    ...(isOwner ? [{ href: '/settings/studios', label: 'Studios', mobileLabel: 'Studios', Icon: LayoutGrid }] : []),
    ...(isOwner ? [{ href: '/settings/activity-log', label: 'Activity Log', mobileLabel: 'Activity', Icon: ScrollText }] : []),
    ...(isSuperAdmin ? [{ href: '/settings/admin/integrations', label: 'Integration Health', mobileLabel: 'Health', Icon: Activity }] : []),
  ]

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Mobile: horizontal scrollable tab strip (sign out lives in sidebar)
  if (showMobile) {
    return (
      <div className="flex-shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-0">
          {items.map(({ href, mobileLabel }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className="px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap"
                style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
              >
                {mobileLabel}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: 'var(--color-accent)' }} />
                )}
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  // Desktop: vertical sidebar
  return (
    <aside
      className="w-52 flex-shrink-0 flex flex-col h-full"
      style={{ borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--sidebar-bg)' }}
    >
      <div className="p-3 flex-1">
        <nav className="space-y-1">
          {items.map(({ href, label, Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 text-sm rounded-lg leading-none"
                style={{
                  padding: '13px 16px',
                  backgroundColor: active ? 'var(--color-surface-hover)' : 'transparent',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  fontWeight: active ? 600 : 500,
                  transition: `background var(--transition-fast), color var(--transition-fast)`,
                }}
                onMouseEnter={e => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                  }
                }}
              >
                <Icon size={20} className="flex-shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="px-3 pt-2 pb-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 text-sm rounded-lg leading-none"
          style={{
            padding: '13px 16px',
            color: 'var(--color-text-secondary)',
            fontWeight: 500,
            transition: `background var(--transition-fast), color var(--transition-fast)`,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
          }}
        >
          <LogOut size={16} className="flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
