import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getStudios } from '@/lib/data-cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { MyStaffTable } from '@/components/settings/my-staff-table'
import type { Role, StudioUser } from '@/lib/types'

export default async function MyStaffPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const myMembership = memberships[0] ?? null
  const role = (myMembership?.role ?? 'studio_staff') as Role
  if (role === 'studio_staff' || !myMembership) redirect('/settings/my-profile')

  const isSuperAdmin = role === 'super_admin'
  const allStudios = await getStudios(isSuperAdmin, memberships.map(m => m.studio_id))

  const ROLE_ORDER: Record<string, number> = { super_admin: 0, studio_owner: 1, studio_staff: 2 }

  const supabase = await createClient()
  const { data: members } = await supabase
    .from('studio_users')
    .select('*')
    .eq('studio_id', myMembership.studio_id)

  const serviceClient = createServiceClient()
  const userIds = (members ?? []).map(m => m.user_id)

  const emailMap: Record<string, string> = {}
  await Promise.all(
    userIds.map(async (id) => {
      const { data } = await serviceClient.auth.admin.getUserById(id)
      if (data?.user?.email) emailMap[id] = data.user.email
    })
  )

  const membersWithEmail = (members ?? [])
    .map(m => ({ ...(m as StudioUser), email: emailMap[m.user_id] ?? m.user_id }))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99))

  return (
    <MyStaffTable
      studioId={myMembership.studio_id}
      initialMembers={membersWithEmail}
      currentUserId={user.id}
      isSuperAdmin={isSuperAdmin}
      studios={allStudios.map(s => ({ id: s.id, name: s.name }))}
    />
  )
}
