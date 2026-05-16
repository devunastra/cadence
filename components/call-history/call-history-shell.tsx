'use client'

import { useState, useEffect, useRef, useTransition, useCallback } from 'react'
import { useMounted } from '@/lib/hooks'
import { Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter, ChevronDown, Check, X } from 'lucide-react'
import { fetchCallHistory, savePageFilters } from '@/app/actions'
import type { CallHistoryRow, CallHistoryParams } from '@/app/actions'
import { getMockCallHistory } from '@/lib/mock-data'
import { STATUS_COLORS, NOTION_COLORS } from '@/lib/constants'
import { formatDateTime } from '@/lib/date-utils'
import { createClient } from '@/lib/supabase/client'
import { CallDetailDrawer } from './call-detail-drawer'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Tab = 'all' | 'outbound' | 'inbound' | 'failed' | 'callbacks'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All Calls' },
  { key: 'outbound', label: 'Outbound' },
  { key: 'inbound', label: 'Inbound' },
  { key: 'failed', label: 'Failed' },
  { key: 'callbacks', label: 'Callbacks' },
]

const TAB_EMPTY_MESSAGES: Record<Tab, string> = {
  all: 'No calls have been recorded yet.',
  outbound: 'No outbound calls found.',
  inbound: 'No inbound calls found.',
  failed: 'No failed calls \u2014 all calls connected successfully.',
  callbacks: 'No callbacks recorded yet. Callbacks appear when a lead calls back after a missed outbound call.',
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]

function formatDurationMSS(seconds: number | null): string {
  if (seconds == null) return '\u2014'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function capitalize(s: string | null): string {
  return s ? s[0].toUpperCase() + s.slice(1) : '\u2014'
}

function Badge({ value }: { value: string }) {
  const colors = STATUS_COLORS[value]
  if (!colors) {
    return (
      <span className="px-2 py-0.5 rounded text-sm font-medium status-bg-gray status-text-gray">
        {capitalize(value)}
      </span>
    )
  }
  return (
    <span className={`px-2 py-0.5 rounded text-sm font-medium ${colors.bg} ${colors.text}`}>
      {capitalize(value)}
    </span>
  )
}

function qualityScoreColor(score: number): string {
  if (score >= 8) return NOTION_COLORS.green.text
  if (score >= 6) return NOTION_COLORS.yellow.text
  return NOTION_COLORS.red.text
}

function formatPhone(raw: string | null): string {
  if (!raw) return '\u2014'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return raw
}

function formatTimeSince(fromDate: string | null | undefined, toDate: string): string {
  if (!fromDate) return '\u2014'
  const diffMs = new Date(toDate).getTime() - new Date(fromDate).getTime()
  if (diffMs < 0) return '\u2014'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function CallbackChip() {
  return (
    <span className="px-2 py-0.5 rounded text-sm font-medium status-bg-orange status-text-orange">
      Callback
    </span>
  )
}

function ForwardedChip() {
  return (
    <span className="px-2 py-0.5 rounded text-sm font-medium status-bg-blue status-text-blue">
      Forwarded
    </span>
  )
}

// ── Filter types ─────────────────────────────────────────────────────────────

interface CallHistoryFilters {
  direction: 'all' | 'inbound' | 'outbound'
  sentiment: string[]
  outcome: string
  appointmentBooked: string
  disconnectedReason: string[]
  qualityScore: { op: '>=' | '<=' | '>' | '<' | '='; value: string }
  dateFrom: string
  dateTo: string
  callbackOnly: boolean
}

const DEFAULT_FILTERS: CallHistoryFilters = {
  direction: 'all',
  sentiment: [],
  outcome: '',
  appointmentBooked: '',
  disconnectedReason: [],
  qualityScore: { op: '>=', value: '' },
  dateFrom: '',
  dateTo: '',
  callbackOnly: false,
}

function activeFilterCount(f: CallHistoryFilters): number {
  let n = 0
  if (f.direction !== 'all') n++
  if (f.sentiment.length > 0) n++
  if (f.outcome) n++
  if (f.appointmentBooked) n++
  if (f.disconnectedReason.length > 0) n++
  if (f.qualityScore.value !== '') n++
  if (f.dateFrom || f.dateTo) n++
  if (f.callbackOnly) n++
  return n
}

// ── Reusable dropdown components (matching transcripts-filter-bar patterns) ──

interface FieldSelectOption { value: string; label: string }

function FieldSelect({ label, value, onChange, options, placeholder = 'All' }: {
  label: string; value: string; onChange: (v: string) => void; options: FieldSelectOption[]; placeholder?: string
}) {
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
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
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
          <ChevronDown size={13} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-[100] rounded-xl py-1 overflow-hidden" style={{ minWidth: '100%', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}>
            <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="w-full text-left px-3 py-2 text-sm whitespace-nowrap" style={{ backgroundColor: !value ? 'var(--color-accent)' : 'transparent', color: !value ? '#ffffff' : 'var(--color-text-muted)', transition: 'none' }}
              onMouseEnter={e => { if (value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { if (value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}>
              {placeholder}
            </button>
            {options.map(o => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false) }} className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
                style={{ backgroundColor: value === o.value ? 'var(--color-accent)' : 'transparent', color: value === o.value ? '#ffffff' : 'var(--color-text-primary)', fontWeight: value === o.value ? 500 : 400, transition: 'none' }}
                onMouseEnter={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
                onMouseLeave={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MultiFieldSelect({ label, values, onChange, options, placeholder = 'All' }: {
  label: string; values: string[]; onChange: (v: string[]) => void; options: FieldSelectOption[]; placeholder?: string
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

  function toggle(val: string) {
    if (values.includes(val)) {
      onChange(values.filter(v => v !== val))
    } else {
      const next = [...values, val]
      onChange(next.length === options.length ? [] : next)
    }
  }

  const displayLabel = values.length === 0 ? placeholder : values.length === 1 ? (options.find(o => o.value === values[0])?.label ?? values[0]) : `${values.length} selected`

  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
      <div className="relative">
        <button ref={buttonRef} type="button" onClick={handleToggle} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm w-full"
          style={{ border: '1px solid var(--color-border)', boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none', backgroundColor: 'var(--color-surface)', color: values.length > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)', transition: 'background var(--transition-fast)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}>
          <span className="truncate text-left flex-1">{displayLabel}</span>
          <ChevronDown size={13} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        {open && rect && (
          <div ref={panelRef} className="rounded-xl py-1 overflow-hidden" style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 1000, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}>
            <button type="button" onClick={() => onChange([])} className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
              style={{ backgroundColor: values.length === 0 ? 'var(--color-accent)' : 'transparent', color: values.length === 0 ? '#ffffff' : 'var(--color-text-muted)', transition: 'none' }}
              onMouseEnter={e => { if (values.length > 0) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { if (values.length > 0) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}>
              {placeholder}
            </button>
            {options.map(o => {
              const checked = values.includes(o.value)
              return (
                <button key={o.value} type="button" onClick={() => toggle(o.value)} className="w-full flex items-center justify-between px-3 py-2 text-sm whitespace-nowrap"
                  style={{ backgroundColor: 'transparent', color: 'var(--color-text-primary)', fontWeight: checked ? 500 : 400, transition: 'none' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = ''}>
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

const OPS = ['>=', '<=', '>', '<', '='] as const
type Op = typeof OPS[number]

function OpPicker({ value, onChange }: { value: Op; onChange: (op: Op) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center justify-center px-2 py-2 rounded-lg text-sm font-medium"
        style={{ border: '1px solid var(--color-border)', boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)', width: 52, transition: 'background var(--transition-fast)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}>
        {value}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-[100] rounded-xl py-1 overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.10)', minWidth: 52 }}>
          {OPS.map(op => (
            <button key={op} type="button" onClick={() => { onChange(op); setOpen(false) }} className="w-full text-center px-2 py-2 text-sm font-medium"
              style={{ backgroundColor: value === op ? 'var(--color-accent)' : 'transparent', color: value === op ? '#ffffff' : 'var(--color-text-primary)', transition: 'none' }}
              onMouseEnter={e => { if (value !== op) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { if (value !== op) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}>
              {op}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── PageInput (from leads-table pattern) ────────────────────────────────────

function PageInput({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (p: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const digits = Math.max(String(totalPages).length, 1)

  function commit() {
    const n = parseInt(value, 10)
    if (!isNaN(n) && n >= 1 && n <= totalPages && n !== page) onJump(n)
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md select-none transition-colors"
      style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)', cursor: editing ? 'default' : 'pointer' }}
      onClick={() => { if (!editing) { setValue(String(page)); setEditing(true) } }}
      onMouseEnter={e => { if (!editing) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)' }}>
      {editing ? (
        <input autoFocus value={value} onChange={e => setValue(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="bg-transparent focus:outline-none text-center" style={{ width: `${digits}ch`, color: 'var(--color-text-primary)' }} />
      ) : (
        <span style={{ display: 'inline-block', width: `${digits}ch`, textAlign: 'center' }}>{page}</span>
      )}
      <span style={{ color: 'var(--color-text-muted)' }}>/ {totalPages}</span>
    </div>
  )
}

// ── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-3 py-2">
          <div className="h-10 rounded skeleton-shimmer" style={{ width: i === 0 ? '70%' : i === 1 ? '60%' : '50%' }} />
        </td>
      ))}
    </tr>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

interface CallHistoryShellProps {
  studioId: string
}

export function CallHistoryShell({ studioId }: CallHistoryShellProps) {
  const [tab, setTab] = useState<Tab>('all')
  const [calls, setCalls] = useState<CallHistoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<CallHistoryFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<{ field: string; ascending: boolean }>({ field: 'created_at', ascending: false })
  const [loading, setLoading] = useState(true)
  const [selectedCall, setSelectedCall] = useState<CallHistoryRow | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const mounted = useMounted()
  const [, startTransition] = useTransition()
  const filterRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSearch = useRef(search)

  // Fetch initial data on mount
  useEffect(() => {
    loadCalls('all', '', DEFAULT_FILTERS, { field: 'created_at', ascending: false }, 1, pageSize)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close filter panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Debounced search (400ms) — skip initial mount to avoid duplicate fetch
  useEffect(() => {
    if (!mounted) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      debouncedSearch.current = search
      setPage(1)
      loadCalls(tab, search, filters, sort, 1, pageSize)
    }, 400)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save filters — disabled for mock data branch
  // Realtime subscription — disabled for mock data branch

  const loadCalls = useCallback((
    t: Tab, s: string, f: CallHistoryFilters,
    srt: { field: string; ascending: boolean },
    p: number, ps: number
  ) => {
    setLoading(true)
    const result = getMockCallHistory({
      tab: t, search: s, page: p, pageSize: ps, sort: srt,
      filters: {
        direction: f.direction,
        sentiment: f.sentiment,
        outcome: f.outcome,
        appointmentBooked: f.appointmentBooked,
        disconnectedReason: f.disconnectedReason,
        qualityScore: f.qualityScore,
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
        callbackOnly: f.callbackOnly,
      },
    })
    setCalls(result.calls)
    setTotal(result.total)
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleTabChange(t: Tab) {
    setTab(t)
    setPage(1)
    setSelectedCall(null)
    loadCalls(t, debouncedSearch.current, filters, sort, 1, pageSize)
  }

  function handleFilterChange(f: CallHistoryFilters) {
    setFilters(f)
    setPage(1)
    loadCalls(tab, debouncedSearch.current, f, sort, 1, pageSize)
  }

  function handleSortChange(field: string) {
    const newSort = sort.field === field ? { field, ascending: !sort.ascending } : { field, ascending: false }
    setSort(newSort)
    setPage(1)
    loadCalls(tab, debouncedSearch.current, filters, newSort, 1, pageSize)
  }

  function handlePageChange(p: number) {
    setPage(p)
    loadCalls(tab, debouncedSearch.current, filters, sort, p, pageSize)
  }

  function handlePageSizeChange(ps: number) {
    setPageSize(ps)
    setPage(1)
    loadCalls(tab, debouncedSearch.current, filters, sort, 1, ps)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1
  const showingTo = Math.min(page * pageSize, total)
  const count = activeFilterCount(filters)

  function set<K extends keyof CallHistoryFilters>(key: K, value: CallHistoryFilters[K]) {
    handleFilterChange({ ...filters, [key]: value })
  }

  const pillStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
    border: '1px solid var(--color-border)',
    boxShadow: filterOpen ? '0 0 0 2px var(--color-accent)' : 'none',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text-secondary)',
    fontSize: 14, lineHeight: '1.25rem', fontWeight: 500,
    transition: 'background var(--transition-fast), color var(--transition-fast)',
  }

  // Sort indicator
  function SortIndicator({ field }: { field: string }) {
    if (sort.field !== field) return null
    return <span className="ml-1 text-xs">{sort.ascending ? '\u25B2' : '\u25BC'}</span>
  }

  return (
    <div className="relative flex flex-col h-full px-5 pb-4 gap-3 [font-family:var(--font-inter,Inter,sans-serif)]">
      {/* Tabs */}
      <div className="flex items-center gap-0 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className="px-4 py-2.5 text-sm font-medium transition-colors relative"
            style={{
              color: tab === t.key ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            }}
            onMouseEnter={e => { if (tab !== t.key) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
            onMouseLeave={e => { if (tab !== t.key) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)' }}
          >
            {t.label}
            {tab === t.key && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: 'var(--color-accent)' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Toolbar: search + filter */}
      <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[360px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            placeholder="Search by lead name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-sm"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filter pill */}
        <div className="relative" ref={filterRef}>
          <button onClick={() => setFilterOpen(o => !o)} style={pillStyle}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)' }}>
            <Filter size={14} />
            <span>Filter</span>
            {count > 0 && (
              <span className="flex items-center justify-center text-xs font-semibold rounded-full"
                style={{ minWidth: 18, height: 18, padding: '0 5px', backgroundColor: 'var(--color-accent)', color: '#ffffff' }}>
                {count}
              </span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-xl p-4"
              style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', width: 520 }}>
              <div className="grid grid-cols-2 gap-3">
                <FieldSelect label="Direction"
                  value={filters.direction === 'all' ? '' : filters.direction}
                  onChange={v => set('direction', (v || 'all') as CallHistoryFilters['direction'])}
                  options={[{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }]} />
                <MultiFieldSelect label="Sentiment" values={filters.sentiment} onChange={v => set('sentiment', v)}
                  options={[{ value: 'positive', label: 'Positive' }, { value: 'neutral', label: 'Neutral' }, { value: 'negative', label: 'Negative' }, { value: 'unknown', label: 'Unknown' }]} />
                <FieldSelect label="Outcome" value={filters.outcome} onChange={v => set('outcome', v)}
                  options={[{ value: 'successful', label: 'Successful' }, { value: 'unsuccessful', label: 'Unsuccessful' }]} />
                <FieldSelect label="Appointment Booked" value={filters.appointmentBooked} onChange={v => set('appointmentBooked', v)}
                  options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} placeholder="Any" />
                <MultiFieldSelect label="Disconnect Reason" values={filters.disconnectedReason} onChange={v => set('disconnectedReason', v)}
                  options={[{ value: 'agent_hangup', label: 'Agent Hangup' }, { value: 'user_hangup', label: 'User Hangup' }, { value: 'voicemail', label: 'Voicemail' }, { value: 'dial_no_answer', label: 'No Answer' }, { value: 'dial_busy', label: 'Busy' }, { value: 'call_transfer', label: 'Transfer' }]} />
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Quality Score</label>
                  <div className="flex gap-2">
                    <OpPicker value={filters.qualityScore.op} onChange={op => set('qualityScore', { ...filters.qualityScore, op })} />
                    <input type="number" min={0} max={10} step={0.5} placeholder="0\u201310" value={filters.qualityScore.value}
                      onChange={e => set('qualityScore', { ...filters.qualityScore, value: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }} />
                  </div>
                </div>
                {/* Date range */}
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Date From</label>
                  <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Date To</label>
                  <input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }} />
                </div>
              </div>
              {/* Callback filter — only on All Calls and Inbound tabs */}
              {(tab === 'all' || tab === 'inbound') && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.callbackOnly}
                      onChange={e => set('callbackOnly', e.target.checked)}
                      className="rounded"
                      style={{ accentColor: 'var(--color-accent)' }}
                    />
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      Callbacks only
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      Show leads who called back after a missed outbound
                    </span>
                  </label>
                </div>
              )}
              {count > 0 && (
                <div className="flex justify-end mt-3">
                  <button type="button" onClick={() => handleFilterChange(DEFAULT_FILTERS)} className="text-xs font-medium"
                    style={{ color: 'var(--color-accent)', transition: 'color var(--transition-fast)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent)'}>
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Table */}
      <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid var(--color-border)' }}>
        <div className="h-full overflow-y-auto overflow-x-auto no-theme-transition" style={{ backgroundColor: 'var(--color-bg)' }}>
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
            <tr>
              {(tab === 'callbacks' ? [
                { key: 'created_at', label: 'Callback Date', sortable: true },
                { key: 'lead_name', label: 'Lead Name', sortable: false },
                { key: 'phone', label: 'Phone', sortable: false },
                { key: 'time_since', label: 'Time Since Missed', sortable: false },
                { key: 'duration_seconds', label: 'Duration', sortable: true },
                { key: 'outcome', label: 'Outcome', sortable: false },
                { key: 'status', label: 'Status', sortable: false },
                { key: 'quality_score', label: 'Quality', sortable: true },
              ] : [
                { key: 'created_at', label: 'Date/Time', sortable: true },
                { key: 'lead_name', label: 'Lead Name', sortable: false },
                { key: 'phone', label: 'Phone', sortable: false },
                { key: 'direction', label: 'Direction', sortable: false },
                { key: 'duration_seconds', label: 'Duration', sortable: true },
                { key: 'sentiment', label: 'Sentiment', sortable: false },
                { key: 'outcome', label: 'Outcome', sortable: false },
                { key: 'quality_score', label: 'Quality', sortable: true },
              ]).map(col => (
                <th
                  key={col.key}
                  className={`pl-3 pr-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${col.sortable ? 'cursor-pointer select-none' : ''}`}
                  style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}
                  onClick={col.sortable ? () => handleSortChange(col.key) : undefined}
                >
                  {col.label}
                  {col.sortable && <SortIndicator field={col.key} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {search ? 'No calls match your search' : count > 0 ? 'No calls match these filters' : TAB_EMPTY_MESSAGES[tab]}
                </td>
              </tr>
            ) : tab === 'callbacks' ? (
              calls.map(call => (
                <tr
                  key={call.id}
                  className="cursor-pointer transition-colors bg-[var(--color-bg)] hover:bg-[var(--color-surface)]"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                  onClick={() => setSelectedCall(call)}
                >
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {formatDateTime(call.created_at)}
                  </td>
                  <td className="px-3 py-3 align-middle font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {call.lead_name ?? <span style={{ color: 'var(--color-text-muted)' }}>Unknown</span>}
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatPhone(call.lead_phone ?? null)}
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTimeSince(call.last_missed_outbound_at, call.created_at)}
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatDurationMSS(call.duration_seconds)}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {call.outcome ? <Badge value={call.outcome} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <div className="flex items-center gap-1.5">
                      <CallbackChip />
                      {call.transferred && <ForwardedChip />}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{
                    color: call.quality_score != null ? qualityScoreColor(call.quality_score) : 'var(--color-text-muted)',
                    fontWeight: call.quality_score != null ? 500 : 400,
                  }}>
                    {call.quality_score != null ? call.quality_score : '\u2014'}
                  </td>
                </tr>
              ))
            ) : (
              calls.map(call => (
                <tr
                  key={call.id}
                  className="cursor-pointer transition-colors bg-[var(--color-bg)] hover:bg-[var(--color-surface)]"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                  onClick={() => setSelectedCall(call)}
                >
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                    {formatDateTime(call.created_at)}
                  </td>
                  <td className="px-3 py-3 align-middle font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {call.lead_name ?? <span style={{ color: 'var(--color-text-muted)' }}>Unknown contact</span>}
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {formatPhone(call.lead_phone ?? null)}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <div className="flex items-center gap-1.5">
                      {call.direction ? <Badge value={call.direction} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                      {call.is_callback && <CallbackChip />}
                      {call.is_callback && call.transferred && <ForwardedChip />}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatDurationMSS(call.duration_seconds)}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {call.sentiment ? <Badge value={call.sentiment} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {call.outcome ? <Badge value={call.outcome} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{
                    color: call.quality_score != null ? qualityScoreColor(call.quality_score) : 'var(--color-text-muted)',
                    fontWeight: call.quality_score != null ? 500 : 400,
                  }}>
                    {call.quality_score != null ? call.quality_score : '\u2014'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Pagination footer — matches leads-table style */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-0.5 text-sm">
        {/* Page size */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Rows per page</span>
          <div className="flex">
            {PAGE_SIZE_OPTIONS.map((size, i) => (
              <button
                key={size}
                onClick={() => handlePageSizeChange(size)}
                className={`px-3 py-1.5 text-sm ${
                  i === 0 ? 'rounded-l-md' : i === PAGE_SIZE_OPTIONS.length - 1 ? 'rounded-r-md' : ''
                }`}
                style={{
                  border: '1px solid var(--color-border)',
                  backgroundColor: pageSize === size ? 'var(--color-accent)' : 'var(--color-bg)',
                  color: pageSize === size ? '#ffffff' : 'var(--color-text-secondary)',
                  borderColor: pageSize === size ? 'var(--color-accent)' : 'var(--color-border)',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  if (pageSize !== size) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  if (pageSize !== size) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                  }
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Page info + nav */}
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {total === 0 ? 'No results' : `${showingFrom.toLocaleString()}\u2013${showingTo.toLocaleString()} of ${total.toLocaleString()}`}
          </span>
          <div className="flex items-center gap-1">
            {([
              { onClick: () => handlePageChange(1), disabled: page === 1 || loading, title: 'First page', Icon: ChevronsLeft },
              { onClick: () => handlePageChange(page - 1), disabled: page === 1 || loading, title: 'Previous page', Icon: ChevronLeft },
            ] as const).map(({ onClick, disabled, title, Icon }) => (
              <button
                key={title}
                onClick={onClick}
                disabled={disabled}
                title={title}
                className="p-2 rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-bg)',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  if (!disabled) {
                    ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                }}
              >
                <Icon size={16} />
              </button>
            ))}
            <PageInput page={page} totalPages={totalPages} onJump={handlePageChange} />
            {([
              { onClick: () => handlePageChange(page + 1), disabled: page >= totalPages || loading, title: 'Next page', Icon: ChevronRight },
              { onClick: () => handlePageChange(totalPages), disabled: page >= totalPages || loading, title: 'Last page', Icon: ChevronsRight },
            ] as const).map(({ onClick, disabled, title, Icon }) => (
              <button
                key={title}
                onClick={onClick}
                disabled={disabled}
                title={title}
                className="p-2 rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-bg)',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  if (!disabled) {
                    ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                }}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selectedCall && (
        <CallDetailDrawer call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}
