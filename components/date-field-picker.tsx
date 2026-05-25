'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_HEADERS = ['Su','Mo','Tu','We','Th','Fr','Sa']

interface DateFieldPickerProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export function DateFieldPicker({ value, onChange, placeholder = 'Select date' }: DateFieldPickerProps) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const today = new Date()
  const initial = value
    ? new Date(value + 'T00:00:00Z')
    : new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1))
  const [viewYear, setViewYear] = useState(initial.getUTCFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getUTCMonth())

  function handleToggle() {
    if (!open && buttonRef.current) setRect(buttonRef.current.getBoundingClientRect())
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    function h(e: MouseEvent) {
      if (buttonRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

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

  function selectDay(day: number) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onChange(dateStr === value ? '' : dateStr)
    setOpen(false)
  }

  function formatDisplay(dateStr: string) {
    if (!dateStr) return placeholder
    const d = new Date(dateStr + 'T00:00:00Z')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }

  return (
    <div style={{ width: '100%' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm w-full text-left"
        style={{
          border: '1px solid var(--color-border)',
          boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none',
          backgroundColor: 'var(--color-surface)',
          color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          transition: 'background var(--transition-fast)',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
      >
        <span className="flex-1 truncate">{formatDisplay(value)}</span>
        <ChevronDown size={13} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
      </button>

      {open && rect && (
        <div
          ref={panelRef}
          className="rounded-xl shadow-xl p-3"
          style={{
            position: 'fixed',
            top: rect.bottom + 4,
            left: Math.min(rect.left, window.innerWidth - 268),
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
              <button type="button" onClick={prevMonth} className="p-2 md:p-1 rounded transition-colors" style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
                <ChevronLeft size={14} />
              </button>
              <button type="button" onClick={nextMonth} className="p-2 md:p-1 rounded transition-colors" style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_HEADERS.map(d => (
              <div key={d} className="text-center text-xs font-medium py-1" style={{ color: 'var(--color-text-muted)' }}>{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const selected = dateStr === value
              return (
                <div key={i} className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => selectDay(day)}
                    className="w-8 h-8 rounded-full text-xs transition-colors"
                    style={{
                      backgroundColor: selected ? 'var(--color-accent)' : 'transparent',
                      color: selected ? '#ffffff' : 'var(--color-text-primary)',
                      fontWeight: selected ? 600 : undefined,
                    }}
                    onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
                    onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
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
