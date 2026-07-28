import { createServiceClient } from '@/lib/supabase/server'
import type { Appointment } from '@/lib/types'

/**
 * Writes an appointment row and emits the Created event.
 *
 * Shared by `createAppointment` (dashboard, user session) and
 * `POST /api/appointments` (n8n on behalf of the voice agent, shared secret).
 * Both need identical writes; only their auth and their ID source differ, so
 * everything downstream of "we know the ID" lives here to stop the two paths
 * drifting apart.
 *
 * `startLocal` / `endLocal` are NAIVE STUDIO-LOCAL strings
 * ("YYYY-MM-DDTHH:MM:SS"). They are stored verbatim — see the storage
 * convention documented in lib/appointment-availability.ts.
 */
export async function persistAppointment(opts: {
  id: string
  studioId: string
  title: string
  startLocal: string
  endLocal: string
  /** GHL calendar ID, or null for locally-booked appointments. */
  calendarId: string | null
  contactId: string | null
  contactName: string
  notes: string | null
}): Promise<{ appointment?: Appointment; error?: string; slotTaken?: boolean }> {
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const { data: appt, error } = await supabase
    .from('appointments')
    .upsert(
      {
        id:           opts.id,
        studio_id:    opts.studioId,
        title:        opts.title,
        start_time:   opts.startLocal,
        end_time:     opts.endLocal,
        status:       'confirmed',
        calendar_id:  opts.calendarId,
        contact_id:   opts.contactId,
        contact_name: opts.contactName,
        notes:        opts.notes,
        created_at:   now,
        updated_at:   now,
      },
      { onConflict: 'id' },
    )
    .select()
    .single()

  if (error) {
    // 23505 here means appointments_local_slot_unique fired (migration 051) —
    // the slot was taken between the availability read and this write. Only
    // reachable on the local path; GHL rows are excluded from that index.
    if (error.code === '23505') {
      return { slotTaken: true, error: 'That time was just booked by someone else.' }
    }
    return { error: error.message }
  }

  await supabase.from('appointment_events').insert({
    studio_id:      opts.studioId,
    appointment_id: opts.id,
    contact_id:     opts.contactId,
    verb:           'Created',
  })

  return { appointment: appt as Appointment }
}

/** Adds `minutes` to a naive local "YYYY-MM-DDTHH:MM:SS" without timezone math. */
export function addMinutesNaive(startLocal: string, minutes: number): string {
  const m = startLocal.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) throw new Error(`Invalid naive local string: ${startLocal}`)
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[]
  // Anchored to UTC purely as arithmetic — these are wall-clock values, so no
  // DST adjustment should be applied to the duration.
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi))
  dt.setUTCMinutes(dt.getUTCMinutes() + minutes)
  return dt.toISOString().slice(0, 19)
}
