import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>

export async function POST(req: Request) {
  const secret = process.env.GHL_WEBHOOK_SECRET
  if (!secret) {
    console.error('[ghl-appointment] GHL_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const incoming = req.headers.get('x-ghl-secret') ?? req.headers.get('authorization')
  if (incoming !== secret && incoming !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // GHL Workflow webhooks use a nested structure:
  //   payload.location.id       → locationId
  //   payload.customData        → our custom key-value fields
  //   payload.triggerData       → appointment trigger data
  //   payload.calendar          → calendar object
  //   payload.contact_id        → contact id (top-level)
  //   payload.full_name         → contact name (top-level)

  const custom: Payload    = payload.customData    ?? {}
  const trigger: Payload   = payload.triggerData   ?? {}
  const calendar: Payload  = payload.calendar      ?? {}
  const location: Payload  = payload.location      ?? {}

  const locationId = location.id ?? payload.locationId ?? payload.location_id ?? null
  const id = custom.appointment_id ?? trigger.id ?? payload.id ?? null

  if (!id || !locationId) {
    console.error('[ghl-appointment] Missing id or locationId', {
      id, locationId,
      customKeys: Object.keys(custom),
      triggerKeys: Object.keys(trigger),
      topKeys: Object.keys(payload),
    })
    return NextResponse.json({ error: 'Missing id or locationId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: studio } = await supabase
    .from('studios')
    .select('id')
    .eq('ghl_account_id', locationId)
    .single()

  if (!studio) {
    return NextResponse.json({ ok: true }) // Unknown location — ignore
  }

  // Resolve status early so we can handle cancellation/deletion
  const status = custom.appointment_status ?? trigger.appointmentStatus ?? trigger.status ?? null

  // Hard delete / explicit delete event — soft-delete the row
  if (payload.type === 'AppointmentDelete' || status === 'deleted') {
    const contactId = payload.contact_id ?? null
    const contactName = payload.full_name ?? payload.contact_full_name ?? null
    await Promise.all([
      supabase.from('appointments').update({
        deleted_at: new Date().toISOString(),
        status: 'deleted',
        updated_at: new Date().toISOString(),
      }).eq('id', id),
      supabase.from('appointment_events').insert({
        studio_id: studio.id,
        appointment_id: id,
        contact_id: contactId,
        verb: 'Deleted',
      }),
      supabase.from('activity_logs').insert({
        studio_id:   studio.id,
        lead_name:   contactName,
        actor_email: null,
        event_type:  'appointment_deleted',
        source:      'ghl',
      }),
    ])
    return NextResponse.json({ ok: true })
  }

  // Partial update — update start_time + recalculate end_time (from n8n reschedule workflow)
  if (payload.type === 'AppointmentReschedule') {
    const newStartTime = payload.start_time ?? null
    const contactId = payload.contact_id ?? null
    const contactName = payload.full_name ?? payload.contact_full_name ?? null
    if (newStartTime) {
      const newEndTime = new Date(new Date(newStartTime + 'Z').getTime() + 45 * 60 * 1000)
        .toISOString()
        .substring(0, 19)
      await Promise.all([
        supabase.from('appointments')
          .update({ start_time: newStartTime, end_time: newEndTime, updated_at: new Date().toISOString() })
          .eq('id', id),
        supabase.from('appointment_events').insert({
          studio_id: studio.id,
          appointment_id: id,
          contact_id: contactId,
          verb: 'Updated',
          new_start_time: new Date(newStartTime + 'Z').toISOString(),
        }),
        supabase.from('activity_logs').insert({
          studio_id:   studio.id,
          lead_name:   contactName,
          actor_email: null,
          event_type:  'appointment_rescheduled',
          source:      'ghl',
          changes:     [{ field: 'start_time', old_value: null, new_value: newStartTime }],
        }),
      ])
    }
    return NextResponse.json({ ok: true })
  }

  const row = {
    id,
    studio_id:          studio.id,
    title:              custom.appointment_title       ?? trigger.title        ?? null,
    start_time:         custom.appointment_start_time  ?? trigger.startTime    ?? trigger.start_time ?? null,
    end_time:           custom.appointment_end_time    ?? trigger.endTime      ?? trigger.end_time   ?? null,
    status,
    calendar_id:        custom.appointment_calendar_id ?? calendar.id          ?? null,
    calendar_name:      calendar.name                  ?? null,
    contact_id:         payload.contact_id             ?? null,
    contact_name:       payload.full_name              ?? payload.contact_full_name ?? null,
    assigned_user_id:   payload.user?.id               ?? null,
    assigned_user_name: payload.user?.name             ?? null,
    notes:              custom.appointment_notes       ?? trigger.notes        ?? null,
    address:            trigger.address                ?? payload.full_address ?? null,
    updated_at:         new Date().toISOString(),
  }

  const { error } = await supabase.from('appointments').upsert(row, { onConflict: 'id' })
  if (error) {
    console.error('[ghl-appointment webhook]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Determine verb for this event
  const statusValue = status?.toLowerCase()
  const verb =
    payload.type === 'AppointmentUpdate' ? 'Updated' :
    payload.type === 'AppointmentStatusUpdate' ? (
      statusValue === 'noshow'    ? 'No Show' :
      statusValue === 'showed'    ? 'Showed' :
      statusValue === 'confirmed' ? 'Confirmed' :
      statusValue === 'invalid'   ? 'Invalid' :
      statusValue === 'cancelled' ? 'Cancelled' :
      'Updated'
    ) :
    'Created'

  const activityEventType =
    payload.type === 'AppointmentUpdate'       ? 'appointment_updated'     :
    payload.type === 'AppointmentStatusUpdate' ? 'appointment_updated'     :
    'appointment_created'

  // Emit appointment event (drives real-time chip update in conversations UI)
  await supabase.from('appointment_events').insert({
    studio_id: studio.id,
    appointment_id: id,
    contact_id: row.contact_id ?? null,
    verb,
    new_start_time: row.start_time ?? null,
  })

  supabase.from('activity_logs').insert({
    studio_id:   studio.id,
    lead_name:   row.contact_name ?? null,
    actor_email: null,
    event_type:  activityEventType,
    source:      'ghl',
  }).then(() => {}, () => {})

  // Middle-man linking: link the appointment activity message closest to now to this appointment.
  // We look for a chip within ±5 minutes of the current time that has no appointment_id yet.
  if (row.contact_id) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', row.contact_id)
      .limit(1)
      .single()

    if (conv) {
      const now = new Date().toISOString()
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      // Prefer a recent unlinked chip; fall back to the most recent chip of any state
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conv.id)
        .ilike('message_type', '%appointment%')
        .is('appointment_id', null)
        .gte('date_added', fiveMinAgo)
        .lte('date_added', now)
        .order('date_added', { ascending: false })
        .limit(1)
        .single()

      const { data: fallbackMsg } = recentMsg ? { data: null } : await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conv.id)
        .ilike('message_type', '%appointment%')
        .order('date_added', { ascending: false })
        .limit(1)
        .single()

      const msg = recentMsg ?? fallbackMsg
      if (msg) {
        await supabase
          .from('messages')
          .update({ appointment_id: id })
          .eq('id', msg.id)
      }
    }
  }

  return NextResponse.json({ ok: true })
}

// GHL health-check
export async function GET() {
  return NextResponse.json({ ok: true })
}
