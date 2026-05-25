'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getMinDate } from '@/lib/appointment-slots'
import type { StudioSlotConfig } from '@/lib/types'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const DAY_HEADERS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function ordinal(n: number): string {
  if (n > 3 && n < 21) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

interface AppointmentDatePickerProps {
  value: string           // YYYY-MM-DD
  onChange: (val: string) => void
  config: StudioSlotConfig
  className?: string
}

export function AppointmentDatePicker({ value, onChange, config, className = '' }: AppointmentDatePickerProps) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef  = useRef<HTMLDivElement>(null)

  const minDate = getMinDate(config)
  const initial = value ? new Date(value + 'T00:00:00Z') : new Date(minDate + 'T00:00:00Z')
  const [viewYear, setViewYear]   = useState(initial.getUTCFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getUTCMonth())

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (buttonRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleToggle() {
    if (!open && buttonRef.current) setRect(buttonRef.current.getBoundingClientRect())
    setOpen(o => !o)
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function isDisabled(day: number): boolean {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (dateStr < minDate) return true
    const [y, mo, d] = dateStr.split('-').map(Number)
    const dow = new Date(y, mo - 1, d).getDay()
    const slots = config.appointment_slots[String(dow)]
    return !slots || slots.length === 0
  }

  function isUnavailableCol(colIndex: number): boolean {
    const dow = colIndex % 7
    const slots = config.appointment_slots[String(dow)]
    return !slots || slots.length === 0
  }

  function selectDay(day: number) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onChange(dateStr)
    setOpen(false)
  }

  function formatDisplay(dateStr: string) {
    if (!dateStr) return 'Select date'
    const d = new Date(dateStr + 'T00:00:00Z')
    const dow = DAY_NAMES[d.getUTCDay()]
    const mon = MONTHS[d.getUTCMonth()].substring(0, 3)
    return `${dow}, ${mon} ${ordinal(d.getUTCDate())}, ${d.getUTCFullYear()}`
  }

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`text-left text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]${className ? ' w-full' : ''}`}
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'}
      >
        {formatDisplay(value)}
      </button>

      {open && rect && (
        <div
          ref={panelRef}
          className="rounded-xl shadow-xl p-3"
          style={{
            position: 'fixed',
            top: rect.bottom + 4,
            left: rect.left,
            width: 256,
            zIndex: 9999,
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={prevMonth}
                className="p-2 md:p-1 rounded transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={nextMonth}
                className="p-2 md:p-1 rounded transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_HEADERS.map((d, i) => (
              <div
                key={d}
                className="text-center text-xs font-medium py-1"
                style={{ color: isUnavailableCol(i) ? 'var(--color-border-strong)' : 'var(--color-text-muted)' }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />
              const disabled = isDisabled(day)
              const colPos = i % 7
              const greyedCol = isUnavailableCol(colPos)
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const selected = dateStr === value
              return (
                <div key={i} className="flex items-center justify-center">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => selectDay(day)}
                    className="w-8 h-8 rounded-full text-xs transition-colors"
                    style={{
                      backgroundColor: selected ? 'var(--color-accent)' : 'transparent',
                      color: selected
                        ? '#ffffff'
                        : disabled
                        ? greyedCol ? 'var(--color-border-strong)' : 'var(--color-border-strong)'
                        : 'var(--color-text-primary)',
                      fontWeight: selected ? '600' : undefined,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                    onMouseEnter={e => { if (!disabled && !selected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
                    onMouseLeave={e => { if (!disabled && !selected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                  >
                    {day}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
