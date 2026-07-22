import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships } from '@/lib/data-cache'
import { IntegrationsHealthShell } from '@/components/settings/admin/integrations-health-shell'

// studio_owner scoped view. super_admin is redirected to the cross-studio
// /settings/admin/integrations page since their scope is agency-wide, not
// per-membership.
export default async function OwnerIntegrationsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  if (isSuper) redirect('/settings/admin/integrations')
  const isOwner = memberships.some(m => m.role === 'studio_owner')
  if (!isOwner) redirect('/settings/my-profile')

  return <IntegrationsHealthShell scope="own" />
}
