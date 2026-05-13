import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ghlFetch } from '@/lib/ghl'
import { getSelectedStudioId } from '@/lib/data-cache'

async function getStudio(userId: string) {
  const supabase = await createClient()
  const serviceClient = createServiceClient()
  const selectedStudioId = await getSelectedStudioId()

  let studioQuery = serviceClient.from('studios').select('id, ghl_account_id, ghl_api_key')

  if (selectedStudioId) {
    studioQuery = studioQuery.eq('id', selectedStudioId)
  } else {
    const { data: memberships } = await supabase
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

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const studio = await getStudio(user.id)
  if (!studio) return NextResponse.json({ error: 'Studio not found' }, { status: 404 })

  const res = await ghlFetch(`/conversations/search?locationId=${studio.ghl_account_id}&limit=1&status=unread`, {}, studio.ghl_api_key ?? undefined)

  if (!res.ok) {
    const text = await res.text()
    console.error('GHL unread count error:', res.status, text)
    return NextResponse.json({ error: 'GHL API error', details: text }, { status: res.status })
  }

  const data = await res.json()
  const total = data.total ?? data.totalCount ?? 0

  return NextResponse.json({ total })
}
