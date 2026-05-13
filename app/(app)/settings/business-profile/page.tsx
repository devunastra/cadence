import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getSelectedStudioId, getStudios } from '@/lib/data-cache'
import { BusinessProfileForm } from '@/components/settings/business-profile-form'
import type { Studio, Role } from '@/lib/types'

export default async function BusinessProfilePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  const topRole: Role = isSuper ? 'super_admin' : (memberships[0]?.role ?? 'studio_staff') as Role
  if (topRole === 'studio_staff') redirect('/settings/my-profile')

  const studioIds = memberships.map(m => m.studio_id)
  const [studios, selectedStudioId] = await Promise.all([
    getStudios(isSuper, studioIds),
    getSelectedStudioId(),
  ])

  const studio = studios.find(s => s.id === selectedStudioId) ?? studios[0]
  if (!studio) redirect('/leads')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Business Profile</h2>
        <p className="text-base" style={{ color: 'var(--color-text-secondary)' }}>Manage your studio details and integration credentials.</p>
      </div>
      <BusinessProfileForm studio={studio as Studio} />
    </div>
  )
}
