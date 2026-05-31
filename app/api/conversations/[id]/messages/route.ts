import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ghlFetch } from '@/lib/ghl'
import { checkRateLimit, MESSAGE_LIMIT } from '@/lib/rate-limit'
import { getSelectedStudioId } from '@/lib/data-cache'

async function validateUserAndGetApiKey() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { user: null, apiKey: undefined, tz: 'America/Chicago' }
  const user = session.user

  const serviceClient = createServiceClient()
  const selectedStudioId = await getSelectedStudioId()

  let studioQuery = serviceClient.from('studios').select('id, ghl_api_key, timezone')

  if (selectedStudioId) {
    studioQuery = studioQuery.eq('id', selectedStudioId)
  } else {
    const { data: memberships } = await serviceClient
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', user.id)
      .limit(1)
    const firstStudioId = memberships?.[0]?.studio_id
    if (!firstStudioId) return { user, apiKey: undefined, tz: 'America/Chicago' }
    studioQuery = studioQuery.eq('id', firstStudioId)
  }

  const { data: studio } = await studioQuery.single()
  return {
    user,
    apiKey: studio?.ghl_api_key ?? undefined,
    tz: studio?.timezone ?? 'America/Chicago',
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, apiKey, tz } = await validateUserAndGetApiKey()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  // Support lastMessageId cursor for loading older messages
  const lastMessageId = req.nextUrl.searchParams.get('lastMessageId')
  let ghlUrl = `/conversations/${id}/messages?limit=50`
  if (lastMessageId) ghlUrl += `&lastMessageId=${encodeURIComponent(lastMessageId)}`

  const res = await ghlFetch(ghlUrl, {}, apiKey)

  if (!res.ok) {
    const text = await res.text()
    console.error('GHL messages error:', res.status, text)
    return NextResponse.json({ error: 'GHL API error', details: text }, { status: res.status })
  }

  const data = await res.json()
  // GHL nests messages: { messages: { messages: [...], lastMessageId, ... } }
  const msgs: Record<string, unknown>[] = Array.isArray(data.messages)
    ? data.messages
    : Array.isArray(data.messages?.messages)
      ? data.messages.messages
      : []
  const nextCursor: string | null = data.messages?.lastMessageId ?? null

  // Enrich appointment activity messages with the verb + time from the matching appointment_event.
  // Each chip is a historical snapshot — matched to the event whose created_at is closest to
  // the chip's dateAdded (within a 5-minute window). This preserves history across reschedules.
  const apptMsgs = msgs.filter(
    m => typeof m.messageType === 'string' && m.messageType.toLowerCase().includes('appointment')
  )

  if (apptMsgs.length > 0) {
    const supabase = createServiceClient()
    const apptMsgIds = apptMsgs.map(m => m.id as string).filter(Boolean)

    // Step 1: get appointment_id stored on each message row
    const { data: msgRows } = await supabase
      .from('messages')
      .select('id, appointment_id')
      .in('id', apptMsgIds)

    const msgRowById = Object.fromEntries((msgRows ?? []).map(r => [r.id, r]))

    const linkedApptIds = [...new Set(
      (msgRows ?? []).map(r => r.appointment_id).filter(Boolean) as string[]
    )]

    // Step 2: also get the conversation's contact_id for fallback matching
    const { data: convRow } = await supabase
      .from('conversations')
      .select('contact_id')
      .eq('id', id)
      .single()
    const contactId = convRow?.contact_id ?? null

    // Step 3: fetch all appointment_events for linked appointment_ids + by contact_id (fallback)
    type ApptEvent = { appointment_id: string; verb: string; new_start_time: string | null; created_at: string }
    let allEvents: ApptEvent[] = []
    {
      // Primary: events for known appointment_ids
      const queries: Promise<ApptEvent[]>[] = []
      if (linkedApptIds.length > 0) {
        queries.push(
          Promise.resolve(
            supabase
              .from('appointment_events')
              .select('appointment_id, verb, new_start_time, created_at')
              .in('appointment_id', linkedApptIds)
              .order('created_at', { ascending: true })
          ).then(({ data }) => (data ?? []) as ApptEvent[])
        )
      }
      // Fallback: all events for this contact (catches chips whose messages.appointment_id is null)
      if (contactId) {
        queries.push(
          Promise.resolve(
            supabase
              .from('appointment_events')
              .select('appointment_id, verb, new_start_time, created_at')
              .eq('contact_id', contactId)
              .order('created_at', { ascending: true })
          ).then(({ data }) => (data ?? []) as ApptEvent[])
        )
      }
      const results = await Promise.all(queries)
      // Merge and deduplicate by (appointment_id + created_at)
      const seen = new Set<string>()
      for (const batch of results) {
        for (const ev of batch) {
          const key = `${ev.appointment_id}|${ev.created_at}`
          if (!seen.has(key)) { seen.add(key); allEvents.push(ev) }
        }
      }
    }

    // Step 4: match each chip to its appointment_event.
    // Strategy: find the event whose created_at is closest to AND at-or-after the chip's dateAdded.
    // This preserves history — each chip shows the state at the moment it was created, not the
    // current state. If no event falls after the chip, fall back to the closest overall.
    // For fallback (no apptId): restrict to ±5 min to avoid cross-appointment contamination.
    function findMatchingEvent(apptId: string | null, chipDateAdded: string): ApptEvent | null {
      const chipMs = new Date(chipDateAdded).getTime()
      const candidates = apptId
        ? allEvents.filter(e => e.appointment_id === apptId)
        // Contact-id fallback: only match 'Created' events — prevents a nearby Deleted/Updated
        // event from a different appointment contaminating a freshly created chip with no linked apptId.
        : allEvents.filter(e =>
            Math.abs(new Date(e.created_at).getTime() - chipMs) < 1 * 60 * 1000
          )

      // Prefer the earliest event that is at-or-after the chip (i.e. the action that caused this chip)
      const afterChip = candidates
        .filter(e => new Date(e.created_at).getTime() >= chipMs - 30_000) // 30s grace for near-simultaneous
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      if (afterChip.length > 0) return afterChip[0]

      // Fallback: closest event overall (handles events that arrived before the chip)
      let best: ApptEvent | null = null
      let bestDiff = Infinity
      for (const ev of candidates) {
        const diff = Math.abs(new Date(ev.created_at).getTime() - chipMs)
        if (diff < bestDiff) { bestDiff = diff; best = ev }
      }
      return best
    }

    function formatTime(iso: string): string {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
        timeZone: tz,
      })
    }

    function buildLabel(verb: string, ev: ApptEvent): string {
      if (verb === 'Updated' && ev.new_start_time) {
        return `${verb} for ${formatTime(ev.new_start_time)}`
      }
      return verb
    }

    for (const msg of apptMsgs) {
      const msgRow = msgRowById[msg.id as string]
      const apptId = msgRow?.appointment_id ?? null
      if (apptId) msg.appointment_id = apptId

      const ev = findMatchingEvent(apptId, msg.dateAdded as string)
      if (ev) {
        if (!apptId) msg.appointment_id = ev.appointment_id  // backfill from matched event
        msg.status = buildLabel(ev.verb, ev)
      }
    }
  }

  return NextResponse.json({ messages: msgs, nextCursor, hasMore: msgs.length >= 50 })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, apiKey } = await validateUserAndGetApiKey()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit by user
  const { allowed } = await checkRateLimit(`send-message:${user.id}`, MESSAGE_LIMIT)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { id } = await params

  let body: { message: string; type: 'SMS' | 'Email'; contactId?: string; subject?: string; emailTo?: string; htmlBody?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  const payload: Record<string, unknown> = {
    type: body.type === 'Email' ? 'Email' : 'SMS',
    conversationId: id,
    contactId: body.contactId,
    message: body.message.trim(),
  }

  if (body.type === 'Email') {
    payload.subject = body.subject?.trim() || '(no subject)'
    payload.emailTo = body.emailTo
    // Send the HTML from the editor directly — no wrapper added here
    payload.html = body.htmlBody ?? body.message.trim()
  }

  const res = await ghlFetch('/conversations/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, apiKey)

  if (!res.ok) {
    const text = await res.text()
    console.error('GHL send message error:', res.status, text)
    return NextResponse.json({ error: 'GHL API error', details: text }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({ ok: true, messageId: data.messageId })
}
