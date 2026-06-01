import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getStudios } from '@/lib/data-cache'
import { StudiosForm } from '@/components/settings/studios-form'

// Server component: fetch studios via getStudios, which uses the service client for
// super_admins (returns ALL studios). A client-side fetch here would be RLS-filtered to
// only the studios the user has a membership row in, hiding other studios from super_admins.
export default async function StudiosPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  const isOwner = isSuper || memberships.some(m => m.role === 'studio_owner')
  if (!isOwner) redirect('/settings/my-profile')

  const studios = await getStudios(isSuper, memberships.map(m => m.studio_id))

  return <StudiosForm initialStudios={studios} isSuperAdmin={isSuper} />
}
