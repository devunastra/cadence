import { NextResponse } from 'next/server'
import { getAvailabilityForDate } from '@/lib/appointment-availability'
import { checkSecret, resolveLocalStudio, isValidDate } from '../_auth'

/**
 * GET /api/appointments/availability?studio_id=<uuid>&date=YYYY-MM-DD
 *
 * Free slots for a studio that has no GHL calendar. Returns raw data — the
 * caller (an n8n Code node) is responsible for turning it into whatever the
 * Retell conversation flow expects to speak.
 *
 * `closed` and `fullyBooked` are deliberately distinct so the agent can say
 * "we're closed Mondays" rather than "no availability", which is a materially
 * different thing to tell a caller.
 */
export async function GET(req: Request) {
  const unauthorized = checkSecret(req)
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(req.url)
  const studioId = searchParams.get('studio_id') ?? ''
  const date = searchParams.get('date')

  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const { studio, error } = await resolveLocalStudio(studioId)
  if (error) return error

  try {
    const result = await getAvailabilityForDate(studio!.id, date)
    return NextResponse.json({
      studio_id: studio!.id,
      date,
      timezone: studio!.timezone,
      duration_minutes: studio!.appointment_duration_minutes,
      closed: result.closed,
      fully_booked: result.fullyBooked,
      reason: result.reason ?? null,
      slots: result.slots,
    })
  } catch (e) {
    console.error('[appointments/availability]', e)
    return NextResponse.json({ error: 'Failed to compute availability' }, { status: 500 })
  }
}
