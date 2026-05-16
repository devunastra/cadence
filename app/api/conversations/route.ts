import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ghlFetch } from '@/lib/ghl'
import { getSelectedStudioId } from '@/lib/data-cache'

async function getStudio(userId: string) {
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

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user

  const studio = await getStudio(user.id)
  if (!studio) return NextResponse.json({ error: 'Studio not found' }, { status: 404 })

  const { searchParams } = req.nextUrl
  const startAfterDate  = searchParams.get('startAfterDate')
  const startAfterId    = searchParams.get('startAfterId')
  const q               = searchParams.get('q')?.trim()
  const status          = searchParams.get('status')
  const contactIdsParam = searchParams.get('contactIds')

  // Search by contact IDs: fan out one GHL request per contact ID in parallel
  if (contactIdsParam) {
    const ids = contactIdsParam.split(',').filter(Boolean).slice(0, 20)
    const results = await Promise.all(
      ids.map(contactId =>
        ghlFetch(`/conversations/search?locationId=${studio.ghl_account_id}&contactId=${encodeURIComponent(contactId)}&limit=1`, {}, studio.ghl_api_key ?? undefined)
          .then(r => r.ok ? r.json() : null)
          .then(d => d?.conversations?.[0] ?? null)
          .catch(() => null)
      )
    )
    const conversations = results.filter(Boolean)
    return NextResponse.json({ conversations, hasMore: false, studioId: studio.id, locationId: studio.ghl_account_id })
  }

  let ghlUrl = `/conversations/search?locationId=${studio.ghl_account_id}&limit=25&sortBy=last_message_date&sortOrder=desc`
  if (status && status !== 'all') {
    ghlUrl += `&status=${encodeURIComponent(status)}`
  }
  if (q) {
    ghlUrl += `&q=${encodeURIComponent(q)}` 
  }
  if (startAfterDate) ghlUrl += `&startAfterDate=${encodeURIComponent(startAfterDate)}`
  if (startAfterId)   ghlUrl += `&startAfterId=${encodeURIComponent(startAfterId)}`

  const res = await ghlFetch(ghlUrl, {}, studio.ghl_api_key ?? undefined)

  if (!res.ok) {
    const text = await res.text()
    console.error('GHL conversations error:', res.status, text)
    return NextResponse.json({ error: 'GHL API error', details: text }, { status: res.status })
  }

  const data = await res.json()
  const conversations: Record<string, unknown>[] = data.conversations ?? []
  const total = data.total ?? data.totalCount ?? 0

  // GHL sometimes omits contactName/fullName for outbound-only threads.
  // Enrich missing names from our conversations table which is populated by the webhook.
  const missingNameIds = conversations
    .filter(c => !c.contactName && !c.fullName)
    .map(c => c.id as string)
    .filter(Boolean)

  if (missingNameIds.length > 0) {
    const serviceClient = createServiceClient()
    const { data: rows } = await serviceClient
      .from('conversations')
      .select('id, contact_name')
      .in('id', missingNameIds)

    if (rows && rows.length > 0) {
      const nameById = Object.fromEntries(rows.map(r => [r.id, r.contact_name]))
      for (const conv of conversations) {
        const name = nameById[conv.id as string]
        if (name) conv.contactName = name
      }
    }
  }

  return NextResponse.json({
    conversations,
    hasMore: data.hasMore ?? (conversations.length >= 25), // GHL sometimes returns hasMore, otherwise we assume if >= 25
    total,
    studioId: studio.id,
    locationId: studio.ghl_account_id,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user

  let body: { contactId: string; contactName?: string; phone?: string | null; email?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.contactId) return NextResponse.json({ error: 'contactId is required' }, { status: 400 })

  const studio = await getStudio(user.id)
  if (!studio) return NextResponse.json({ error: 'Studio not found' }, { status: 404 })

  function mapConv(conv: Record<string, unknown>) {
    return {
      id:              conv.id              as string,
      contactId:       (conv.contactId      as string) ?? body.contactId,
      contactName:     (conv.contactName    as string) ?? (conv.fullName as string) ?? body.contactName ?? '',
      email:           (conv.email          as string | null) ?? body.email    ?? null,
      phone:           (conv.phone          as string | null) ?? body.phone    ?? null,
      lastMessageBody: (conv.lastMessageBody as string | null) ?? null,
      lastMessageDate: (conv.lastMessageDate as string | null) ?? null,
      lastMessageType: (conv.lastMessageType as string | null) ?? null,
      unreadCount:     (conv.unreadCount    as number) ?? 0,
      type:            (conv.type           as string) ?? 'SMS',
      starred:         (conv.starred        as boolean) ?? false,
    }
  }

  // Step 1: look for an existing conversation for this contact
  const searchRes = await ghlFetch(
    `/conversations/search?locationId=${studio.ghl_account_id}&contactId=${encodeURIComponent(body.contactId)}&limit=1`,
    {}, studio.ghl_api_key ?? undefined
  )
  if (searchRes.ok) {
    const searchData = await searchRes.json()
    const existing = searchData.conversations?.[0]
    if (existing) return NextResponse.json({ conversation: mapConv(existing) })
  }

  // Step 2: no existing conversation — attempt to create one
  const createRes = await ghlFetch('/conversations/', {
    method: 'POST',
    body: JSON.stringify({ contactId: body.contactId, locationId: studio.ghl_account_id }),
  }, studio.ghl_api_key ?? undefined)

  if (!createRes.ok) {
    const text = await createRes.text()
    console.error('GHL create conversation error:', createRes.status, text)
    // Friendly fallback: contact exists in GHL but has no conversation yet
    return NextResponse.json(
      { error: `Could not create conversation (GHL ${createRes.status}). Try sending them a message from GHL first.` },
      { status: createRes.status }
    )
  }

  const data = await createRes.json()
  const conv = (data.conversation ?? data) as Record<string, unknown>
  return NextResponse.json({ conversation: mapConv(conv) })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user

  const studio = await getStudio(user.id)
  if (!studio) return NextResponse.json({ error: 'Studio not found' }, { status: 404 })

  let body: { conversationId: string; starred?: boolean; unreadCount?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.conversationId) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.starred !== undefined) patch.starred = body.starred
  if (body.unreadCount !== undefined) patch.unreadCount = body.unreadCount

  const res = await ghlFetch(`/conversations/${body.conversationId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  }, studio.ghl_api_key ?? undefined)

  if (!res.ok) {
    const text = await res.text()
    console.error('GHL update conversation error:', res.status, text)
    return NextResponse.json({ error: 'GHL API error', details: text }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({ success: true, conversation: data.conversation })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user

  const studio = await getStudio(user.id)
  if (!studio) return NextResponse.json({ error: 'Studio not found' }, { status: 404 })

  let body: { conversationId: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.conversationId) return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })

  const res = await ghlFetch(`/conversations/${body.conversationId}`, { method: 'DELETE' }, studio.ghl_api_key ?? undefined)

  if (!res.ok) {
    const text = await res.text()
    console.error('GHL delete conversation error:', res.status, text)
    return NextResponse.json({ error: 'GHL API error', details: text }, { status: res.status })
  }

  return NextResponse.json({ success: true })
}

