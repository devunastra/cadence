'use client'

import { useState, useEffect, useRef, useTransition, useCallback } from 'react'
import { useMounted } from '@/lib/hooks'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter, ChevronDown, Check, RefreshCw } from 'lucide-react'
import { fetchQualityReviews, fetchFollowUpKpis, savePageFilters } from '@/app/actions'
import type { QualityReviewRow, QualityReviewParams, FollowUpKpis, CallHistoryRow } from '@/app/actions'
import { STATUS_COLORS, NOTION_COLORS } from '@/lib/constants'
import { formatDateTime } from '@/lib/date-utils'
import { createClient } from '@/lib/supabase/client'
import { CallDetailDrawer } from '@/components/call-history/call-detail-drawer'
import { StatCard } from '@/components/call-analytics/stat-card'
import { ScheduledCallbacksTable } from '@/components/follow-ups/scheduled-callbacks-table'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Tab = 'follow_ups' | 'callbacks' | 'scheduled_callbacks'

const TABS: { key: Tab; label: string }[] = [
  { key: 'follow_ups', label: 'Follow-ups' },
  { key: 'callbacks', label: 'Callback Requests' },
  { key: 'scheduled_callbacks', label: 'Scheduled Callbacks' },
]

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

function getCallResult(row: { disconnected_reason: string | null; picked_up: boolean | null; transferred: boolean | null; appointment_booked: boolean | null }): string | null {
  if (row.disconnected_reason === 'voicemail') return 'Voicemail'
  if (row.disconnected_reason === 'dial_no_answer') return 'No Answer'
  if (row.disconnected_reason === 'dial_busy') return 'Busy'
  if (row.transferred) return 'Transferred'
  if (row.appointment_booked) return 'Booked'
  if (row.disconnected_reason === 'user_hangup') return 'Hung Up'
  if (row.picked_up === true) return 'Completed'
  return null
}

function toCallHistoryRow(r: QualityReviewRow): CallHistoryRow {
  return {
    id: r.call_id,
    retell_call_id: r.retell_call_id,
    created_at: r.call_created_at,
    duration_seconds: r.duration_seconds,
    outcome: r.outcome as CallHistoryRow['outcome'],
    sentiment: r.sentiment as CallHistoryRow['sentiment'],
    transcript_summary: r.transcript_summary,
    lead_id: r.lead_id,
    direction: r.direction,
    disconnected_reason: r.disconnected_reason as CallHistoryRow['disconnected_reason'],
    quality_score: r.quality_score,
    appointment_booked: r.appointment_booked,
    recording_url: r.recording_url,
    picked_up: r.picked_up,
    transferred: r.transferred,
    lead_name: r.lead_name,
    lead_phone: null,
  }
}

// ── Filter types ─────────────────────────────────────────────────────────────

interface FollowUpFilters {
  direction: string
  grade: string
  sentiment: string[]
  dateFrom: string
  dateTo: string
}

const DEFAULT_FILTERS: FollowUpFilters = {
  direction: '',
  grade: '',
  sentiment: [],
  dateFrom: '',
  dateTo: '',
}

function activeFilterCount(f: FollowUpFilters): number {
  let n = 0
  if (f.direction) n++
  if (f.grade) n++
  if (f.sentiment.length > 0) n++
  if (f.dateFrom || f.dateTo) n++
  return n
}

// ── Reusable dropdown components ─────────────────────────────────────────────

interface FieldSelectOption { value: string; label: string }

function FieldSelect({ label, value, onChange, options, placeholder = 'All' }: {
  label: string; value: string; onChange: (v: string) => void; options: FieldSelectOption[]; placeholder?: string
}) {
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
          <span className="truncate">{options.find(o => o.value === value)?.label ?? placeholder}</span>
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

// ── PageInput ────────────────────────────────────────────────────────────────

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

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-3 py-2">
          <div className="h-10 rounded skeleton-shimmer" style={{ width: i === 0 ? '70%' : i === 3 ? '90%' : '50%' }} />
        </td>
      ))}
    </tr>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

interface FollowUpsShellProps {
  studioId: string
}

export function FollowUpsShell({ studioId }: FollowUpsShellProps) {
  const [tab, setTab] = useState<Tab>('follow_ups')
  const [rows, setRows] = useState<QualityReviewRow[]>([])
  const [total, setTotal] = useState(0)
  const [kpis, setKpis] = useState<FollowUpKpis | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [filters, setFilters] = useState<FollowUpFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<{ field: string; ascending: boolean }>({ field: 'created_at', ascending: false })
  const [loading, setLoading] = useState(true)
  const [kpiLoading, setKpiLoading] = useState(true)
  const [selectedCall, setSelectedCall] = useState<CallHistoryRow | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [scheduledRefreshTrigger, setScheduledRefreshTrigger] = useState(0)
  const mounted = useMounted()
  const [, startTransition] = useTransition()
  const filterRef = useRef<HTMLDivElement>(null)

  // Initial load
  useEffect(() => {
    loadData('follow_ups', DEFAULT_FILTERS, { field: 'created_at', ascending: false }, 1, pageSize)
    loadKpis()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close filter panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Save filters (1s debounce)
  useEffect(() => {
    if (!mounted) return
    const t = setTimeout(() => {
      savePageFilters(studioId, {
        followUps: {
          filters: {
            direction: filters.direction,
            grade: filters.grade,
            sentiment: filters.sentiment,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
          },
          sort,
        },
      }).catch(() => {})
    }, 1000)
    return () => clearTimeout(t)
  }, [mounted, studioId, filters, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription for new/updated reviews
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('follow-ups-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'call_reviews',
        filter: `studio_id=eq.${studioId}`,
      }, () => {
        loadData(tab, filters, sort, page, pageSize)
        loadKpis()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [studioId, tab, filters, sort, page, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = useCallback((
    t: Tab,
    f: FollowUpFilters,
    srt: { field: string; ascending: boolean },
    p: number, ps: number,
  ) => {
    setLoading(true)
    startTransition(async () => {
      try {
        const params: QualityReviewParams = {
          studioId,
          filters: {
            grade: f.grade,
            direction: f.direction,
            sentiment: f.sentiment,
            dateFrom: f.dateFrom,
            dateTo: f.dateTo,
            followUpNeeded: t === 'follow_ups' ? true : undefined,
            callbackRequested: t === 'callbacks' ? true : undefined,
          },
          page: p,
          pageSize: ps,
          sort: srt,
        }
        const result = await fetchQualityReviews(params)
        setRows(result.rows)
        setTotal(result.total)
      } catch {
        // Keep previous results visible on error
      } finally {
        setLoading(false)
      }
    })
  }, [studioId]) // eslint-disable-line react-hooks/exhaustive-deps

  function loadKpis() {
    setKpiLoading(true)
    fetchFollowUpKpis(studioId)
      .then(data => setKpis(data))
      .catch(() => {})
      .finally(() => setKpiLoading(false))
  }

  function handleTabChange(t: Tab) {
    setTab(t)
    setPage(1)
    setSelectedCall(null)
    loadData(t, filters, sort, 1, pageSize)
  }

  function handleFilterChange(f: FollowUpFilters) {
    setFilters(f)
    setPage(1)
    loadData(tab, f, sort, 1, pageSize)
  }

  function handleSortChange(field: string) {
    const newSort = sort.field === field ? { field, ascending: !sort.ascending } : { field, ascending: false }
    setSort(newSort)
    setPage(1)
    loadData(tab, filters, newSort, 1, pageSize)
  }

  function handlePageChange(p: number) {
    setPage(p)
    loadData(tab, filters, sort, p, pageSize)
  }

  function handlePageSizeChange(ps: number) {
    setPageSize(ps)
    setPage(1)
    loadData(tab, filters, sort, 1, ps)
  }

  function handleRefresh() {
    if (tab === 'scheduled_callbacks') {
      setScheduledRefreshTrigger(t => t + 1)
      return
    }
    loadData(tab, filters, sort, page, pageSize)
    loadKpis()
  }

  function set<K extends keyof FollowUpFilters>(key: K, value: FollowUpFilters[K]) {
    handleFilterChange({ ...filters, [key]: value })
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1
  const showingTo = Math.min(page * pageSize, total)
  const count = activeFilterCount(filters)

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

  function SortIndicator({ field }: { field: string }) {
    if (sort.field !== field) return null
    return <span className="ml-1 text-xs">{sort.ascending ? '\u25B2' : '\u25BC'}</span>
  }

  const FOLLOW_UP_COLUMNS = [
    { key: 'created_at', label: 'Date', sortable: true },
    { key: 'lead_name', label: 'Lead', sortable: false },
    { key: 'duration_seconds', label: 'Duration', sortable: true },
    { key: 'follow_up_reason', label: 'Reason', sortable: false },
    { key: 'grade', label: 'Grade', sortable: true },
    { key: 'result', label: 'Result', sortable: false },
    { key: 'appt', label: 'Appt', sortable: false },
    { key: 'sentiment', label: 'Sentiment', sortable: false },
  ]

  const CALLBACK_COLUMNS = [
    { key: 'created_at', label: 'Date', sortable: true },
    { key: 'lead_name', label: 'Lead', sortable: false },
    { key: 'duration_seconds', label: 'Duration', sortable: true },
    { key: 'summary', label: 'Summary', sortable: false },
    { key: 'grade', label: 'Grade', sortable: true },
    { key: 'result', label: 'Result', sortable: false },
    { key: 'appt', label: 'Appt', sortable: false },
    { key: 'sentiment', label: 'Sentiment', sortable: false },
  ]

  const columns = tab === 'follow_ups' ? FOLLOW_UP_COLUMNS : CALLBACK_COLUMNS

  return (
    <div className="relative flex flex-col h-full px-5 pb-4 gap-3 [font-family:var(--font-inter,Inter,sans-serif)]">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3 flex-shrink-0">
        {kpiLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl h-[120px] skeleton-shimmer" style={{ border: '1px solid var(--color-border)' }} />
          ))
        ) : kpis ? (
          <>
            <StatCard title="Follow-ups Needed" value={`${kpis.followUpCount}`} />
            <StatCard title="Callback Requests" value={`${kpis.callbackCount}`} />
            <StatCard
              title="Pass Rate"
              value={`${kpis.passRate}%`}
              sub="across follow-ups & callbacks"
              valueColor={kpis.passRate >= 80 ? NOTION_COLORS.green.text : kpis.passRate >= 60 ? NOTION_COLORS.yellow.text : NOTION_COLORS.red.text}
            />
          </>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-0 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className="px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap"
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
      </div>

      {/* Toolbar: filter + refresh */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {tab !== 'scheduled_callbacks' && (
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => setFilterOpen(o => !o)}
              style={pillStyle}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)' }}
            >
              <Filter size={14} />
              <span>Filter</span>
              {count > 0 && (
                <span className="flex items-center justify-center text-xs font-semibold rounded-full" style={{ minWidth: 18, height: 18, padding: '0 5px', backgroundColor: 'var(--color-accent)', color: '#ffffff' }}>
                  {count}
                </span>
              )}
            </button>

            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-xl p-4 w-[520px] max-w-[calc(100vw-2.5rem)]"
                style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <div className="grid grid-cols-2 gap-3">
                  <FieldSelect label="Direction" value={filters.direction} onChange={v => set('direction', v)} options={[{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }]} />
                  <FieldSelect label="Grade" value={filters.grade} onChange={v => set('grade', v)} options={[{ value: 'Pass', label: 'Pass' }, { value: 'Fail', label: 'Fail' }]} />
                  <MultiFieldSelect label="Sentiment" values={filters.sentiment} onChange={v => set('sentiment', v)} options={[{ value: 'positive', label: 'Positive' }, { value: 'neutral', label: 'Neutral' }, { value: 'negative', label: 'Negative' }, { value: 'unknown', label: 'Unknown' }]} />
                  <div className="col-span-2">
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Date Range</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }} />
                      <input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)' }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleRefresh}
          className="p-2 rounded-lg"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)' }}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {tab === 'scheduled_callbacks' ? (
        <ScheduledCallbacksTable refreshTrigger={scheduledRefreshTrigger} />
      ) : (<>
      {/* Table card */}
      <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid var(--color-border)' }}>
        <div className="h-full overflow-y-auto overflow-x-auto no-theme-transition" style={{ backgroundColor: 'var(--color-bg)' }}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
              <tr>
                {columns.map(col => (
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
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    {count > 0
                      ? 'No results match these filters'
                      : tab === 'follow_ups'
                        ? 'No follow-ups needed at this time.'
                        : 'No callback requests found.'}
                  </td>
                </tr>
              ) : (
                rows.map(row => (
                  <tr
                    key={row.review_id}
                    className="cursor-pointer transition-colors bg-[var(--color-bg)] hover:bg-[var(--color-surface)]"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                    onClick={() => setSelectedCall(toCallHistoryRow(row))}
                  >
                    <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                      {formatDateTime(row.call_created_at)}
                    </td>
                    <td className="px-3 py-3 align-middle font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {row.lead_name ?? <span style={{ color: 'var(--color-text-muted)' }}>Unknown</span>}
                    </td>
                    <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatDurationMSS(row.duration_seconds)}
                    </td>
                    <td className="px-3 py-3 align-middle" style={{ color: 'var(--color-text-secondary)', maxWidth: 280 }}>
                      <span className="line-clamp-2 text-sm">
                        {tab === 'follow_ups'
                          ? (row.follow_up_reason ?? <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>)
                          : (row.summary ? row.summary.slice(0, 120) + (row.summary.length > 120 ? '...' : '') : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>)}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <Badge value={row.grade} />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {(() => { const r = getCallResult(row); return r ? <Badge value={r} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span> })()}
                    </td>
                    <td className="px-3 py-3 align-middle whitespace-nowrap" style={{
                      color: row.appointment_booked ? NOTION_COLORS.green.text : 'var(--color-text-muted)',
                      fontWeight: row.appointment_booked ? 500 : 400,
                    }}>
                      {row.appointment_booked == null ? '\u2014' : row.appointment_booked ? 'Yes' : 'No'}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {row.sentiment ? <Badge value={row.sentiment} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination footer */}
      <div className="flex-shrink-0 flex flex-col md:flex-row items-center justify-between gap-2 md:gap-0 px-2 py-1 md:py-0.5 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Rows per page</span>
          <div className="flex">
            {PAGE_SIZE_OPTIONS.map((size, i) => (
              <button
                key={size}
                onClick={() => handlePageSizeChange(size)}
                className={`px-3 py-1.5 text-sm ${i === 0 ? 'rounded-l-md' : i === PAGE_SIZE_OPTIONS.length - 1 ? 'rounded-r-md' : ''}`}
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
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  if (pageSize !== size) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                  }
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

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
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
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
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                }}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>
      </>)}

      {/* Detail drawer */}
      {selectedCall && (
        <CallDetailDrawer call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}
