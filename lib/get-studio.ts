import { createServiceClient } from '@/lib/supabase/server'
import { getSelectedStudioId } from '@/lib/data-cache'

/** Resolve the active studio's GHL credentials for the given user. Server-side only. */
export async function getStudio(userId: string) {
  const serviceClient = createServiceClient()
  const selectedStudioId = await getSelectedStudioId()

  let studioQuery = serviceClient.from('studios').select('id, ghl_account_id, ghl_api_key')

  if (selectedStudioId) {
    studioQuery = studioQuery.eq('id', selectedStudioId)
  } else {
    const { data: memberships } = await serviceClient
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', userId)
      .limit(1)
    const firstStudioId = memberships?.[0]?.studio_id
    if (!firstStudioId) return null
    studioQuery = studioQuery.eq('id', firstStudioId)
  }

  const { data: studio, error } = await studioQuery.single()
  return error ? null : studio
}
