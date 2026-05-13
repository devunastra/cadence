import type { CallVolumePoint, DatePreset } from './types'

// ── Chicago timezone helpers ───────────────────────────────────────────────────
// All preset ranges are relative to America/Chicago (the studio's timezone).
// This ensures "Today" means Chicago today regardless of where the browser runs.

const STUDIO_TZ = 'America/Chicago'

/** Returns the UTC Date for midnight America/Chicago on the YYYY-MM-DD date string. */
function chicagoMidnightFromStr(dateStr: string): Date {
  const utcMidnight = new Date(dateStr + 'T00:00:00Z')
  // At UTC midnight, what hour is it in Chicago? e.g. 18 (CST/UTC-6) or 19 (CDT/UTC-5)
  const h = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: STUDIO_TZ, hour: 'numeric', hourCycle: 'h23' }).format(utcMidnight),
    10,
  )
  return new Date(utcMidnight.getTime() + (h === 0 ? 0 : 24 - h) * 3_600_000)
}

/** Returns the UTC Date for start-of-day (midnight) in Chicago on the same calendar date as d. */
export function chicagoStartOfDay(d: Date = new Date()): Date {
  return chicagoMidnightFromStr(d.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ }))
}

/** Returns the UTC Date for end-of-day (23:59:59.999) in Chicago on the same calendar date as d. */
export function chicagoEndOfDay(d: Date = new Date()): Date {
  return new Date(chicagoStartOfDay(d).getTime() + 86_400_000 - 1)
}

// ── Preset range computation ───────────────────────────────────────────────────

export function getPresetRange(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date()
  const todayStart = chicagoStartOfDay(now)
  const todayEnd   = chicagoEndOfDay(now)

  switch (preset) {
    case 'today':
      return { from: todayStart, to: todayEnd }
    case '7d':
      return { from: chicagoStartOfDay(new Date(now.getTime() - 7 * 86_400_000)), to: todayEnd }
    case '4w':
      return { from: chicagoStartOfDay(new Date(now.getTime() - 28 * 86_400_000)), to: todayEnd }
    case '3m': {
      const f = new Date(now)
      f.setMonth(f.getMonth() - 3)
      return { from: chicagoStartOfDay(f), to: todayEnd }
    }
    case 'week-to-date': {
      const dayName   = new Intl.DateTimeFormat('en-US', { timeZone: STUDIO_TZ, weekday: 'short' }).format(now)
      const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName)
      return { from: chicagoStartOfDay(new Date(now.getTime() - dayOfWeek * 86_400_000)), to: todayEnd }
    }
    case 'month-to-date': {
      const [year, month] = now.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ }).split('-')
      return { from: chicagoMidnightFromStr(`${year}-${month}-01`), to: todayEnd }
    }
    case 'year-to-date': {
      const year = now.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ }).split('-')[0]
      return { from: chicagoMidnightFromStr(`${year}-01-01`), to: todayEnd }
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

/** "Apr 13" — always America/Chicago */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: STUDIO_TZ })
}

/** "Apr 13, 2026 2:32 PM" — always America/Chicago (CST/CDT) */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: STUDIO_TZ,
  })
}

/** "YYYY-MM-DD" for input[type=date] */
export function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Volume grouping ────────────────────────────────────────────────────────────

/** Returns the America/Chicago calendar date for a UTC ISO timestamp */
function toCDTDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
}

/** Groups calls into daily buckets (America/Chicago dates) sorted ascending */
export function groupCallsByDay(calls: { created_at: string }[]): CallVolumePoint[] {
  const map = new Map<string, number>()
  for (const c of calls) {
    const day = toCDTDate(c.created_at)
    map.set(day, (map.get(day) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))
}

/** Groups calls into daily duration buckets (America/Chicago dates, sum seconds per day) */
export function groupDurationByDay(calls: { created_at: string; duration_seconds: number | null }[]): { date: string; seconds: number }[] {
  const map = new Map<string, number>()
  for (const c of calls) {
    const day = toCDTDate(c.created_at)
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
