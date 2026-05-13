import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships } from '@/lib/data-cache'
import { SettingsNav } from '@/components/settings/settings-nav'
import type { Role } from '@/lib/types'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const role = (memberships[0]?.role ?? 'studio_staff') as Role

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Page header */}
      <div className="px-5 pt-10 pb-5 flex-shrink-0">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Settings</h1>
        <p className="text-base mt-1" style={{ color: 'var(--color-text-secondary)' }}>Manage your account and preferences</p>
      </div>
      {/* Two-column body */}
      <div className="flex flex-1 min-h-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <SettingsNav role={role} />
        <div className="flex-1 overflow-y-auto">
          <div className="px-8 pt-8 pb-20 max-w-3xl">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
