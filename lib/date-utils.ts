import type { CallVolumePoint, DatePreset } from './types'

// ── Timezone-aware date helpers ────────────────────────────────────────────────
// All exported functions require a studio IANA timezone (e.g. "America/Chicago",
// "Europe/Berlin"). The studio's tz comes from `currentStudio.timezone` on the
// client and a lookup on `studios.timezone` on the server / API route side.

/** UTC-millisecond offset for `tz` at the given instant. +ve east of UTC, -ve west. */
function tzOffsetMsAt(tz: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instant)
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const localAsUtc = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`).getTime()
  return localAsUtc - instant.getTime()
}

/** Returns the UTC Date for midnight on the YYYY-MM-DD date string in `tz`. */
export function studioMidnightFromStr(dateStr: string, tz: string): Date {
  // First pass: read offset at noon (side-steps the DST-cutover hour itself).
  const midnightUtc = new Date(dateStr + 'T00:00:00Z').getTime()
  const offset1 = tzOffsetMsAt(tz, new Date(dateStr + 'T12:00:00Z'))
  const guess = new Date(midnightUtc - offset1)
  // DST correction: read offset at the candidate moment. If it differs from noon's
  // offset (e.g. midnight is pre-cutover, noon is post-cutover), use the candidate's.
  const offset2 = tzOffsetMsAt(tz, guess)
  if (offset1 === offset2) return guess
  return new Date(midnightUtc - offset2)
}

/** Returns the UTC Date for start-of-day (midnight) in `tz` on the same calendar date as d. */
export function studioStartOfDay(d: Date, tz: string): Date {
  return studioMidnightFromStr(d.toLocaleDateString('en-CA', { timeZone: tz }), tz)
}

/** Returns the UTC Date for end-of-day (23:59:59.999) in `tz` on the same calendar date as d. */
export function studioEndOfDay(d: Date, tz: string): Date {
  return new Date(studioStartOfDay(d, tz).getTime() + 86_400_000 - 1)
}

// ── Preset range computation ───────────────────────────────────────────────────

export function getPresetRange(preset: DatePreset, tz: string): { from: Date; to: Date } {
  const now = new Date()
  const todayStart = studioStartOfDay(now, tz)
  const todayEnd   = studioEndOfDay(now, tz)

  switch (preset) {
    case 'today':
      return { from: todayStart, to: todayEnd }
    case '7d':
      return { from: studioStartOfDay(new Date(now.getTime() - 7 * 86_400_000), tz), to: todayEnd }
    case '4w':
      return { from: studioStartOfDay(new Date(now.getTime() - 28 * 86_400_000), tz), to: todayEnd }
    case '3m': {
      const f = new Date(now)
      f.setMonth(f.getMonth() - 3)
      return { from: studioStartOfDay(f, tz), to: todayEnd }
    }
    case 'week-to-date': {
      const dayName   = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now)
      const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName)
      return { from: studioStartOfDay(new Date(now.getTime() - dayOfWeek * 86_400_000), tz), to: todayEnd }
    }
    case 'month-to-date': {
      const [year, month] = now.toLocaleDateString('en-CA', { timeZone: tz }).split('-')
      return { from: studioMidnightFromStr(`${year}-${month}-01`, tz), to: todayEnd }
    }
    case 'year-to-date': {
      const year = now.toLocaleDateString('en-CA', { timeZone: tz }).split('-')[0]
      return { from: studioMidnightFromStr(`${year}-01-01`, tz), to: todayEnd }
    }
    case 'all':
      return { from: new Date('2020-01-01T00:00:00Z'), to: todayEnd }
    case 'custom':
      return { from: todayStart, to: todayEnd }
  }
}

// ── Duration formatting ────────────────────────────────────────────────────────

/** "1m 9s", "2h 3m", "45s" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return s > 0 ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

/** "1h 9m" style — for total duration stat card */
export function formatTotalDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── Date formatting ────────────────────────────────────────────────────────────

/** "Apr 13" — formatted in `tz` */
export function formatShortDate(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })
}

/** "Apr 13, 2026 2:32 PM" — formatted in `tz` */
export function formatDateTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: tz,
  })
}

/** "YYYY-MM-DD" for input[type=date] */
export function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Volume grouping ────────────────────────────────────────────────────────────

/** Returns the calendar date in `tz` for a UTC ISO timestamp */
function toStudioDate(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz })
}

/** Groups calls into daily buckets (studio-tz calendar dates) sorted ascending */
export function groupCallsByDay(calls: { created_at: string }[], tz: string): CallVolumePoint[] {
  const map = new Map<string, number>()
  for (const c of calls) {
    const day = toStudioDate(c.created_at, tz)
    map.set(day, (map.get(day) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))
}

/** Groups calls into daily duration buckets (studio-tz dates, sum seconds per day) */
export function groupDurationByDay(calls: { created_at: string; duration_seconds: number | null }[], tz: string): { date: string; seconds: number }[] {
  const map = new Map<string, number>()
  for (const c of calls) {
    const day = toStudioDate(c.created_at, tz)
    map.set(day, (map.get(day) ?? 0) + (c.duration_seconds ?? 0))
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, seconds]) => ({ date, seconds }))
}

/** Fills in zero-count days between from and to so charts don't have gaps */
export function fillDateGaps(
  data: { date: string; [key: string]: number | string }[],
  from: Date,
  to: Date,
  valueKey: string,
): { date: string; [key: string]: number | string }[] {
  const map = new Map(data.map(d => [d.date, d]))
  const result: { date: string; [key: string]: number | string }[] = []
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())

  while (cur <= end) {
    const key = cur.toISOString().slice(0, 10)
    result.push(map.get(key) ?? { date: key, [valueKey]: 0 })
    cur.setDate(cur.getDate() + 1)
  }
  return result
}
