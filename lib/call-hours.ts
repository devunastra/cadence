import { tzCalendarParts, naiveTzPartsToUtcIso } from './date-utils'

// ── Outbound call window ──────────────────────────────────────────────────────
//
// A studio's `call_hours` (migration 056) says when the AI voice agent is
// allowed to place OUTBOUND calls. Inbound calls are answered by Retell at the
// phone-number level and are not affected by anything in this file.
//
// Times are wall-clock in the studio's own timezone (`studios.timezone`). Every
// conversion goes through date-utils, which reads real IANA offsets — this is
// what replaced the hand-rolled PDT/PST changeover arithmetic that used to live
// in the White Rock n8n Code node.
//
// The rule when a lead arrives outside the window is NOT "drop it". It is
// "queue it for the next opening" — see `nextCallWindowOpening`.

/** One day's window, or null when the studio places no calls that day. */
export type DayWindow = { open: string; close: string } | null

/** Day-of-week ("0" = Sunday … "6" = Saturday) → window. Matches the key
 *  convention already used by `studios.appointment_slots`. */
export type CallHours = Record<string, DayWindow>

const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'] as const

export const DAY_LABELS: Record<string, string> = {
  '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat',
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "HH:MM" → minutes since midnight, or null if malformed. */
export function parseHHMM(value: string): number | null {
  const m = HHMM.exec(value)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

/** Minutes since midnight → "HH:MM". */
export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "HH:MM" → "9:00 AM" for display. Falls back to the raw value if malformed. */
export function formatHHMM(value: string): string {
  const mins = parseHHMM(value)
  if (mins === null) return value
  const h24 = Math.floor(mins / 60)
  const m = mins % 60
  const period = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/**
 * A window is usable only when both ends parse AND open < close.
 *
 * `close <= open` is treated as CLOSED rather than as an overnight wrap. A
 * dance studio calling across midnight isn't a real case, and guessing wrong
 * would mean cold-calling at 2am — so the ambiguous input fails closed. The
 * editor blocks it at the source anyway.
 */
export function windowMinutes(win: DayWindow): { open: number; close: number } | null {
  if (!win) return null
  const open = parseHHMM(win.open)
  const close = parseHHMM(win.close)
  if (open === null || close === null) return null
  if (close <= open) return null
  return { open, close }
}

/**
 * Coerce an unvalidated `studios.call_hours` jsonb into a `CallHours`, dropping
 * anything malformed. Returns null when nothing usable survives, which the rest
 * of this module reads as "no restriction configured" (24/7).
 *
 * NULL column and '{}' therefore behave identically — both mean unrestricted.
 * "Never call" is expressed by every day being explicitly present and null.
 */
export function normalizeCallHours(raw: unknown): CallHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const out: CallHours = {}
  let sawKey = false

  for (const day of DAY_KEYS) {
    if (!(day in source)) continue
    sawKey = true
    const value = source[day]
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      out[day] = null
      continue
    }
    const { open, close } = value as { open?: unknown; close?: unknown }
    if (typeof open !== 'string' || typeof close !== 'string') {
      out[day] = null
      continue
    }
    const win = { open, close }
    out[day] = windowMinutes(win) ? win : null
  }

  return sawKey ? out : null
}

/** True when at least one day has a usable window. */
export function hasAnyWindow(hours: CallHours | null): boolean {
  if (!hours) return false
  return DAY_KEYS.some(d => windowMinutes(hours[d] ?? null) !== null)
}

/** Studio-local day-of-week (0 = Sunday) and minutes-since-midnight at `at`. */
function localPosition(tz: string, at: Date): { dow: number; minutes: number; y: number; m: number; d: number } {
  const { year, month, day, hour, minute } = tzCalendarParts(at, tz)
  // Calendar arithmetic only — Date.UTC here is a weekday lookup, not a conversion.
  const dow = new Date(Date.UTC(year, month, day)).getUTCDay()
  return { dow, minutes: hour * 60 + minute, y: year, m: month, d: day }
}

/**
 * Is the studio inside its outbound call window right now?
 *
 * Unconfigured (`null` / `{}`) means unrestricted → always true. That is the
 * default for every studio that has no window today, so adding the column
 * changed nothing for them.
 */
export function isWithinCallHours(
  hours: CallHours | null,
  tz: string,
  at: Date = new Date(),
): boolean {
  if (!hours) return true
  if (!hasAnyWindow(hours)) return false

  const { dow, minutes } = localPosition(tz, at)
  const win = windowMinutes(hours[String(dow)] ?? null)
  if (!win) return false
  return minutes >= win.open && minutes < win.close
}

/**
 * The next instant the studio is callable, as a UTC Date.
 *
 * - Unconfigured hours → `from` (callable immediately).
 * - Already inside the window → `from`.
 * - Before today's opening → today's opening.
 * - After today's close, or a closed day → the next open day's opening.
 * - No day has a window → null. Callers must handle this instead of looping;
 *   returning a date here would mean inventing a call time that never comes.
 *
 * Scans 8 days so a `from` late on day 0 still finds the same weekday next week.
 */
export function nextCallWindowOpening(
  hours: CallHours | null,
  tz: string,
  from: Date = new Date(),
): Date | null {
  if (!hours) return from
  if (!hasAnyWindow(hours)) return null
  if (isWithinCallHours(hours, tz, from)) return from

  const { minutes, y, m, d } = localPosition(tz, from)

  for (let offset = 0; offset <= 7; offset++) {
    const cursor = new Date(Date.UTC(y, m, d + offset))
    const win = windowMinutes(hours[String(cursor.getUTCDay())] ?? null)
    if (!win) continue
    // Day 0 only counts if the window hasn't already passed.
    if (offset === 0 && minutes >= win.open) continue
    return new Date(naiveTzPartsToUtcIso(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      cursor.getUTCDate(),
      Math.floor(win.open / 60),
      win.open % 60,
      tz,
    ))
  }

  return null
}

/**
 * Short label for when calling resumes, e.g. "8:00 AM", "tomorrow 1:00 PM",
 * "Mon 12:00 PM". Returns null when there is nothing to wait for — hours are
 * unrestricted, we're already inside the window, or no day ever opens.
 *
 * Used by the AI Voice Agent pill so "Outside calling hours" says when that ends
 * rather than leaving the reader to go and look it up.
 */
export function formatNextOpeningLabel(
  hours: CallHours | null,
  tz: string,
  from: Date = new Date(),
): string | null {
  const next = nextCallWindowOpening(hours, tz, from)
  if (!next || next.getTime() <= from.getTime()) return null

  const nowParts = tzCalendarParts(from, tz)
  const nextParts = tzCalendarParts(next, tz)
  const time = formatHHMM(toHHMM(nextParts.hour * 60 + nextParts.minute))

  const sameDay =
    nowParts.year === nextParts.year &&
    nowParts.month === nextParts.month &&
    nowParts.day === nextParts.day
  if (sameDay) return time

  // Calendar arithmetic only — Date.UTC here is a day-rollover, not a conversion.
  const tomorrow = new Date(Date.UTC(nowParts.year, nowParts.month, nowParts.day + 1))
  if (
    tomorrow.getUTCFullYear() === nextParts.year &&
    tomorrow.getUTCMonth() === nextParts.month &&
    tomorrow.getUTCDate() === nextParts.day
  ) {
    return `tomorrow ${time}`
  }

  const dow = new Date(Date.UTC(nextParts.year, nextParts.month, nextParts.day)).getUTCDay()
  return `${DAY_LABELS[String(dow)]} ${time}`
}

/** Seven closed days — the shape the editor starts from when a studio has none. */
export function emptyCallHours(): CallHours {
  return Object.fromEntries(DAY_KEYS.map(d => [d, null])) as CallHours
}

/** Every day open on the same window. Used by the editor's "apply to all days". */
export function uniformCallHours(open: string, close: string): CallHours {
  return Object.fromEntries(DAY_KEYS.map(d => [d, { open, close }])) as CallHours
}

/**
 * One-line human summary, e.g. "Mon–Fri 9:00 AM – 10:00 PM" or
 * "Mon–Thu 12:00 PM – 8:00 PM, Fri 12:00 PM – 7:00 PM". Consecutive days sharing
 * a window collapse into a range. Weeks start Monday here because that reads
 * better than a Sunday-first summary, even though the storage keys are 0-indexed
 * from Sunday.
 */
export function formatCallHoursSummary(hours: CallHours | null): string {
  if (!hours) return 'Calling any time'
  if (!hasAnyWindow(hours)) return 'Never calling'

  const order = ['1', '2', '3', '4', '5', '6', '0']
  const groups: Array<{ days: string[]; win: { open: string; close: string } }> = []

  for (const day of order) {
    const win = hours[day] ?? null
    if (!windowMinutes(win)) continue
    const last = groups[groups.length - 1]
    const isRun =
      last &&
      last.win.open === win!.open &&
      last.win.close === win!.close &&
      order.indexOf(last.days[last.days.length - 1]) === order.indexOf(day) - 1
    if (isRun) last.days.push(day)
    else groups.push({ days: [day], win: win! })
  }

  return groups
    .map(({ days, win }) => {
      const span =
        days.length === 1
          ? DAY_LABELS[days[0]]
          : `${DAY_LABELS[days[0]]}–${DAY_LABELS[days[days.length - 1]]}`
      return `${span} ${formatHHMM(win.open)} – ${formatHHMM(win.close)}`
    })
    .join(', ')
}
