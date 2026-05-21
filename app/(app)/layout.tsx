import { redirect } from 'next/navigation'
import { ProgressBar } from '@/components/progress-bar'
import { ThemeInitializer } from '@/components/theme-initializer'
import { AppShell } from '@/components/app-shell'
import { StudioProvider } from '@/components/studio-context'
import { getCurrentUser, getMemberships, getSelectedStudioId, getStudios } from '@/lib/data-cache'
import { getUserPreferences } from '@/app/actions'

export async function generateMetadata() {
  const user = await getCurrentUser()
  if (!user) return { title: 'Dashboard' }

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  const selectedStudioId = await getSelectedStudioId()
  const studioIds = memberships.map(m => m.studio_id)
  const studios = await getStudios(isSuper, studioIds)

  const active = studios.find(s => s.id === selectedStudioId) ?? studios[0]
  return { title: active?.name ?? 'Dashboard' }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  const studioIds = memberships.map(m => m.studio_id)

  const [studios, selectedStudioId] = await Promise.all([
    getStudios(isSuper, studioIds),
    getSelectedStudioId(),
  ])

  if (studios.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">No studios assigned to your account. Contact your administrator.</p>
      </div>
    )
  }

  const initialStudio = studios.find(s => s.id === selectedStudioId) ?? studios[0]
  const prefs = await getUserPreferences(initialStudio.id).catch(() => null)

  return (
    <StudioProvider studio={initialStudio} memberships={memberships}>
      <div className="flex h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
        <ThemeInitializer theme={prefs?.theme} />
        <ProgressBar />
        <AppShell
          studios={studios}
          initialStudioId={initialStudio.id}
          initialCollapsed={prefs?.nav_collapsed ?? false}
        >
          {children}
        </AppShell>
      </div>
    </StudioProvider>
  )
}
