import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getStudios } from '@/lib/data-cache'
import { createServiceClient } from '@/lib/supabase/server'
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
  const studioNameMap: Record<string, string> = Object.fromEntries(allStudios.map(s => [s.id, s.name]))
  const scopeStudioIds = allStudios.map(s => s.id)

  const ROLE_ORDER: Record<string, number> = { super_admin: 0, studio_owner: 1, studio_staff: 2 }

  // One row per membership across every studio the viewer can see
  // (super_admin: all studios; owner: their own studios). Uses the service client so a
  // super_admin can read memberships for studios they have no row in — RLS would hide those.
  // Scoping stays correct because scopeStudioIds is already limited per role (getStudios).
  const serviceClient = createServiceClient()
  const { data: members } = await serviceClient
    .from('studio_users')
    .select('*')
    .in('studio_id', scopeStudioIds)

  const uniqueUserIds = Array.from(new Set((members ?? []).map(m => m.user_id)))

  const emailMap: Record<string, string> = {}
  await Promise.all(
    uniqueUserIds.map(async (id) => {
      const { data } = await serviceClient.auth.admin.getUserById(id)
      if (data?.user?.email) emailMap[id] = data.user.email
    })
  )

  const membersWithEmail = (members ?? [])
    .map(m => ({
      ...(m as StudioUser),
      email: emailMap[m.user_id] ?? m.user_id,
      studio_name: studioNameMap[m.studio_id] ?? '—',
    }))
    .sort((a, b) =>
      a.studio_name.localeCompare(b.studio_name) ||
      (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99) ||
      a.email.localeCompare(b.email)
    )

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
