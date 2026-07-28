'use client'

import { useState, useRef, useEffect } from 'react'
import { Filter, Search, X, ChevronDown, RefreshCw, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { DateFieldPicker } from '@/components/date-field-picker'

const STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'showed',    label: 'Showed' },
  { value: 'noshow',    label: 'No Show' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'invalid',   label: 'Invalid' },
]

export interface AppointmentListFilterBarProps {
  search: string
  onSearchChange: (v: string) => void
  statusFilters: string[]
  onStatusFiltersChange: (v: string[]) => void
  dateFrom: string
  onDateFromChange: (v: string) => void
  dateTo: string
  onDateToChange: (v: string) => void
  onRefresh: () => void
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 500,
    borderRadius: 8,
    cursor: 'pointer',
    border: '1px solid var(--color-border)',
    boxShadow: active ? '0 0 0 2px var(--color-accent)' : 'none',
    backgroundColor: active ? 'var(--color-surface)' : 'var(--color-bg)',
    color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
    transition: 'background var(--transition-fast), color var(--transition-fast)',
    whiteSpace: 'nowrap' as const,
  }
}

function onPillEnter(e: React.MouseEvent) {
  const el = e.currentTarget as HTMLElement
  el.style.backgroundColor = 'var(--color-surface-hover)'
  el.style.color = 'var(--color-text-primary)'
}

function onPillLeave(e: React.MouseEvent, active: boolean) {
  if (active) return
  const el = e.currentTarget as HTMLElement
  el.style.backgroundColor = 'var(--color-bg)'
  el.style.color = 'var(--color-text-secondary)'
}

// ── Multi-select dropdown (stays open, checkmarks) ────────────────────────────

function MultiSelect({
  values,
  onChange,
  options,
  placeholder = 'Select…',
}: {
  values: string[]
  onChange: (v: string[]) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
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

  function toggle(value: string) {
    if (values.includes(value)) {
      onChange(values.filter(v => v !== value))
    } else {
      const next = [...values, value]
      // All selected = same as no filter → clear
      onChange(next.length === options.length ? [] : next)
    }
  }

  const label = values.length === 0
    ? placeholder
    : values.length === options.length
      ? placeholder
      : values.map(v => options.find(o => o.value === v)?.label ?? v).join(', ')

  return (
    <div className="relative" style={{ width: '100%' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm w-full"
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
        <span className="truncate text-left flex-1">{label}</span>
        <ChevronDown size={13} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
      </button>

      {open && rect && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            zIndex: 1000,
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div className="py-1">
            {/* Clear / All option */}
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full flex items-center justify-between px-3 py-2 text-sm"
              style={{
                backgroundColor: values.length === 0 ? 'var(--color-accent)' : 'transparent',
                color: values.length === 0 ? '#ffffff' : 'var(--color-text-muted)',
              }}
              onMouseEnter={e => { if (values.length > 0) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { if (values.length > 0) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              All statuses
            </button>
            {options.map(o => {
              const checked = values.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-primary)',
                    fontWeight: checked ? 500 : 400,
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
        </div>
      )}
    </div>
  )
}

// ── Simple date field → opens calendar panel on click ────────────────────────

// ── Main filter bar ───────────────────────────────────────────────────────────

export function AppointmentListFilterBar({
  search, onSearchChange,
  statusFilters, onStatusFiltersChange,
  dateFrom, onDateFromChange,
  dateTo, onDateToChange,
  onRefresh,
}: AppointmentListFilterBarProps) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const activeFilterCount = [statusFilters.length > 0, !!dateFrom, !!dateTo].filter(Boolean).length

  useEffect(() => {
    if (!filterOpen) return
    function h(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [filterOpen])

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 20)
  }, [searchOpen])

  function handleSearchClose() {
    onSearchChange('')
    setSearchOpen(false)
  }

  function clearAllFilters() {
    onStatusFiltersChange([])
    onDateFromChange('')
    onDateToChange('')
  }

  return (
    <>
      {/* Refresh */}
      <button
        onClick={() => {
          setSpinning(true)
          onRefresh()
          setTimeout(() => setSpinning(false), 600)
        }}
        title="Refresh"
        style={{ ...pillStyle(false), padding: '9px 10px' }}
        onMouseEnter={onPillEnter}
        onMouseLeave={e => onPillLeave(e, false)}
      >
        <RefreshCw size={14} className={spinning ? 'animate-spin' : ''} />
      </button>

      {/* Filter pill */}
      <div ref={filterRef} className="relative">
        <button
          onClick={() => setFilterOpen(o => !o)}
          style={pillStyle(filterOpen)}
          onMouseEnter={onPillEnter}
          onMouseLeave={e => onPillLeave(e, filterOpen)}
        >
          <Filter size={14} />
          Filter
          {activeFilterCount > 0 && (
            <span
              className="flex items-center justify-center text-xs font-semibold rounded-full"
              style={{ minWidth: 18, height: 18, padding: '0 5px', backgroundColor: 'var(--color-accent)', color: '#ffffff' }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>

        {filterOpen && (
          <div
            className="absolute top-full left-0 mt-2 z-40 rounded-xl p-4 max-w-[calc(100vw-2.5rem)]"
            style={{
              minWidth: 280,
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            }}
          >
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Status</label>
                <MultiSelect
                  values={statusFilters}
                  onChange={onStatusFiltersChange}
                  options={STATUS_OPTIONS}
                  placeholder="All statuses"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Date From</label>
                <DateFieldPicker value={dateFrom} onChange={onDateFromChange} placeholder="Any date" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Date To</label>
                <DateFieldPicker value={dateTo} onChange={onDateToChange} placeholder="Any date" />
              </div>
            </div>
            {activeFilterCount > 0 && (
              <div className="flex justify-end mt-3">
                <button
                  onClick={clearAllFilters}
                  className="text-xs"
                  style={{ color: 'var(--color-accent)' }}
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

      {/* Search — first row on mobile, inline after Filter on desktop */}
      <div className="order-first md:order-none basis-full md:basis-auto md:w-60 md:shrink-0">
        {searchOpen ? (
          <div
            className="flex items-center gap-2 px-3 w-full"
            style={{
              height: 36,
              border: searchFocused ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
              borderRadius: 8,
              backgroundColor: 'var(--color-bg)',
            }}
          >
            <Search size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search by title or contact…"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={e => { if (e.key === 'Escape') handleSearchClose() }}
              className="text-base md:text-sm outline-none bg-transparent flex-1 min-w-0"
              style={{ color: 'var(--color-text-primary)' }}
            />
            <button
              onClick={handleSearchClose}
              style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-1.5 px-3"
            style={{
              height: 36,
              fontSize: 14,
              lineHeight: '1.25rem',
              fontWeight: 500,
              borderRadius: 8,
              cursor: 'pointer',
              border: `1px solid ${search ? 'var(--color-border-strong)' : 'var(--color-border)'}`,
              backgroundColor: search ? 'var(--color-surface)' : 'var(--color-bg)',
              color: 'var(--color-text-secondary)',
              transition: 'background var(--transition-fast), color var(--transition-fast)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
            }}
            onMouseLeave={e => {
              if (!search) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
            }}
          >
            <Search size={14} style={{ flexShrink: 0 }} />
            <span className="flex-1 text-left truncate">
              {search ? `"${search.slice(0, 14)}${search.length > 14 ? '…' : ''}"` : 'Search by title or contact…'}
            </span>
          </button>
        )}
      </div>
    </>
  )
}
