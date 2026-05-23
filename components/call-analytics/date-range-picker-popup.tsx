'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

interface DateRangePickerPopupProps {
  anchorRect: DOMRect
  initialFrom: Date
  initialTo: Date
  onApply: (from: Date, to: Date, preset: PresetId | null) => void
  onClose: () => void
}

type PresetId = 'today' | '7d' | '4w' | '3m' | 'week-to-date' | 'month-to-date' | 'year-to-date' | 'all'

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today',          label: 'Today' },
  { id: '7d',             label: 'Last 7 Days' },
  { id: '4w',             label: 'Last 4 Weeks' },
  { id: '3m',             label: 'Last 3 Months' },
  { id: 'week-to-date',   label: 'Week to Date' },
  { id: 'month-to-date',  label: 'Month to Date' },
  { id: 'year-to-date',   label: 'Year to Date' },
  { id: 'all',            label: 'All Time' },
]

const STUDIO_TZ = 'America/Chicago'

// ── Chicago timezone helpers ───────────────────────────────────────────────────

/** What YYYY-MM-DD is it right now in Chicago? */
function getChicagoDateStr(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
}

/**
 * Given a local-midnight Date (from calendar cell), returns the UTC Date for
 * midnight America/Chicago on that same calendar date.
 * Treats the local date's year/month/day as the Chicago calendar date.
 */
function toChicagoStart(localDate: Date): Date {
  const y = localDate.getFullYear()
  const m = String(localDate.getMonth() + 1).padStart(2, '0')
  const d = String(localDate.getDate()).padStart(2, '0')
  const dateStr = `${y}-${m}-${d}`
  const utcMidnight = new Date(dateStr + 'T00:00:00Z')
  const h = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: STUDIO_TZ, hour: 'numeric', hourCycle: 'h23' }).format(utcMidnight),
    10,
  )
  return new Date(utcMidnight.getTime() + (h === 0 ? 0 : 24 - h) * 3_600_000)
}

/** Returns UTC end-of-day in Chicago for the same calendar date as localDate. */
function toChicagoEnd(localDate: Date): Date {
  return new Date(toChicagoStart(localDate).getTime() + 86_400_000 - 1)
}

/**
 * Converts a Chicago UTC boundary Date (e.g. from getPresetRange) to a local-midnight
 * Date for the same Chicago calendar date, for use in calendar display.
 */
function chicagoDateToLocalMidnight(d: Date): Date {
  const chicagoStr = d.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
  return new Date(chicagoStr + 'T00:00:00') // midnight in browser's local TZ
}

// ── Preset computation ────────────────────────────────────────────────────────
// Returns local-midnight dates representing the Chicago calendar dates for display.
// The actual UTC query boundaries are computed in the Apply handler via toChicagoStart/End.

function getPresetDates(id: PresetId): { from: Date; to: Date } {
  const now = new Date()
  const chicagoTodayStr = getChicagoDateStr(now)
  // Local midnight of "today in Chicago" — correct calendar date for any browser timezone
  const chicagoToday = new Date(chicagoTodayStr + 'T00:00:00')

  switch (id) {
    case 'today':
      return { from: chicagoToday, to: chicagoToday }
    case '7d':
      return { from: new Date(chicagoToday.getTime() - 7 * 86_400_000), to: chicagoToday }
    case '4w':
      return { from: new Date(chicagoToday.getTime() - 28 * 86_400_000), to: chicagoToday }
    case '3m': {
      const f = new Date(chicagoToday)
      f.setMonth(f.getMonth() - 3)
      return { from: f, to: chicagoToday }
    }
    case 'week-to-date': {
      const dayName   = new Intl.DateTimeFormat('en-US', { timeZone: STUDIO_TZ, weekday: 'short' }).format(now)
      const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName)
      return { from: new Date(chicagoToday.getTime() - dayOfWeek * 86_400_000), to: chicagoToday }
    }
    case 'month-to-date': {
      const [year, month] = chicagoTodayStr.split('-')
      return { from: new Date(`${year}-${month}-01T00:00:00`), to: chicagoToday }
    }
    case 'year-to-date': {
      const year = chicagoTodayStr.split('-')[0]
      return { from: new Date(`${year}-01-01T00:00:00`), to: chicagoToday }
    }
    case 'all':
      return { from: new Date('2020-01-01T00:00:00'), to: chicagoToday }
  }
}

// ── Calendar helpers ───────────────────────────────────────────────────────────

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function startOf(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatFooter(from: Date, to: Date) {
  const fmt = (d: Date) => `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
  return `${fmt(from)} – ${fmt(to)}`
}

function buildMonthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DateRangePickerPopup({ anchorRect, initialFrom, initialTo, onApply, onClose }: DateRangePickerPopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const today = new Date()

  // Store display dates as local-midnight of the Chicago calendar date
  const [fromDate, setFromDate] = useState<Date>(chicagoDateToLocalMidnight(initialFrom))
  const [toDate, setToDate]     = useState<Date>(chicagoDateToLocalMidnight(initialTo))
  const [hoverDate, setHoverDate]   = useState<Date | null>(null)
  const [selecting, setSelecting]   = useState<'from' | 'to'>('from')
  const [activePreset, setActivePreset] = useState<PresetId | null>(null)

  const initDisplay = chicagoDateToLocalMidnight(initialFrom)
  const [leftYear,  setLeftYear]  = useState(initDisplay.getFullYear())
  const [leftMonth, setLeftMonth] = useState(initDisplay.getMonth())

  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1
  const rightYear  = leftMonth === 11 ? leftYear + 1 : leftYear

  function prevLeft() {
    if (leftMonth === 0) { setLeftMonth(11); setLeftYear(y => y - 1) }
    else setLeftMonth(m => m - 1)
  }
  function nextLeft() {
    if (leftMonth === 11) { setLeftMonth(0); setLeftYear(y => y + 1) }
    else setLeftMonth(m => m + 1)
  }

  function handlePreset(id: PresetId) {
    const { from, to } = getPresetDates(id)
    setFromDate(from)
    setToDate(to)
    setActivePreset(id)
    setSelecting('from')
    setLeftYear(from.getFullYear())
    setLeftMonth(from.getMonth())
  }

  function handleDayClick(date: Date) {
    if (selecting === 'from') {
      setFromDate(date)
      setToDate(date)
      setSelecting('to')
      setActivePreset(null)
    } else {
      if (date < fromDate) {
        setFromDate(date)
        setToDate(fromDate)
      } else {
        setToDate(date)
      }
      setSelecting('from')
      setActivePreset(null)
    }
  }

  function getDayClasses(date: Date): string {
    const classes = ['dp-day']
    const effectiveTo = selecting === 'to' && hoverDate ? hoverDate : toDate

    if (sameDay(date, today)) classes.push('dp-day--today')

    if (sameDay(date, fromDate) && sameDay(date, effectiveTo)) {
      classes.push('dp-day--selected')
    } else if (sameDay(date, fromDate)) {
      classes.push('dp-day--range-start')
    } else if (sameDay(date, effectiveTo)) {
      classes.push('dp-day--range-end')
    } else if (date > fromDate && date < effectiveTo) {
      classes.push('dp-day--in-range')
    }

    return classes.join(' ')
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const POPUP_W = Math.min(680, window.innerWidth - 16)
  const POPUP_H = 420
  let left = anchorRect.left
  let top  = anchorRect.bottom + 6
  if (left + POPUP_W > window.innerWidth)  left = window.innerWidth - POPUP_W - 8
  if (left < 8) left = 8
  if (top  + POPUP_H > window.innerHeight) top  = anchorRect.top - POPUP_H - 6
  top = Math.max(8, Math.min(top, window.innerHeight - POPUP_H - 8))

  function MonthGrid({ year, month }: { year: number; month: number }) {
    const cells = buildMonthCells(year, month)
    return (
      <div style={{ flex: 1 }}>
        <div className="grid grid-cols-7 mb-1">
          {DAY_HEADERS.map(d => (
            <div key={d} className="text-center text-xs font-medium py-1" style={{ color: 'var(--color-text-muted)' }}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {cells.map((date, i) => (
            <div key={i} className="flex items-center">
              {date ? (
                <button
                  className={getDayClasses(date)}
                  onClick={() => handleDayClick(date)}
                  onMouseEnter={() => setHoverDate(date)}
                  onMouseLeave={() => setHoverDate(null)}
                >
                  {date.getDate()}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed', top, left, width: POPUP_W, zIndex: 9999,
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Body: presets panel + dual calendar */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Presets panel — hidden on very narrow screens */}
        <div className="hidden md:flex" style={{
          width: 160, borderRight: '1px solid var(--color-border)',
          padding: '12px 0', flexDirection: 'column', gap: 2,
        }}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => handlePreset(p.id)}
              style={{
                textAlign: 'left', padding: '6px 16px',
                fontSize: '0.8125rem',
                color: activePreset === p.id ? '#ffffff' : 'var(--color-text-secondary)',
                backgroundColor: activePreset === p.id ? 'var(--color-accent)' : 'transparent',
                border: 'none', cursor: 'pointer',
                transition: 'background var(--transition-fast), color var(--transition-fast)',
              }}
              onMouseEnter={e => {
                if (activePreset !== p.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'
              }}
              onMouseLeave={e => {
                if (activePreset !== p.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Dual calendar */}
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Month navigation row */}
          <div className="flex items-center justify-between">
            <button
              onClick={prevLeft}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
              style={{
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-bg)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
              }}
            >
              <ChevronLeft size={18} />
            </button>

            <div className="flex-1 flex items-center">
              <div className="flex-1 text-center text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {MONTHS[leftMonth]} {leftYear}
              </div>
              <div className="flex-1 text-center text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {MONTHS[rightMonth]} {rightYear}
              </div>
            </div>

            <button
              onClick={nextLeft}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
              style={{
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-bg)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)';
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 24 }}>
            <MonthGrid year={leftYear} month={leftMonth} />
            <MonthGrid year={rightYear} month={rightMonth} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--color-border)',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {formatFooter(fromDate, toDate)}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-lg transition-colors"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              // Convert display (local calendar) dates to Chicago UTC boundaries for the query
              onApply(toChicagoStart(fromDate), toChicagoEnd(toDate), activePreset)
              onClose()
            }}
            className="text-sm font-medium px-3 py-1.5 rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--color-accent)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
