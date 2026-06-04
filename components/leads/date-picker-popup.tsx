'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { tzCalendarParts, naiveTzPartsToUtcIso } from '@/lib/date-utils'

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

interface DatePickerPopupProps {
  currentValue: string | null
  anchorRect: DOMRect
  onSelect: (iso: string | null) => void
  onClose: () => void
  showTime?: boolean
  /**
   * Studio IANA timezone. The picker reads and writes calendar dates + times
   * in this zone so the displayed/saved value matches what every other
   * Phase-5-threaded surface (calendar, analytics, conversations) shows.
   */
  tz: string
}

function pad(n: number) { return String(n).padStart(2, '0') }

export function DatePickerPopup({ currentValue, anchorRect, onSelect, onClose, showTime = true, tz }: DatePickerPopupProps) {
  // Decompose the stored UTC ISO into the studio's wall-clock parts. "Today"
  // is also read in studio tz so the highlighted day matches the studio's
  // current local date, not the browser's.
  const selectedParts = currentValue ? tzCalendarParts(currentValue, tz) : null
  const todayParts = tzCalendarParts(new Date(), tz)
  const ref = useRef<HTMLDivElement>(null)

  const [viewMonth, setViewMonth] = useState(selectedParts?.month ?? todayParts.month)
  const [viewYear, setViewYear]   = useState(selectedParts?.year ?? todayParts.year)

  // Selected date parts (driven by calendar clicks, also editable via text)
  const [selYear, setSelYear]   = useState<number | null>(selectedParts?.year ?? null)
  const [selMonth, setSelMonth] = useState<number | null>(selectedParts?.month ?? null) // 0-based
  const [selDay, setSelDay]     = useState<number | null>(selectedParts?.day ?? null)

  // Time parts — convert the 24h studio-local hour into the 12h + AM/PM the UI uses.
  const initial24h = selectedParts?.hour ?? null
  const [hour, setHour]     = useState(initial24h === null ? 12 : (initial24h % 12 || 12))
  const [minute, setMinute] = useState(selectedParts?.minute ?? 0)
  const [ampm, setAmpm]     = useState<'AM' | 'PM'>(initial24h === null ? 'AM' : (initial24h >= 12 ? 'PM' : 'AM'))

  // Header text input
  const [headerText, setHeaderText] = useState(formatHeader(selYear, selMonth, selDay))
  const [headerEditing, setHeaderEditing] = useState(false)

  function formatHeader(y: number | null, m: number | null, d: number | null) {
    if (y === null || m === null || d === null) return ''
    return `${SHORT_MONTHS[m]} ${d}, ${y}`
  }

  function buildISO(y: number, m: number, d: number, h: number, min: number, ap: 'AM' | 'PM') {
    let hours24 = h % 12
    if (ap === 'PM') hours24 += 12
    // Interpret the picked wall-clock as studio-local; convert to UTC ISO so
    // it matches the storage convention used everywhere else (start_time,
    // last_contacted, etc.).
    return naiveTzPartsToUtcIso(y, m, d, hours24, min, tz)
  }

  function applyAndClose() {
    if (selYear !== null && selMonth !== null && selDay !== null) {
      onSelect(buildISO(selYear, selMonth, selDay, hour, minute, ampm))
    }
    onClose()
  }

  // Parse header text on blur
  function commitHeader() {
    setHeaderEditing(false)
    const parsed = new Date(headerText)
    if (!isNaN(parsed.getTime())) {
      setSelYear(parsed.getFullYear())
      setSelMonth(parsed.getMonth())
      setSelDay(parsed.getDate())
      setViewYear(parsed.getFullYear())
      setViewMonth(parsed.getMonth())
      setHeaderText(formatHeader(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()))
    } else {
      setHeaderText(formatHeader(selYear, selMonth, selDay))
    }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) applyAndClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [selYear, selMonth, selDay, hour, minute, ampm])

  const POPUP_W = 272
  const POPUP_H = 340
  let left = anchorRect.left
  let top = anchorRect.bottom + 6
  if (left + POPUP_W > window.innerWidth) left = window.innerWidth - POPUP_W - 8
  // Clamp so popup never goes off screen
  top = Math.max(8, Math.min(top, window.innerHeight - POPUP_H - 8))

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }
  function goToday() {
    setViewMonth(todayParts.month)
    setViewYear(todayParts.year)
    setSelYear(todayParts.year)
    setSelMonth(todayParts.month)
    setSelDay(todayParts.day)
    setHeaderText(formatHeader(todayParts.year, todayParts.month, todayParts.day))
    if (showTime) {
      const now = tzCalendarParts(new Date(), tz)
      setHour(now.hour % 12 || 12)
      setMinute(now.minute)
      setAmpm(now.hour >= 12 ? 'PM' : 'AM')
    } else {
      onSelect(buildISO(todayParts.year, todayParts.month, todayParts.day, 12, 0, 'PM'))
      onClose()
    }
  }
  function selectDay(day: number) {
    setSelYear(viewYear)
    setSelMonth(viewMonth)
    setSelDay(day)
    setHeaderText(formatHeader(viewYear, viewMonth, day))
    if (showTime && todayParts.year === viewYear && todayParts.month === viewMonth && todayParts.day === day) {
      const now = tzCalendarParts(new Date(), tz)
      setHour(now.hour % 12 || 12)
      setMinute(now.minute)
      setAmpm(now.hour >= 12 ? 'PM' : 'AM')
    }
    if (!showTime) {
      onSelect(buildISO(viewYear, viewMonth, day, 12, 0, 'PM'))
      onClose()
    }
  }

  const isSelected = (day: number) =>
    selYear === viewYear && selMonth === viewMonth && selDay === day

  const isToday = (day: number) =>
    todayParts.year === viewYear &&
    todayParts.month === viewMonth &&
    todayParts.day === day

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, width: POPUP_W, zIndex: 9999, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: 12 }}
    >
      {/* Month / year + nav */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={goToday}
            className="text-xs px-2 py-0.5 rounded transition-colors mr-1"
            style={{ color: 'var(--color-accent)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-subtle)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            Today
          </button>
          <button
            onClick={prevMonth}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={nextMonth}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(d => (
          <div key={d} className="text-center text-xs font-medium py-1" style={{ color: 'var(--color-text-muted)' }}>{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => (
          <div key={i} className="flex items-center justify-center">
            {day ? (
              <button
                onClick={() => selectDay(day)}
                className="w-8 h-8 rounded-full text-xs transition-colors"
                style={{
                  backgroundColor: isSelected(day) ? 'var(--color-accent)' : 'transparent',
                  color: isSelected(day)
                    ? '#ffffff'
                    : isToday(day)
                    ? 'var(--color-accent)'
                    : 'var(--color-text-primary)',
                  fontWeight: isSelected(day) || isToday(day) ? '600' : undefined,
                }}
                onMouseEnter={e => { if (!isSelected(day)) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
                onMouseLeave={e => { if (!isSelected(day)) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                {day}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {/* Time picker */}
      {showTime && <div className="mt-3 pt-2 flex items-center gap-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="text-xs mr-1" style={{ color: 'var(--color-text-secondary)' }}>Time</span>
        <input
          type="number"
          min={1} max={12}
          value={hour}
          onChange={e => setHour(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
          className="w-10 text-center text-xs rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
        />
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>:</span>
        <input
          type="number"
          min={0} max={59}
          value={pad(minute)}
          onChange={e => setMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
          className="w-10 text-center text-xs rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
        />
        <button
          onClick={() => setAmpm(a => a === 'AM' ? 'PM' : 'AM')}
          className="text-xs rounded px-2 py-1 transition-colors"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
        >
          {ampm}
        </button>
      </div>}

      {/* Footer */}
      {showTime && <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button
          onClick={() => { onSelect(null); onClose() }}
          className="text-sm hover:underline transition-colors"
          style={{ color: '#ef4444' }}
        >
          Clear date
        </button>
        <button
          onClick={applyAndClose}
          disabled={selYear === null}
          className="text-sm font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-40 transition-colors"
          style={{ backgroundColor: 'var(--color-accent)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
        >
          Apply
        </button>
      </div>}
    </div>,
    document.body
  )
}
