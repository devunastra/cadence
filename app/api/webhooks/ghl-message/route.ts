import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, GENERAL_LIMIT } from '@/lib/rate-limit'

const MESSAGE_EVENTS = new Set([
  'InboundMessage', 'OutboundMessage',
  'inbound_message', 'outbound_message',
  'message.inbound', 'message.outbound',
])

export async function POST(request: NextRequest) {
  // 1. Validate shared secret — accept either header variant GHL uses
  const secret = process.env.GHL_WEBHOOK_SECRET
  const incoming = request.headers.get('x-ghl-webhook-secret')
    ?? request.headers.get('x-ghl-secret')
    ?? request.headers.get('authorization')
  if (!secret || (incoming !== secret && incoming !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Rate limit by IP
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { allowed } = await checkRateLimit(`webhook:ghl-message:${ip}`, GENERAL_LIMIT)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const type = (body.type as string | undefined) ?? ''
  if (!MESSAGE_EVENTS.has(type)) {
    // Not a message event — accept and ignore so GHL doesn't retry
    return NextResponse.json({ ok: true, ignored: true })
  }

  const locationId      = body.locationId as string | undefined
  const conversationId  = body.conversationId as string | undefined
  const messageId       = (body.id ?? body.messageId) as string | undefined

  if (!locationId || !conversationId || !messageId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // 3. Resolve studio from GHL location ID
  const { data: studio } = await supabase
    .from('studios')
    .select('id')
    .eq('ghl_account_id', locationId)
    .single()

  if (!studio) {
    // Unknown location — return 200 so GHL stops retrying
    return NextResponse.json({ ok: true })
  }

  // 4. Parse message fields — GHL payload shape varies by webhook version
  const contact = body.contact as Record<string, unknown> | undefined
  const firstName    = (contact?.firstName as string) ?? ''
  const lastName     = (contact?.lastName  as string) ?? ''
  let contactName    = ((contact?.name as string) || [firstName, lastName].filter(Boolean).join(' ')) || null
  const contactId    = (body.contactId as string) ?? (contact?.id as string) ?? null

  // If GHL didn't send a name (common for outbound messages), try to find it in our leads table
  if (!contactName && contactId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('name')
      .eq('ghl_contact_id', contactId)
      .maybeSingle()
    if (lead?.name) contactName = lead.name
  }

  const direction    = (body.direction   as string) ?? (type.toLowerCase().includes('inbound') ? 'inbound' : 'outbound')
  const messageBody  = (body.message     as string) ?? (body.body        as string) ?? null
  const messageType  = (body.messageType as string) ?? 'SMS'
  const dateAdded    = (body.dateAdded   as string) ?? new Date().toISOString()
  const status       = (body.status      as string) ?? null
  const appointmentId = (body.appointmentId as string) ?? (body.appointment_id as string) ?? null

  // 5. Upsert conversation — update last message info, preserve existing contact_name if incoming is null
  const convPayload: Record<string, unknown> = {
    id:                conversationId,
    studio_id:         studio.id,
    contact_id:        contactId,
    last_message_body: messageBody,
    last_message_date: dateAdded,
    unread_count:      0,
    type:              messageType,
    updated_at:        new Date().toISOString(),
  }
  // Only write contact fields if GHL actually sent them — never overwrite with null
  if (contactName)                     convPayload.contact_name = contactName
  if (contact?.email as string)        convPayload.email = contact?.email as string
  if (contact?.phone as string)        convPayload.phone = contact?.phone as string

  const { error: convErr } = await supabase
    .from('conversations')
    .upsert(convPayload, { onConflict: 'id' })

  if (convErr) {
    console.error('[ghl-message] Failed to upsert conversation:', convErr)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Increment unread_count atomically for inbound messages
  if (direction === 'inbound') {
    await supabase.rpc('increment_conversation_unread', { conv_id: conversationId })
  }

  // 6. Insert message — ignore if already received (idempotent)
  const { error: msgErr } = await supabase
    .from('messages')
    .upsert(
      {
        id:              messageId,
        conversation_id: conversationId,
        studio_id:       studio.id,
        direction,
        body:            messageBody,
        date_added:      dateAdded,
        message_type:    messageType,
        status,
        appointment_id:  appointmentId,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )

  if (msgErr) {
    console.error('[ghl-message] Failed to insert message:', msgErr)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // 7. Middle-man linking: If this is an appointment activity but appointment_id is missing, 
  // find the most recent appointment for this contact and link it.
  if (!appointmentId && messageType.toLowerCase().includes('appointment') && contactId) {
    const { data: latestAppt } = await supabase
      .from('appointments')
      .select('id')
      .eq('contact_id', contactId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (latestAppt) {
      await supabase
        .from('messages')
        .update({ appointment_id: latestAppt.id })
        .eq('id', messageId)
    }
  }

  return NextResponse.json({ ok: true })
}

// GHL health-check ping
export async function GET() {
  return NextResponse.json({ ok: true })
}
