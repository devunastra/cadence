import type { StudioSlotConfig } from './types'

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Parse "HH:MM" into total minutes since midnight. */
function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Format total minutes since midnight as "H:MM AM/PM". */
function formatMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const period = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

// ─── Public API ──────────────────────────────────────────────────────────────

const STUDIO_TZ = 'America/Chicago'

/**
 * Returns the first bookable date as "YYYY-MM-DD" (Chicago calendar date).
 * appointment_min_advance_weeks is treated as days (e.g. 1 = tomorrow).
 */
export function getMinDate(config: StudioSlotConfig): string {
  const now = new Date()
  const minDate = new Date(now.getTime() + config.appointment_min_advance_weeks * 86_400_000)
  return minDate.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
}

/**
 * Returns the sorted slot list for a given date string ("YYYY-MM-DD", treated
 * as local calendar date), or null if the day has no configured slots.
 */
export function getSlotsForDate(
  dateVal: string,
  config: StudioSlotConfig,
): { value: string; label: string }[] | null {
  const [y, mo, d] = dateVal.split('-').map(Number)
  const dow = new Date(y, mo - 1, d).getDay()
  const starts = config.appointment_slots[String(dow)]
  if (!starts || starts.length === 0) return null
  return [...starts]
    .sort((a, b) => parseMinutes(a) - parseMinutes(b))
    .map(start => {
      const startMin = parseMinutes(start)
      const endMin   = startMin + config.appointment_duration_minutes
      return {
        value: start,
        label: `${formatMinutes(startMin)} – ${formatMinutes(endMin)}`,
      }
    })
}

/**
 * Validates a date+time combination against the studio config.
 * Returns an error string, or null if valid.
 */
export function validateSlot(
  dateVal: string,
  timeVal: string,
  config: StudioSlotConfig,
): string | null {
  if (dateVal < getMinDate(config)) {
    return `Appointments must be booked at least ${config.appointment_min_advance_weeks} day${config.appointment_min_advance_weeks === 1 ? '' : 's'} in advance.`
  }
  const slots = getSlotsForDate(dateVal, config)
  if (!slots) return 'No appointment slots are configured for that day.'
  if (!slots.some(s => s.value === timeVal)) {
    return 'That time is not a valid slot. Please select one of the available times.'
  }
  return null
}
