'use client'

import { useState, useEffect, useRef, useTransition, useCallback } from 'react'
import { useMounted } from '@/lib/hooks'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Filter, ChevronDown, Check, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react'
import { fetchQualityReviews, fetchQualityKpis, savePageFilters, fetchUnreviewedCallIds, triggerCallAnalysis } from '@/app/actions'
import type { QualityReviewRow, QualityReviewParams, QualityKpis, CallHistoryRow } from '@/app/actions'
import { STATUS_COLORS, NOTION_COLORS } from '@/lib/constants'
import { formatDateTime } from '@/lib/date-utils'
import { createClient } from '@/lib/supabase/client'
import { CallDetailDrawer } from '@/components/call-history/call-detail-drawer'
import { StatCard } from '@/components/call-analytics/stat-card'

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Filter types ─────────────────────────────────────────────────────────────

interface QualityFilters {
  grade: string
  direction: string
  sentiment: string[]
  qualityScore: { op: '>=' | '<=' | '>' | '<' | '='; value: string }
  dateFrom: string
  dateTo: string
}

const DEFAULT_FILTERS: QualityFilters = {
  grade: '',
  direction: '',
  sentiment: [],
  qualityScore: { op: '>=', value: '' },
  dateFrom: '',
  dateTo: '',
}

function activeFilterCount(f: QualityFilters): number {
  let n = 0
  if (f.grade) n++
  if (f.direction) n++
  if (f.sentiment.length > 0) n++
  if (f.qualityScore.value !== '') n++
  if (f.dateFrom || f.dateTo) n++
  return n
}

// ── Reusable dropdown components ──────────────────────────────────────────────

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

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 10 }).map((_, i) => (
        <td key={i} className="px-3 py-2">
          <div className="h-10 rounded skeleton-shimmer" style={{ width: i === 0 ? '70%' : i === 1 ? '60%' : '50%' }} />
        </td>
      ))}
    </tr>
  )
}

// ── Map QualityReviewRow → CallHistoryRow for drawer ────────────────────────

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

// ── Main component ──────────────────────────────────────────────────────────

interface QualityReviewShellProps {
  studioId: string
  userRole: string
  isSuper: boolean
}

export function QualityReviewShell({ studioId, userRole, isSuper }: QualityReviewShellProps) {
  const canAnalyze = isSuper || userRole === 'studio_owner'
  const [rows, setRows] = useState<QualityReviewRow[]>([])
  const [total, setTotal] = useState(0)
  const [kpis, setKpis] = useState<QualityKpis | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [filters, setFilters] = useState<QualityFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<{ field: string; ascending: boolean }>({ field: 'review_created_at', ascending: false })
  const [loading, setLoading] = useState(true)
  const [kpiLoading, setKpiLoading] = useState(true)
  const [selectedCall, setSelectedCall] = useState<CallHistoryRow | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const mounted = useMounted()
  const [, startTransition] = useTransition()
  const filterRef = useRef<HTMLDivElement>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)
  const [unreviewedCount, setUnreviewedCount] = useState<number | null>(null)

  // Initial load
  useEffect(() => {
    loadData(DEFAULT_FILTERS, { field: 'review_created_at', ascending: false }, 1, pageSize)
    loadKpis()
    if (canAnalyze) {
      fetchUnreviewedCallIds(studioId).then(ids => setUnreviewedCount(ids.length)).catch(() => {})
    }
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
        qualityReview: {
          filters: {
            grade: filters.grade,
            direction: filters.direction,
            sentiment: filters.sentiment,
            qualityScore: filters.qualityScore,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
          },
          sort,
        },
      }).catch(() => {})
    }, 1000)
    return () => clearTimeout(t)
  }, [mounted, studioId, filters, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription for new reviews
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('quality-reviews-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'call_reviews',
        filter: `studio_id=eq.${studioId}`,
      }, () => {
        loadData(filters, sort, page, pageSize)
        loadKpis()
        if (canAnalyze) {
          fetchUnreviewedCallIds(studioId).then(ids => setUnreviewedCount(ids.length)).catch(() => {})
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [studioId, filters, sort, page, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = useCallback((
    f: QualityFilters,
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
            qualityScore: f.qualityScore,
            dateFrom: f.dateFrom,
            dateTo: f.dateTo,
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
    fetchQualityKpis(studioId)
      .then(data => setKpis(data))
      .catch(() => {})
      .finally(() => setKpiLoading(false))
  }

  function handleFilterChange(f: QualityFilters) {
    setFilters(f)
    setPage(1)
    loadData(f, sort, 1, pageSize)
  }

  function handleSortChange(field: string) {
    const newSort = sort.field === field ? { field, ascending: !sort.ascending } : { field, ascending: false }
    setSort(newSort)
    setPage(1)
    loadData(filters, newSort, 1, pageSize)
  }

  function handlePageChange(p: number) {
    setPage(p)
    loadData(filters, sort, p, pageSize)
  }

  function handlePageSizeChange(ps: number) {
    setPageSize(ps)
    setPage(1)
    loadData(filters, sort, 1, ps)
  }

  function handleRefresh() {
    loadData(filters, sort, page, pageSize)
    loadKpis()
    if (canAnalyze) {
      fetchUnreviewedCallIds(studioId).then(ids => setUnreviewedCount(ids.length)).catch(() => {})
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    setAnalyzeResult(null)
    try {
      const unreviewed = await fetchUnreviewedCallIds(studioId)
      if (unreviewed.length === 0) {
        setAnalyzeResult('All calls are already reviewed.')
        return
      }
      const batch = unreviewed.slice(0, 25)
      const result = await triggerCallAnalysis(studioId, batch)
      const succeeded = result.analyzed - result.errors.length
      const failed = result.errors.length
      let msg = `Done: ${succeeded} analyzed`
      if (failed > 0) {
        const firstErr = result.errors[0]?.error ?? 'Unknown'
        msg += `, ${failed} errors (${firstErr})`
      }
      if (result.skipped > 0) msg += `, ${result.skipped} skipped`
      setAnalyzeResult(msg)
      handleRefresh()
    } catch (err) {
      setAnalyzeResult(`Error: ${(err as Error).message}`)
    } finally {
      setAnalyzing(false)
    }
  }

  function set<K extends keyof QualityFilters>(key: K, value: QualityFilters[K]) {
    handleFilterChange({ ...filters, [key]: value })
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1
  const showingTo = Math.min(page * pageSize, total)
  const count = activeFilterCount(filters)

  const passRate = kpis && kpis.totalReviewed > 0 ? Math.round((kpis.passCount / kpis.totalReviewed) * 100) : 0
  const bookingRate = kpis && kpis.bookingAttempted > 0 ? Math.round((kpis.bookingSuccessful / kpis.bookingAttempted) * 100) : 0

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

  const COLUMNS = [
    { key: 'created_at', label: 'Date', sortable: true },
    { key: 'lead_name', label: 'Lead', sortable: false },
    { key: 'direction', label: 'Direction', sortable: false },
    { key: 'duration_seconds', label: 'Duration', sortable: true },
    { key: 'grade', label: 'Grade', sortable: true },
    { key: 'quality_score', label: 'Quality', sortable: true },
    { key: 'sentiment', label: 'Sentiment', sortable: false },
    { key: 'outcome', label: 'Outcome', sortable: false },
    { key: 'appointment_booked', label: 'Appt', sortable: false },
    { key: 'follow_up', label: 'Follow-up', sortable: false },
  ]

  return (
    <div className="relative flex flex-col h-full px-5 pb-4 gap-3 [font-family:var(--font-inter,Inter,sans-serif)]">
      {/* KPI Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 flex-shrink-0">
        {kpiLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl h-[120px] skeleton-shimmer" style={{ border: '1px solid var(--color-border)' }} />
          ))
        ) : kpis ? (
          <>
            <StatCard
              title="Review Coverage"
              value={`${kpis.totalReviewed}`}
              sub={`${kpis.totalEligible > 0 ? Math.round((kpis.totalReviewed / kpis.totalEligible) * 100) : 0}% of ${kpis.totalEligible} eligible`}
            />
            <StatCard
              title="Pass Rate"
              value={`${passRate}%`}
              sub={`${kpis.passCount} passed / ${kpis.totalReviewed} total`}
              valueColor={passRate >= 80 ? NOTION_COLORS.green.text : passRate >= 60 ? NOTION_COLORS.yellow.text : NOTION_COLORS.red.text}
            />
            <StatCard
              title="Avg User Repeats"
              value={`${kpis.avgUserRepeats}`}
              sub="per call"
            />
            <StatCard
              title="Follow-ups Needed"
              value={`${kpis.followUpNeededCount}`}
            />
            <StatCard
              title="Booking Success"
              value={`${bookingRate}%`}
              sub={`${kpis.bookingSuccessful} / ${kpis.bookingAttempted} attempted`}
              valueColor={bookingRate >= 70 ? NOTION_COLORS.green.text : bookingRate >= 40 ? NOTION_COLORS.yellow.text : NOTION_COLORS.red.text}
            />
            <div className="rounded-2xl p-5 flex flex-col gap-1 h-[120px]" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Top Mistakes</p>
              {kpis.topAgentMistakes.length === 0 ? (
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>No mistakes recorded</p>
              ) : (
                <div className="flex flex-col gap-0.5 mt-1 overflow-hidden">
                  {kpis.topAgentMistakes.slice(0, 3).map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>
                      <AlertTriangle size={10} style={{ color: NOTION_COLORS.red.text, flexShrink: 0 }} />
                      <span className="truncate">{m.mistake}</span>
                      <span className="ml-auto flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>({m.count})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* Toolbar: filter pill + actions */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap" ref={filterRef}>
        <button
          type="button"
          onClick={() => setFilterOpen(o => !o)}
          style={pillStyle}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)' }}
        >
          <Filter size={14} />
          <span>Filters</span>
          {count > 0 && (
            <span className="flex items-center justify-center rounded-full text-xs font-semibold" style={{ width: 18, height: 18, backgroundColor: 'var(--color-accent)', color: '#ffffff' }}>
              {count}
            </span>
          )}
        </button>

        {/* Refresh */}
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

        <div className="flex-1" />

        {/* Analyze button */}
        {canAnalyze && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-accent)',
                color: '#ffffff',
                cursor: analyzing ? 'wait' : 'pointer',
                transition: 'background var(--transition-fast)',
              }}
              onMouseEnter={e => { if (!analyzing) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)' }}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
            >
              <Sparkles size={14} />
              {analyzing ? 'Analyzing...' : 'Analyze Unreviewed'}
              {unreviewedCount != null && unreviewedCount > 0 && !analyzing && (
                <span className="flex items-center justify-center rounded-full text-xs font-semibold" style={{ width: 20, height: 20, backgroundColor: 'rgba(255,255,255,0.25)', color: '#ffffff' }}>
                  {unreviewedCount > 99 ? '99+' : unreviewedCount}
                </span>
              )}
            </button>
            {analyzeResult && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{analyzeResult}</span>
            )}
          </div>
        )}
      </div>

      {/* Filter panel */}
      {filterOpen && (
        <div className="flex-shrink-0 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 p-4 rounded-xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <FieldSelect label="Grade" value={filters.grade} onChange={v => set('grade', v)} options={[{ value: 'Pass', label: 'Pass' }, { value: 'Fail', label: 'Fail' }]} />
          <FieldSelect label="Direction" value={filters.direction} onChange={v => set('direction', v)} options={[{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }]} />
          <MultiFieldSelect label="Sentiment" values={filters.sentiment} onChange={v => set('sentiment', v)} options={[{ value: 'positive', label: 'Positive' }, { value: 'neutral', label: 'Neutral' }, { value: 'negative', label: 'Negative' }, { value: 'unknown', label: 'Unknown' }]} />
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Quality Score</label>
            <div className="flex gap-1">
              <OpPicker value={filters.qualityScore.op} onChange={op => set('qualityScore', { ...filters.qualityScore, op })} />
              <input
                type="number" min={0} max={10} step={0.1}
                value={filters.qualityScore.value}
                onChange={e => set('qualityScore', { ...filters.qualityScore, value: e.target.value })}
                placeholder="0-10"
                className="flex-1 px-3 py-2 rounded-lg text-sm"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)', outline: 'none' }}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>From</label>
            <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)', outline: 'none' }} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>To</label>
            <input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)', outline: 'none' }} />
          </div>
        </div>
      )}

      {/* Table card */}
      <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid var(--color-border)' }}>
        <div className="h-full overflow-y-auto overflow-x-auto no-theme-transition" style={{ backgroundColor: 'var(--color-bg)' }}>
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
            <tr>
              {COLUMNS.map(col => (
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
                <td colSpan={10} className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {count > 0 ? 'No reviews match these filters' : 'No call reviews yet. Use "Analyze Unreviewed" to generate reviews.'}
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
                  <td className="px-3 py-3 align-middle">
                    {row.direction ? <Badge value={row.direction} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatDurationMSS(row.duration_seconds)}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <Badge value={row.grade} />
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{
                    color: row.quality_score != null ? qualityScoreColor(row.quality_score) : 'var(--color-text-muted)',
                    fontWeight: row.quality_score != null ? 500 : 400,
                  }}>
                    {row.quality_score != null ? row.quality_score : '\u2014'}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {row.sentiment ? <Badge value={row.sentiment} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {row.outcome ? <Badge value={row.outcome} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap" style={{
                    color: row.appointment_booked ? NOTION_COLORS.green.text : 'var(--color-text-muted)',
                    fontWeight: row.appointment_booked ? 500 : 400,
                  }}>
                    {row.appointment_booked == null ? '\u2014' : row.appointment_booked ? 'Yes' : 'No'}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {row.follow_up_needed ? (
                      <span className="px-2 py-0.5 rounded text-sm font-medium status-bg-yellow status-text-yellow">Yes</span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Pagination footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-0.5 text-sm">
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

      {/* Detail drawer */}
      {selectedCall && (
        <CallDetailDrawer call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}
