import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships } from '@/lib/data-cache'

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const role = memberships[0]?.role ?? 'studio_staff'
  const isOwner = role === 'studio_owner' || role === 'super_admin'

  redirect(isOwner ? '/settings/business-profile' : '/settings/my-profile')
}
