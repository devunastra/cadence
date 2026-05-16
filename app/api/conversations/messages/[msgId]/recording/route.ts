import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ghlFetch } from '@/lib/ghl'
import { getSelectedStudioId } from '@/lib/data-cache'

async function getLocationId(userId: string): Promise<{ locationId: string | null; apiKey?: string } | null> {
  const serviceClient = createServiceClient()
  const selectedStudioId = await getSelectedStudioId()

  let query = serviceClient.from('studios').select('ghl_account_id, ghl_api_key')
  if (selectedStudioId) {
    query = query.eq('id', selectedStudioId)
  } else {
    const { data: memberships } = await serviceClient
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', userId)
      .limit(1)
    const firstStudioId = memberships?.[0]?.studio_id
    if (!firstStudioId) return null
    query = query.eq('id', firstStudioId)
  }

  const { data, error } = await query.single()
  return error ? null : { 
    locationId: data?.ghl_account_id ?? null, 
    apiKey: data?.ghl_api_key ?? undefined 
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ msgId: string }> }
) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user

  const studioData = await getLocationId(user.id)
  if (!studioData?.locationId) return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
  const { locationId, apiKey } = studioData

  const { msgId } = await params

  // GET /conversations/messages/{id}/locations/{locationId}/recording
  const recRes = await ghlFetch(
    `/conversations/messages/${msgId}/locations/${encodeURIComponent(locationId)}/recording`,
    { headers: { Version: '2021-04-15' } },
    apiKey
  )

  if (recRes.ok) {
    const contentType = recRes.headers.get('content-type') ?? ''
    if (contentType.startsWith('audio/') || contentType.includes('octet-stream') || contentType.includes('wav')) {
      const buffer = await recRes.arrayBuffer()
      return new Response(buffer, {
        headers: {
          'Content-Type': contentType || 'audio/mpeg',
          'Cache-Control': 'private, max-age=3600',
        },
      })
    }
    // GHL may return JSON with a redirect URL
    const data = await recRes.json().catch(() => null)
    const recordingUrl: string | null =
      data?.url ?? data?.recordingUrl ?? data?.downloadUrl ?? null
    if (recordingUrl) return NextResponse.json({ recordingUrl })
  }

  console.error('GHL recording fetch failed:', recRes.status, await recRes.text().catch(() => ''))
  return NextResponse.json({ recordingUrl: null }, { status: 200 })
}
