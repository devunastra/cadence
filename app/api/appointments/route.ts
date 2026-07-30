import { NextResponse } from 'next/server'
import { getAvailabilityForDate, toNaiveLocal } from '@/lib/appointment-availability'
import { persistAppointment, addMinutesNaive } from '@/lib/appointment-booking'
import { checkSecret, resolveLocalStudio, isValidDate } from './_auth'

/**
 * POST /api/appointments
 *
 * Books an appointment for a studio with no GHL calendar. Called by n8n on
 * behalf of the Retell voice agent.
 *
 * Body:
 *   studio_id     uuid      required
 *   date          YYYY-MM-DD required (studio-local)
 *   time          HH:MM     required (studio-local slot start)
 *   contact_name  string    required
 *   contact_id    string?   optional — Supabase lead id, if known
 *   notes         string?
 *   title         string?
 *
 * Returns 409 `slot_taken` when the slot went while the caller was talking, so
 * the agent can offer an alternative rather than claim a booking that failed.
 */
export async function POST(req: Request) {
  const unauthorized = checkSecret(req)
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const studioId = String(body.studio_id ?? '')
  const date = body.date
  const time = String(body.time ?? '')
  const contactName = String(body.contact_name ?? '').trim()

  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: 'time must be HH:MM' }, { status: 400 })
  }
  if (!contactName) {
    return NextResponse.json({ error: 'contact_name is required' }, { status: 400 })
  }

  const { studio, error: studioError } = await resolveLocalStudio(studioId)
  if (studioError) return studioError

  // Advisory pre-check: gives a precise reason (closed / too soon / taken)
  // instead of a bare constraint violation. The DB index is still the arbiter.
  const availability = await getAvailabilityForDate(studio!.id, date)
  if (availability.reason === 'too_soon') {
    return NextResponse.json(
      { error: 'too_soon', message: 'That date is inside the studio’s minimum booking notice.' },
      { status: 409 },
    )
  }
  if (availability.closed) {
    return NextResponse.json(
      { error: 'closed', message: 'The studio is not open that day.' },
      { status: 409 },
    )
  }
  if (!availability.slots.some(s => s.value === time)) {
    return NextResponse.json(
      {
        error: 'slot_taken',
        message: 'That time is no longer available.',
        alternatives: availability.slots.slice(0, 3),
      },
      { status: 409 },
    )
  }

  const startLocal = toNaiveLocal(date, time)
  const endLocal = addMinutesNaive(startLocal, studio!.appointment_duration_minutes ?? 45)

  const { appointment, error, slotTaken } = await persistAppointment({
    id:          crypto.randomUUID(),
    studioId:    studio!.id,
    title:       typeof body.title === 'string' && body.title ? body.title : 'Dance Appointment',
    startLocal,
    endLocal,
    calendarId:  null,
    contactId:   typeof body.contact_id === 'string' && body.contact_id ? body.contact_id : null,
    contactName,
    notes:       typeof body.notes === 'string' ? body.notes : null,
  })

  if (slotTaken) {
    // Lost the race between the check above and the insert.
    const fresh = await getAvailabilityForDate(studio!.id, date)
    return NextResponse.json(
      {
        error: 'slot_taken',
        message: 'That time was just booked by someone else.',
        alternatives: fresh.slots.slice(0, 3),
      },
      { status: 409 },
    )
  }
  if (error || !appointment) {
    console.error('[appointments POST]', error)
    return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    appointment_id: appointment.id,
    start_time: startLocal,
    end_time: endLocal,
  })
}
