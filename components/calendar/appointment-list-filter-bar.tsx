'use client'

import { useState, useRef, useEffect } from 'react'
import { Filter, ArrowUpDown, Search, X, ArrowUp, ArrowDown, ChevronDown, RefreshCw, ChevronLeft, ChevronRight, Check } from 'lucide-react'

const SORT_FIELDS: { key: string; label: string }[] = [
  { key: 'start_time', label: 'Appointment Time' },
  { key: 'title',      label: 'Title' },
  { key: 'status',     label: 'Status' },
]

const SORT_DIRECTIONS: { key: string; label: string }[] = [
  { key: 'asc',  label: 'Ascending' },
  { key: 'desc', label: 'Descending' },
]

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
  sortField: 'start_time' | 'title' | 'status'
  sortAscending: boolean
  onSortChange: (field: string, ascending: boolean) => void
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

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_HEADERS = ['Su','Mo','Tu','We','Th','Fr','Sa']

function DateFieldPicker({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
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
        className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm w-full text-left"
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
              <button type="button" onClick={prevMonth} className="p-1 rounded transition-colors" style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>
                <ChevronLeft size={14} />
              </button>
              <button type="button" onClick={nextMonth} className="p-1 rounded transition-colors" style={{ color: 'var(--color-text-secondary)' }}
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

// ── Sort select (internal) ────────────────────────────────────────────────────

function SortSelect({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { key: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.key === value)

  useEffect(() => {
    if (!open) return
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm rounded-lg"
        style={{
          minWidth: 130,
          border: '1px solid var(--color-border)',
          boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-primary)',
          fontWeight: 500,
          transition: 'background var(--transition-fast)',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl py-1 overflow-hidden"
          style={{
            minWidth: '100%',
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
          }}
        >
          {options.map(opt => (
            <button
              key={opt.key}
              onClick={() => { onChange(opt.key); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
              style={{
                backgroundColor: value === opt.key ? 'var(--color-accent)' : 'transparent',
                color: value === opt.key ? '#ffffff' : 'var(--color-text-primary)',
                fontWeight: value === opt.key ? 500 : 400,
                transition: 'none',
              }}
              onMouseEnter={e => { if (value !== opt.key) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { if (value !== opt.key) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main filter bar ───────────────────────────────────────────────────────────

export function AppointmentListFilterBar({
  search, onSearchChange,
  statusFilters, onStatusFiltersChange,
  dateFrom, onDateFromChange,
  dateTo, onDateToChange,
  sortField, sortAscending, onSortChange,
  onRefresh,
}: AppointmentListFilterBarProps) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const activeFilterCount = [statusFilters.length > 0, !!dateFrom, !!dateTo].filter(Boolean).length
  const isSortCustom = !(sortField === 'start_time' && sortAscending)

  useEffect(() => {
    if (!filterOpen) return
    function h(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [filterOpen])

  useEffect(() => {
    if (!sortOpen) return
    function h(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [sortOpen])

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

      {/* Sort pill */}
      <div ref={sortRef} className="relative">
        <button
          onClick={() => setSortOpen(o => !o)}
          style={pillStyle(sortOpen || isSortCustom)}
          onMouseEnter={onPillEnter}
          onMouseLeave={e => onPillLeave(e, sortOpen || isSortCustom)}
        >
          <ArrowUpDown size={14} />
          Sort
          {sortAscending
            ? <ArrowUp size={14} strokeWidth={2.5} style={{ color: 'var(--color-accent)' }} />
            : <ArrowDown size={14} strokeWidth={2.5} style={{ color: 'var(--color-accent)' }} />
          }
        </button>

        {sortOpen && (
          <div
            className="absolute top-full left-0 mt-2 z-40 rounded-xl overflow-visible"
            style={{
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <SortSelect
                value={sortField}
                onChange={v => onSortChange(v, sortAscending)}
                options={SORT_FIELDS}
              />
              <SortSelect
                value={sortAscending ? 'asc' : 'desc'}
                onChange={v => onSortChange(sortField, v === 'asc')}
                options={SORT_DIRECTIONS}
              />
              {isSortCustom && (
                <button
                  onClick={() => { onSortChange('start_time', true); setSortOpen(false) }}
                  className="p-1 rounded transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                  title="Reset sort"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="basis-full md:basis-auto md:w-60 md:shrink-0">
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
              className="text-sm outline-none bg-transparent flex-1 min-w-0"
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
