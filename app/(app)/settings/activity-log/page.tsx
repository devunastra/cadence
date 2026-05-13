import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getSelectedStudioId, getStudios } from '@/lib/data-cache'
import { getActivityLogs } from '@/app/actions'
import { ActivityLogTable } from '@/components/settings/activity-log-table'
import type { Role } from '@/lib/types'

export default async function ActivityLogPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  const studioIds = memberships.map(m => m.studio_id)

  const [studios, selectedStudioId] = await Promise.all([
    getStudios(isSuper, studioIds),
    getSelectedStudioId(),
  ])

  const initialStudio = studios.find(s => s.id === selectedStudioId) ?? studios[0]
  const role = (memberships.find(m => m.studio_id === initialStudio?.id)?.role ?? 'studio_staff') as Role

  const logs = initialStudio ? await getActivityLogs(initialStudio.id).catch(() => []) : []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Activity Log</h2>
        <p className="text-base" style={{ color: 'var(--color-text-secondary)' }}>A record of all lead table activity for this studio.</p>
      </div>

      <ActivityLogTable
        initialLogs={logs}
        studioId={initialStudio?.id ?? ''}
        role={role}
      />
    </div>
  )
}
