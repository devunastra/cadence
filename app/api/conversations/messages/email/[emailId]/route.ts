import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ghlFetch } from '@/lib/ghl'
import { createServiceClient } from '@/lib/supabase/server'
import { getSelectedStudioId } from '@/lib/data-cache'

async function getApiKey(userId: string) {
  const supabase = await createClient()
  const serviceClient = createServiceClient()
  const selectedStudioId = await getSelectedStudioId()

  let query = serviceClient.from('studios').select('ghl_api_key')
  if (selectedStudioId) {
    query = query.eq('id', selectedStudioId)
  } else {
    const { data: memberships } = await supabase.from('studio_users').select('studio_id').eq('user_id', userId).limit(1)
    const firstStudioId = memberships?.[0]?.studio_id
    if (!firstStudioId) return undefined
    query = query.eq('id', firstStudioId)
  }
  const { data } = await query.single()
  return data?.ghl_api_key ?? undefined
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ emailId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { emailId } = await params
  const apiKey = await getApiKey(user.id)
  const res = await ghlFetch(`/conversations/messages/email/${emailId}`, {}, apiKey)

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: 'GHL API error', details: text }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json(data.emailMessage ?? data)
}
