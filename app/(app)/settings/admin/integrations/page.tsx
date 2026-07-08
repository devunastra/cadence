import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships } from '@/lib/data-cache'
import { IntegrationsHealthShell } from '@/components/settings/admin/integrations-health-shell'

export default async function AdminIntegrationsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  if (!isSuper) redirect('/settings/my-profile')

  return <IntegrationsHealthShell />
}
