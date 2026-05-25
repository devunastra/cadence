'use client'

import { useState, useEffect, useRef } from 'react'
import { Filter, ChevronDown, Check } from 'lucide-react'

export interface TranscriptFilters {
  direction: 'all' | 'inbound' | 'outbound'
  sentiment: string[]
  outcome: string
  appointmentBooked: string
  disconnectedReason: string[]
  qualityScore: { op: '>' | '<' | '=' | '>=' | '<='; value: string }
}

export const DEFAULT_FILTERS: TranscriptFilters = {
  direction: 'all',
  sentiment: [],
  outcome: '',
  appointmentBooked: '',
  disconnectedReason: [],
  qualityScore: { op: '>=', value: '' },
}

function activeFilterCount(f: TranscriptFilters): number {
  let n = 0
  if (f.direction !== 'all') n++
  if (f.sentiment.length > 0) n++
  if (f.outcome) n++
  if (f.appointmentBooked) n++
  if (f.disconnectedReason.length > 0) n++
  if (f.qualityScore.value !== '') n++
  return n
}

// ── Reusable custom dropdown (no native <select>) ─────────────────────────────

interface FieldSelectOption { value: string; label: string }

interface FieldSelectProps {
  label: string
  value: string
  onChange: (v: string) => void
  options: FieldSelectOption[]
  placeholder?: string
}

function FieldSelect({ label, value, onChange, options, placeholder = 'All' }: FieldSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref}>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm w-full"
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
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown
            size={13}
            className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            style={{ color: 'var(--color-text-muted)' }}
          />
        </button>

        {open && (
          <div
            className="absolute left-0 top-full mt-1 z-[100] rounded-xl py-1 overflow-hidden"
            style={{
              minWidth: '100%',
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            }}
          >
            {/* "All" / clear option */}
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
              style={{
                backgroundColor: !value ? 'var(--color-accent)' : 'transparent',
                color: !value ? '#ffffff' : 'var(--color-text-muted)',
                transition: 'none',
              }}
              onMouseEnter={e => { if (value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { if (value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              {placeholder}
            </button>
            {options.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
                style={{
                  backgroundColor: value === o.value ? 'var(--color-accent)' : 'transparent',
                  color: value === o.value ? '#ffffff' : 'var(--color-text-primary)',
                  fontWeight: value === o.value ? 500 : 400,
                  transition: 'none',
                }}
                onMouseEnter={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
                onMouseLeave={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Multi-select field (stays open, checkmarks) ───────────────────────────────

interface MultiFieldSelectProps {
  label: string
  values: string[]
  onChange: (v: string[]) => void
  options: FieldSelectOption[]
  placeholder?: string
}

function MultiFieldSelect({ label, values, onChange, options, placeholder = 'All' }: MultiFieldSelectProps) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

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

  function toggle(val: string) {
    if (values.includes(val)) {
      onChange(values.filter(v => v !== val))
    } else {
      const next = [...values, val]
      onChange(next.length === options.length ? [] : next)
    }
  }

  const displayLabel = values.length === 0
    ? placeholder
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label ?? values[0])
      : `${values.length} selected`

  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </label>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={handleToggle}
          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm w-full"
          style={{
            border: '1px solid var(--color-border)',
            boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none',
            backgroundColor: 'var(--color-surface)',
            color: values.length > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            transition: 'background var(--transition-fast)',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
        >
          <span className="truncate text-left flex-1">{displayLabel}</span>
          <ChevronDown size={13} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
        </button>

        {open && rect && (
          <div
            ref={panelRef}
            className="rounded-xl py-1 overflow-hidden"
            style={{
              position: 'fixed',
              top: rect.bottom + 4,
              left: rect.left,
              width: rect.width,
              zIndex: 1000,
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            }}
          >
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
              style={{
                backgroundColor: values.length === 0 ? 'var(--color-accent)' : 'transparent',
                color: values.length === 0 ? '#ffffff' : 'var(--color-text-muted)',
                transition: 'none',
              }}
              onMouseEnter={e => { if (values.length > 0) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { if (values.length > 0) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              {placeholder}
            </button>
            {options.map(o => {
              const checked = values.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm whitespace-nowrap"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-primary)',
                    fontWeight: checked ? 500 : 400,
                    transition: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  <span>{o.label}</span>
                  {checked && <Check size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Quality score operator picker ─────────────────────────────────────────────

const OPS = ['>=', '<=', '>', '<', '='] as const
type Op = typeof OPS[number]

interface OpPickerProps {
  value: Op
  onChange: (op: Op) => void
}

function OpPicker({ value, onChange }: OpPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center px-2 py-2 rounded-lg text-sm font-medium"
        style={{
          border: '1px solid var(--color-border)',
          boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-primary)',
          width: 52,
          transition: 'background var(--transition-fast)',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
      >
        {value}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-[100] rounded-xl py-1 overflow-hidden"
          style={{
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            minWidth: 52,
          }}
        >
          {OPS.map(op => (
            <button
              key={op}
              type="button"
              onClick={() => { onChange(op); setOpen(false) }}
              className="w-full text-center px-2 py-2 text-sm font-medium"
              style={{
                backgroundColor: value === op ? 'var(--color-accent)' : 'transparent',
                color: value === op ? '#ffffff' : 'var(--color-text-primary)',
                transition: 'none',
              }}
              onMouseEnter={e => { if (value !== op) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { if (value !== op) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              {op}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main filter bar ────────────────────────────────────────────────────────────

interface TranscriptsFilterBarProps {
  filters: TranscriptFilters
  onChange: (filters: TranscriptFilters) => void
}

export function TranscriptsFilterBar({ filters, onChange }: TranscriptsFilterBarProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const count = activeFilterCount(filters)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function set<K extends keyof TranscriptFilters>(key: K, value: TranscriptFilters[K]) {
    onChange({ ...filters, [key]: value })
  }

  const pillStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
    border: '1px solid var(--color-border)',
    boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text-secondary)',
    fontSize: 14, lineHeight: '1.25rem', fontWeight: 500,
    transition: 'background var(--transition-fast), color var(--transition-fast)',
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        style={pillStyle}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)' }}
      >
        <Filter size={14} />
        <span>Filter</span>
        {count > 0 && (
          <span
            className="flex items-center justify-center text-xs font-semibold rounded-full"
            style={{ minWidth: 18, height: 18, padding: '0 5px', backgroundColor: 'var(--color-accent)', color: '#ffffff' }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed left-5 right-5 md:absolute md:left-0 md:right-auto mt-1 z-50 rounded-xl shadow-xl p-4 md:w-[520px]"
          style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        >
          <div className="grid grid-cols-2 gap-3">
            <FieldSelect
              label="Direction"
              value={filters.direction === 'all' ? '' : filters.direction}
              onChange={v => set('direction', (v || 'all') as TranscriptFilters['direction'])}
              options={[
                { value: 'inbound', label: 'Inbound' },
                { value: 'outbound', label: 'Outbound' },
              ]}
            />
            <MultiFieldSelect
              label="Sentiment"
              values={filters.sentiment}
              onChange={v => set('sentiment', v)}
              options={[
                { value: 'positive', label: 'Positive' },
                { value: 'neutral', label: 'Neutral' },
                { value: 'negative', label: 'Negative' },
                { value: 'unknown', label: 'Unknown' },
              ]}
            />
            <FieldSelect
              label="Outcome"
              value={filters.outcome}
              onChange={v => set('outcome', v)}
              options={[
                { value: 'successful', label: 'Successful' },
                { value: 'unsuccessful', label: 'Unsuccessful' },
              ]}
            />
            <FieldSelect
              label="Appointment Booked"
              value={filters.appointmentBooked}
              onChange={v => set('appointmentBooked', v)}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
            />
            <MultiFieldSelect
              label="Disconnect Reason"
              values={filters.disconnectedReason}
              onChange={v => set('disconnectedReason', v)}
              options={[
                { value: 'agent_hangup', label: 'Agent Hangup' },
                { value: 'user_hangup', label: 'User Hangup' },
                { value: 'voicemail', label: 'Voicemail' },
                { value: 'dial_no_answer', label: 'No Answer' },
                { value: 'dial_busy', label: 'Busy' },
                { value: 'call_transfer', label: 'Transfer' },
              ]}
            />

            {/* Quality Score */}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                Quality Score
              </label>
              <div className="flex gap-2">
                <OpPicker
                  value={filters.qualityScore.op}
                  onChange={op => set('qualityScore', { ...filters.qualityScore, op })}
                />
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  placeholder="0–10"
                  value={filters.qualityScore.value}
                  onChange={e => set('qualityScore', { ...filters.qualityScore, value: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-lg text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
            </div>
          </div>
          {count > 0 && (
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => onChange({ direction: 'all', sentiment: [], outcome: '', appointmentBooked: '', disconnectedReason: [], qualityScore: { op: '>=', value: '' } })}
                className="text-xs font-medium"
                style={{ color: 'var(--color-accent)', transition: 'color var(--transition-fast)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent)'}
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
