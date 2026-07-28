import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAvailabilityForDate, toNaiveLocal } from '@/lib/appointment-availability'
import { addMinutesNaive } from '@/lib/appointment-booking'
import { checkSecret, resolveLocalStudio, isValidDate } from '../_auth'

/**
 * Reschedule / cancel a locally-booked appointment. Called by n8n for the
 * Retell voice agent.
 *
 * Both verbs refuse to touch a GHL-backed appointment: `resolveLocalStudio`
 * rejects GHL studios, and the row's own `calendar_id` must be null. Two
 * independent checks, because silently rewriting a GHL appointment without
 * telling GHL would desync the studio's real calendar.
 */

async function loadLocalAppointment(id: string) {
  const supabase = createServiceClient()
  const { data: appt } = await supabase
    .from('appointments')
    .select('id, studio_id, calendar_id, contact_id, contact_name, start_time, deleted_at')
    .eq('id', id)
    .single()
  return { supabase, appt }
}

/** PATCH — move an appointment to a new studio-local date + time. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const unauthorized = checkSecret(req)
  if (unauthorized) return unauthorized

  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const date = body.date
  const time = String(body.time ?? '')
  if (!isValidDate(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  if (!/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'time must be HH:MM' }, { status: 400 })

  const { supabase, appt } = await loadLocalAppointment(id)
  if (!appt || appt.deleted_at) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
  if (appt.calendar_id) {
    return NextResponse.json({ error: 'ghl_appointment', message: 'This appointment is managed in GHL.' }, { status: 409 })
  }

  const { studio, error: studioError } = await resolveLocalStudio(appt.studio_id)
  if (studioError) return studioError

  const availability = await getAvailabilityForDate(studio!.id, date)
  if (availability.closed) {
    return NextResponse.json({ error: 'closed', message: 'The studio is not open that day.' }, { status: 409 })
  }
  if (!availability.slots.some(s => s.value === time)) {
    return NextResponse.json(
      { error: 'slot_taken', message: 'That time is not available.', alternatives: availability.slots.slice(0, 3) },
      { status: 409 },
    )
  }

  const startLocal = toNaiveLocal(date, time)
  const endLocal = addMinutesNaive(startLocal, studio!.appointment_duration_minutes ?? 45)

  const { error } = await supabase
    .from('appointments')
    .update({ start_time: startLocal, end_time: endLocal, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      const fresh = await getAvailabilityForDate(studio!.id, date)
      return NextResponse.json(
        { error: 'slot_taken', message: 'That time was just booked by someone else.', alternatives: fresh.slots.slice(0, 3) },
        { status: 409 },
      )
    }
    console.error('[appointments PATCH]', error)
    return NextResponse.json({ error: 'Failed to reschedule' }, { status: 500 })
  }

  await supabase.from('appointment_events').insert({
    studio_id:      appt.studio_id,
    appointment_id: id,
    contact_id:     appt.contact_id,
    verb:           'Rescheduled',
    new_start_time: `${startLocal}+00:00`,
  })

  return NextResponse.json({ ok: true, appointment_id: id, start_time: startLocal, end_time: endLocal })
}

/** DELETE — soft-cancel, freeing the slot. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const unauthorized = checkSecret(req)
  if (unauthorized) return unauthorized

  const { id } = await ctx.params
  const { supabase, appt } = await loadLocalAppointment(id)

  if (!appt) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
  if (appt.deleted_at) return NextResponse.json({ ok: true, already_cancelled: true })
  if (appt.calendar_id) {
    return NextResponse.json({ error: 'ghl_appointment', message: 'This appointment is managed in GHL.' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('appointments')
    .update({ deleted_at: now, status: 'cancelled', updated_at: now })
    .eq('id', id)

  if (error) {
    console.error('[appointments DELETE]', error)
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
  }

  await supabase.from('appointment_events').insert({
    studio_id:      appt.studio_id,
    appointment_id: id,
    contact_id:     appt.contact_id,
    verb:           'Deleted',
  })

  return NextResponse.json({ ok: true, appointment_id: id })
}
