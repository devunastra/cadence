import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getSelectedStudioId, getStudios } from '@/lib/data-cache'
import { createClient } from '@/lib/supabase/server'
import { MyProfileForm } from '@/components/settings/my-profile-form'
import { getUserPreferences } from '@/app/actions'

export default async function MyProfilePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  const studioIds = memberships.map(m => m.studio_id)

  const [supabase, studios, selectedStudioId] = await Promise.all([
    createClient(),
    getStudios(isSuper, studioIds),
    getSelectedStudioId(),
  ])

  const initialStudio = studios.find(s => s.id === selectedStudioId) ?? studios[0]
  const [membership, prefs] = await Promise.all([
    supabase.from('studio_users').select('avatar_url').eq('user_id', user.id).limit(1).maybeSingle(),
    initialStudio ? getUserPreferences(initialStudio.id).catch(() => null) : Promise.resolve(null),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>My Profile</h2>
        <p className="text-base" style={{ color: 'var(--color-text-secondary)' }}>Manage your account, appearance, and notification preferences.</p>
      </div>
      <MyProfileForm
        email={user.email ?? ''}
        avatarUrl={membership.data?.avatar_url ?? null}
        notifyCreated={prefs?.notify_lead_created ?? true}
        notifyUpdated={prefs?.notify_lead_updated ?? true}
        notifyDeleted={prefs?.notify_lead_deleted ?? true}
      />
    </div>
  )
}
