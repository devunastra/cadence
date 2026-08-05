import { createServiceClient } from '@/lib/supabase/server'
import { naiveTzPartsToUtcIso } from '@/lib/date-utils'
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

/**
 * Mirrors a local booking or cancellation onto the lead record.
 *
 * GHL-backed studios get this from the ghl-appointment webhook
 * (`syncAppointmentFirstLesson` / `syncLeadActionScheduled`). Studios that book
 * locally have no such webhook, so without this their leads keep `first_lesson`
 * and `action` empty even after a confirmed booking.
 *
 * That is not only a Leads-page display gap. `schedule_followup_call`
 * suppresses the no-answer ladder with
 *
 *     IF v_action = 'Scheduled' OR first_lesson IS NOT NULL -> 'already_booked'
 *
 * so a lead missing both fields is re-queued for a follow-up call within
 * minutes of booking. Writing them here is what lets that guard work.
 *
 * Best-effort by contract: a booking must never fail because the write-back
 * did. Errors are logged and swallowed.
 */
export async function syncLeadBookingState(args: {
  studioId: string
  /** Supabase lead id — local bookings store it in `appointments.contact_id`. */
  leadId: string | null
}): Promise<void> {
  const { studioId, leadId } = args
  if (!leadId) return

  try {
    const supabase = createServiceClient()

    const { data: studio } = await supabase
      .from('studios')
      .select('timezone')
      .eq('id', studioId)
      .single()
    const tz = studio?.timezone ?? 'America/Chicago'

    const { data: lead } = await supabase
      .from('leads')
      .select('id, name, action, first_lesson')
      .eq('id', leadId)
      .eq('studio_id', studioId)
      .maybeSingle()
    if (!lead) return

    // Earliest live appointment. `calendar_id IS NULL` keeps this to rows using
    // the naive studio-local storage convention; GHL rows hold true instants and
    // are maintained by the webhook instead, so mixing them would misconvert.
    const { data: earliest } = await supabase
      .from('appointments')
      .select('start_time')
      .eq('studio_id', studioId)
      .eq('contact_id', leadId)
      .is('calendar_id', null)
      .is('deleted_at', null)
      .not('start_time', 'is', null)
      .order('start_time', { ascending: true })
      .limit(1)
      .maybeSingle()

    // start_time is a wall-clock value parked in a timestamptz (see the storage
    // convention in lib/appointment-availability.ts). Read its UTC parts to
    // recover that wall clock, then resolve through the studio timezone to get
    // the real instant. Calling toISOString() on it directly — which is correct
    // for GHL rows — would shift a 6 PM Vancouver lesson onto the wrong hour.
    let firstLesson: string | null = null
    if (earliest?.start_time) {
      const d = new Date(earliest.start_time as string)
      firstLesson = naiveTzPartsToUtcIso(
        d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
        d.getUTCHours(), d.getUTCMinutes(), tz,
      )
    }

    const { data: scheduled } = await supabase
      .from('studio_field_options')
      .select('id, value')
      .eq('studio_id', studioId)
      .eq('field', 'action')
      .eq('value', 'Scheduled')
      .limit(1)
      .maybeSingle()

    const patch: Record<string, string | null> = {}
    if (lead.first_lesson !== firstLesson) patch.first_lesson = firstLesson

    // Set "Scheduled" on booking; clear it again when the last appointment is
    // cancelled — but only when it is still the value we set, so a human's
    // choice is never overwritten. A stale "Scheduled" left behind would keep
    // the follow-up ladder suppressed for that lead permanently.
    let actionChangedTo: string | null | undefined
    if (scheduled) {
      if (firstLesson && lead.action !== scheduled.id) {
        patch.action = scheduled.id
        actionChangedTo = scheduled.value as string
      } else if (!firstLesson && lead.action === scheduled.id) {
        patch.action = null
        actionChangedTo = null
      }
    } else {
      console.warn(`[appointments] studio ${studioId} has no "Scheduled" action option — action left unchanged`)
    }

    if (Object.keys(patch).length === 0) return

    const { error } = await supabase.from('leads').update(patch).eq('id', lead.id)
    if (error) throw error

    if (actionChangedTo !== undefined) {
      // Audit the automated flip in Settings → Activity Log. Source 'ghl' is what
      // that view renders as "via GHL / AI" — the same label the webhook path
      // produces, which is what this is from the studio's point of view.
      // Awaited: fire-and-forget inserts get dropped when the function freezes.
      const { data: prev } = lead.action
        ? await supabase.from('studio_field_options').select('value').eq('id', lead.action).maybeSingle()
        : { data: null }
      try {
        await supabase.from('activity_logs').insert({
          studio_id:   studioId,
          lead_id:     lead.id,
          lead_name:   lead.name ?? null,
          actor_email: null,
          event_type:  'update',
          changes:     [{ field: 'action', old_value: prev?.value ?? null, new_value: actionChangedTo }],
          source:      'ghl',
        })
      } catch { /* logging is best-effort */ }
    }
  } catch (err) {
    console.error('[appointments] lead booking write-back failed', err)
  }
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
