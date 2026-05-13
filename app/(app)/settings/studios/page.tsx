import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getStudios } from '@/lib/data-cache'
import { StudiosForm } from '@/components/settings/studios-form'
import type { Studio } from '@/lib/types'

export default async function StudiosPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuperAdmin = memberships.some(m => m.role === 'super_admin')
  const isOwner = memberships.some(m => m.role === 'studio_owner')
  if (!isSuperAdmin && !isOwner) redirect('/settings/my-profile')

  const studios = await getStudios(isSuperAdmin, memberships.map(m => m.studio_id))

  return <StudiosForm initialStudios={studios as Studio[]} />
}
