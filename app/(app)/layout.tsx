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
    // Invited studio owners who haven't created their studio yet belong in the wizard,
    // not this dead-end. Done server-side so it runs on Netlify even if proxy.ts middleware doesn't.
    if (user.user_metadata?.studio_setup_complete === false) {
      redirect('/onboarding')
    }
    // Orphans (logged-in users with no studio_users rows) land on a dedicated
    // page that has a sign-out button and clearer copy. This case is reachable
    // when an admin removes a user's last membership — we deliberately stopped
    // auto-deleting the auth account on last-removal, so orphans need somewhere
    // to land that doesn't dead-end inside the (app) layout.
    redirect('/no-access')
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
