'use client'

import { useCurrentStudio } from '@/components/studio-context'
import { SettingsNav } from '@/components/settings/settings-nav'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { userRole } = useCurrentStudio()

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Page header */}
      <div className="px-5 pt-10 pb-5 flex-shrink-0">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Settings</h1>
        <p className="text-base mt-1" style={{ color: 'var(--color-text-secondary)' }}>Manage your account and preferences</p>
      </div>
      {/* Two-column body */}
      <div className="flex flex-1 min-h-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <SettingsNav role={userRole} />
        <div className="flex-1 overflow-y-auto">
          <div className="px-8 pt-8 pb-20 max-w-3xl">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
