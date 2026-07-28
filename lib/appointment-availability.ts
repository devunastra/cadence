import { createServiceClient } from '@/lib/supabase/server'
import { getSlotsForDate, getMinDate } from '@/lib/appointment-slots'
import type { StudioSlotConfig } from '@/lib/types'

/**
 * Studio-local availability — used when a studio has no GHL calendar to ask.
 *
 * GHL studios get availability from GHL's free-slots API, which already knows
 * what is booked. Without GHL the studio config only describes the slot *grid*
 * (`studios.appointment_slots`), so we subtract booked `appointments` rows
 * ourselves. That subtraction is the whole point of this module.
 *
 * ── STORAGE CONVENTION (read before changing anything here) ──────────────────
 * `appointments.start_time` is `timestamptz`, but the app stores a NAIVE
 * STUDIO-LOCAL time in it — the offset is always +00 and the clock reading is
 * the studio's wall clock, NOT a real UTC instant.
 *
 *   Lincolnshire (America/Chicago), 2:00 PM local  ->  "2026-07-23 14:00:00+00"
 *   A true UTC instant would have been               "2026-07-23 19:00:00+00"
 *
 * Every writer follows this: `createAppointment` inserts `opts.startTime` (a
 * naive local string) directly, and the GHL webhook does the same. So slot
 * matching here compares wall-clock to wall-clock and does NO timezone
 * conversion. Converting properly would be "correct" in isolation and would
 * match zero rows in practice.
 *
 * The studio timezone is still needed for `getMinDate`, which reasons about
 * what "today" is.
 */

export interface FreeSlot {
  /** Studio-local start, "HH:MM" — the value the booking API expects back. */
  value: string
  /** Human label, e.g. "2:00 PM – 2:45 PM". */
  label: string
  /** Naive studio-local ISO, "YYYY-MM-DDTHH:MM:SS" — what gets stored. */
  startLocal: string
}

export interface AvailabilityResult {
  /** Free slots, ascending. Empty when closed, fully booked, or too soon. */
  slots: FreeSlot[]
  /** Studio has no configured slots for that weekday. */
  closed: boolean
  /** Slots exist for the weekday but all are taken. */
  fullyBooked: boolean
  /** Set when the date itself is not bookable — currently only 'too_soon'. */
  reason?: string
}

interface StudioRow {
  timezone: string | null
  appointment_slots: Record<string, string[]> | null
  appointment_duration_minutes: number | null
  appointment_min_advance_weeks: number | null
}

/** "2026-08-05" + "14:00" -> "2026-08-05T14:00:00" (naive studio-local). */
export function toNaiveLocal(dateVal: string, hhmm: string): string {
  return `${dateVal}T${hhmm.slice(0, 5)}:00`
}

/** The value this slot occupies in `appointments.start_time`, as epoch ms. */
function storedSlotMs(dateVal: string, hhmm: string): number {
  return Date.parse(`${toNaiveLocal(dateVal, hhmm)}+00:00`)
}

/** Adds one day to a "YYYY-MM-DD" string. */
function nextDay(dateVal: string): string {
  const d = new Date(`${dateVal}T00:00:00+00:00`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Free slots for one studio on one studio-local calendar date ("YYYY-MM-DD").
 *
 * Intended for studios without GHL. Callers must not use this to override GHL
 * availability for a studio that has a calendar configured — GHL stays the
 * source of truth there.
 */
export async function getAvailabilityForDate(
  studioId: string,
  dateVal: string,
): Promise<AvailabilityResult> {
  const supabase = createServiceClient()

  const { data: studio } = await supabase
    .from('studios')
    .select('timezone, appointment_slots, appointment_duration_minutes, appointment_min_advance_weeks')
    .eq('id', studioId)
    .single<StudioRow>()

  if (!studio) return { slots: [], closed: true, fullyBooked: false, reason: 'studio_not_found' }

  const tz = studio.timezone ?? 'America/Chicago'
  const config: StudioSlotConfig = {
    appointment_slots: studio.appointment_slots ?? {},
    appointment_duration_minutes: studio.appointment_duration_minutes ?? 45,
    appointment_min_advance_weeks: studio.appointment_min_advance_weeks ?? 0,
  }

  // Min-advance gate. NOTE: getMinDate applies `appointment_min_advance_weeks`
  // as DAYS — a long-standing quirk, kept so this matches the calendar UI
  // exactly. See docs/specs/local-appointment-booking.md, Defect 2.
  if (dateVal < getMinDate(config, tz)) {
    return { slots: [], closed: false, fullyBooked: false, reason: 'too_soon' }
  }

  const configured = getSlotsForDate(dateVal, config)
  if (!configured || configured.length === 0) {
    return { slots: [], closed: true, fullyBooked: false }
  }

  // Wall-clock day window, matching the storage convention above.
  const { data: booked } = await supabase
    .from('appointments')
    .select('start_time')
    .eq('studio_id', studioId)
    .is('deleted_at', null)
    .gte('start_time', `${dateVal}T00:00:00+00:00`)
    .lt('start_time', `${nextDay(dateVal)}T00:00:00+00:00`)

  const takenMs = new Set((booked ?? []).map(r => Date.parse(r.start_time as string)))

  const slots: FreeSlot[] = configured
    .filter(s => !takenMs.has(storedSlotMs(dateVal, s.value)))
    .map(s => ({
      value: s.value,
      label: s.label,
      startLocal: toNaiveLocal(dateVal, s.value),
    }))

  return { slots, closed: false, fullyBooked: slots.length === 0 }
}

/**
 * Is one specific studio-local slot free?
 *
 * Advisory only — it races with concurrent writes. The booking path must still
 * rely on the `appointments_local_slot_unique` index (migration 051) and treat
 * a unique violation as "taken".
 */
export async function isSlotFree(
  studioId: string,
  dateVal: string,
  hhmm: string,
): Promise<boolean> {
  const { slots } = await getAvailabilityForDate(studioId, dateVal)
  return slots.some(s => s.value === hhmm)
}
