'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowLeft } from 'lucide-react'
import { useIsMobile } from '@/lib/hooks'
import {
  fetchCallTranscripts, fetchCallTranscriptFull, fetchLeadById, fetchCallsForLead,
  addStudioFieldOption, renameStudioFieldOption, deleteStudioFieldOption, updateStudioFieldOptionColor,
  refreshSingleCallFromRetell,
} from '@/app/actions'
import type { TranscriptCallRow, RetellTranscriptItem } from '@/app/actions'
import { TranscriptViewer } from './transcript-viewer'
import { formatDateTime } from '@/lib/date-utils'
import { Spinner } from '@/components/spinner'
import { applyTranscriptFilters } from '@/lib/call-filters'
import { type TranscriptFilters, DEFAULT_FILTERS } from './transcripts-filter-bar'
import type { Lead } from '@/lib/types'
import type { FieldOption } from '@/lib/field-options'

type TranscriptCall = TranscriptCallRow

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
    <div
      className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md select-none transition-colors"
      style={{
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
        backgroundColor: 'var(--color-bg)',
        cursor: editing ? 'default' : 'pointer',
      }}
      onClick={() => { if (!editing) { setValue(String(page)); setEditing(true) } }}
      onMouseEnter={e => { if (!editing) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)' }}
    >
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="bg-transparent focus:outline-none text-center"
          style={{ width: `${digits}ch`, color: 'var(--color-text-primary)' }}
        />
      ) : (
        <span style={{ display: 'inline-block', width: `${digits}ch`, textAlign: 'center' }}>{page}</span>
      )}
      <span style={{ color: 'var(--color-text-muted)' }}>/ {totalPages}</span>
    </div>
  )
}

interface TranscriptsPanelProps {
  studioId: string
  from?: string
  to?: string
  leadId?: string
  listWidth?: string
  hidePagination?: boolean
  filters?: TranscriptFilters
  initialFieldOptions?: Record<string, Array<{ id: string; value: string; bg: string | null; text: string | null }>>
  transcriptRefreshTrigger?: number
  onMobileDetailChange?: (inDetail: boolean) => void
}

const PAGE_SIZE = 20

export function TranscriptsPanel({ studioId, from = '', to = '', leadId, listWidth, hidePagination, filters = DEFAULT_FILTERS, initialFieldOptions = {}, transcriptRefreshTrigger, onMobileDetailChange }: TranscriptsPanelProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  const [calls, setCalls]         = useState<TranscriptCall[] | null>(null)
  const [page, setPage]           = useState(1)
  const [selected, setSelected]   = useState<TranscriptCall | null>(null)
  const [loaded, setLoaded]       = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPending, startTransition] = useTransition()

  const [transcriptDataCache, setTranscriptDataCache] = useState<Record<string, { transcript: string | null; toolCalls: RetellTranscriptItem[] | null }>>({})
  const [fetchingTranscriptFor, setFetchingTranscriptFor] = useState<string | null>(null)

  const [fieldOptions, setFieldOptions] = useState<Record<string, FieldOption[]>>(initialFieldOptions as Record<string, FieldOption[]>)

  const fetchingRef  = useRef<Set<string>>(new Set())
  const lastLoadKey  = useRef<string | null>(null)

  function openLead(leadId: string) {
    router.push(`/leads/${leadId}`)
  }

  async function handleOptionAdded(field: string, value: string): Promise<{ id: string; value: string }> {
    return addStudioFieldOption(studioId, field, value)
  }

  function handleOptionRenamed(field: string, oldValue: string, newValue: string) {
    renameStudioFieldOption(studioId, field, oldValue, newValue)
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).map(o => o.value === oldValue ? { ...o, value: newValue } : o),
    }))
  }

  async function handleOptionDeleted(field: string, optionId: string) {
    await deleteStudioFieldOption(optionId)
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).filter(o => o.id !== optionId),
    }))
  }

  function handleOptionsChange(field: string, options: FieldOption[]) {
    setFieldOptions(prev => ({ ...prev, [field]: options }))
    for (const opt of options) {
      if (opt.id) updateStudioFieldOptionColor(opt.id, opt.bg, opt.text)
    }
  }

  async function fetchTranscriptIfMissing(callId: string) {
    if (transcriptDataCache[callId] !== undefined || fetchingRef.current.has(callId)) return

    fetchingRef.current.add(callId)
    setFetchingTranscriptFor(callId)
    try {
      const data = await fetchCallTranscriptFull(callId)
      setTranscriptDataCache(prev => ({ ...prev, [callId]: { transcript: data.transcript, toolCalls: data.transcriptWithToolCalls } }))
    } finally {
      fetchingRef.current.delete(callId)
      setFetchingTranscriptFor(null)
    }
  }

  function handleSelectCall(call: TranscriptCall) {
    setSelected(call)
    fetchTranscriptIfMissing(call.id)
    if (isMobile) {
      setMobileView('detail')
      onMobileDetailChange?.(true)
    }
  }

  function handleMobileBack() {
    setMobileView('list')
    onMobileDetailChange?.(false)
  }

  // Fetch ALL calls for the date range — client-side filters + pagination operate on the full set
  function load() {
    setIsLoading(true)
    setLoaded(false)
    setPage(1)
    setSelected(null)
    startTransition(async () => {
      if (leadId) {
        const rawCalls = await fetchCallsForLead(leadId, studioId)
        if (rawCalls[0]) await fetchTranscriptIfMissing(rawCalls[0].id)
        setCalls(rawCalls as TranscriptCall[])
        setLoaded(true)
        setIsLoading(false)
        if (rawCalls[0]) setSelected(rawCalls[0] as TranscriptCall)
        return
      }

      // Fetch all calls — no server-side pagination (pass large pageSize, page 1)
      const result = await fetchCallTranscripts(studioId, from, to, 1, 2000, filters.direction)
      setCalls(result.calls)
      setLoaded(true)
      setIsLoading(false)
    })
  }

  // Refetch when date range or direction changes — dedup ref prevents StrictMode double-fires
  useEffect(() => {
    if (leadId) {
      if (lastLoadKey.current === `lead:${leadId}`) return
      lastLoadKey.current = `lead:${leadId}`
      load()
      return
    }
    const key = `${from}|${to}|${filters.direction}`
    if (lastLoadKey.current === key) return
    lastLoadKey.current = key
    load()
  }, [from, to, leadId, filters.direction]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to page 1 when client-side filters change
  useEffect(() => {
    setPage(1)
    setSelected(null)
  }, [filters.sentiment, filters.outcome, filters.appointmentBooked, filters.disconnectedReason, filters.qualityScore.value, filters.qualityScore.op]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh selected call from Retell + reload list when triggered
  useEffect(() => {
    if (transcriptRefreshTrigger === undefined || transcriptRefreshTrigger === 0) return
    setIsRefreshing(true)
    startTransition(async () => {
      // 1. Refresh selected call from Retell (writes transcript_with_tool_calls to DB)
      let freshCallId: string | null = null
      if (selected) {
        const updated = await refreshSingleCallFromRetell(selected.id, studioId)
        if (updated) {
          const { transcript, ...callData } = updated
          freshCallId = callData.id
          setSelected(callData as typeof selected)
          // Invalidate cache so the re-fetched enriched data loads on next render
          setTranscriptDataCache(prev => { const n = { ...prev }; delete n[callData.id]; return n })
        }
      }
      // 2. Reload full call list from DB
      const result = await fetchCallTranscripts(studioId, from, to, 1, 2000, filters.direction)
      setCalls(result.calls)
      // 3. If cache was invalidated, re-fetch full transcript data
      if (freshCallId !== null) {
        const data = await fetchCallTranscriptFull(freshCallId)
        setTranscriptDataCache(prev => ({ ...prev, [freshCallId!]: { transcript: data.transcript, toolCalls: data.transcriptWithToolCalls } }))
      }
      setIsRefreshing(false)
    })
  }, [transcriptRefreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply client-side filters to the full fetched set, then paginate
  const filteredCalls = calls ? applyTranscriptFilters(calls, filters) : []
  const totalPages = Math.max(1, Math.ceil(filteredCalls.length / PAGE_SIZE))
  const displayCalls = filteredCalls.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Auto-select first call when page changes and nothing is selected
  useEffect(() => {
    if (displayCalls.length > 0 && !selected) {
      setSelected(displayCalls[0])
      fetchTranscriptIfMissing(displayCalls[0].id)
    }
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  function capitalize(s: string | null) { return s ? s[0].toUpperCase() + s.slice(1) : '—' }

  if (isLoading || isRefreshing) {
    return (
      <div className="flex md:flex-1 md:min-h-0 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (loaded && displayCalls.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {calls?.length === 0
          ? (leadId ? 'No calls yet.' : 'No calls in this date range.')
          : 'No calls match the current filters.'}
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col md:flex-row md:flex-1 md:min-h-0 gap-4">
      {/* Left: call list — scrollable within itself */}
      {(!isMobile || mobileView === 'list') && (
      <div
        className={`${listWidth ?? 'w-full md:w-72'} shrink-0 flex flex-col rounded-2xl overflow-hidden ${isMobile ? 'flex-1' : ''}`}
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex-1 overflow-y-auto">
          {displayCalls.map(call => {
            const isSelected = selected?.id === call.id
            return (
              <button
                key={call.id}
                onClick={() => handleSelectCall(call)}
                className="w-full text-left px-4 py-3 transition-colors"
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  backgroundColor: isSelected ? 'var(--color-accent-subtle)' : 'transparent',
                }}
                onMouseEnter={e => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
                }}
                onMouseLeave={e => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                }}
              >
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-body)' }}>
                  {call.lead_name ?? '—'}
                </p>
                {call.lead_phone && (
                  <p className="text-sm truncate mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {call.lead_phone}
                  </p>
                )}
                <p className="text-sm truncate mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {formatDateTime(call.created_at)}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <p className="text-sm font-medium">
                    <span style={{ color: 'var(--color-text-secondary)' }}>Appointment Booked: </span>
                    <span style={{ color: call.appointment_booked ? '#448361' : '#C4554D' }}>
                      {call.appointment_booked ? 'Yes' : 'No'}
                    </span>
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Pagination */}
        {!hidePagination && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
            {([
              { onClick: () => setPage(1), disabled: page === 1, title: 'First page', Icon: ChevronsLeft },
              { onClick: () => setPage(p => p - 1), disabled: page === 1, title: 'Previous page', Icon: ChevronLeft },
            ] as const).map((btn, i) => (
              <button
                key={i}
                onClick={btn.onClick}
                disabled={btn.disabled}
                title={btn.title}
                className="p-2.5 md:p-2 rounded-md disabled:opacity-30 disabled:pointer-events-none transition-colors"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
              >
                <btn.Icon size={16} />
              </button>
            ))}
            <PageInput page={page} totalPages={totalPages} onJump={setPage} />
            {([
              { onClick: () => setPage(p => p + 1), disabled: page === totalPages, title: 'Next page', Icon: ChevronRight },
              { onClick: () => setPage(totalPages), disabled: page === totalPages, title: 'Last page', Icon: ChevronsRight },
            ] as const).map((btn, i) => (
              <button
                key={i}
                onClick={btn.onClick}
                disabled={btn.disabled}
                title={btn.title}
                className="p-2.5 md:p-2 rounded-md disabled:opacity-30 disabled:pointer-events-none transition-colors"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
              >
                <btn.Icon size={16} />
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Right: transcript viewer — fills remaining space, scrolls within itself */}
      {(!isMobile || mobileView === 'detail') && (
      <div
        className="flex-1 flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        {/* Mobile back button */}
        {isMobile && selected && (
          <div
            className="flex items-center gap-2 px-3 py-2.5 shrink-0"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <button
              onClick={handleMobileBack}
              className="w-9 h-9 flex items-center justify-center rounded-lg shrink-0 transition-colors hover:bg-[var(--color-surface)]"
              style={{ color: 'var(--color-text-primary)' }}
              aria-label="Back to call list"
            >
              <ArrowLeft size={20} />
            </button>
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {selected.lead_name ?? 'Transcript'}
            </span>
          </div>
        )}
        {selected ? (
          <TranscriptViewer
            call={{ ...selected, transcript: transcriptDataCache[selected.id]?.transcript ?? null }}
            transcriptWithToolCalls={transcriptDataCache[selected.id]?.toolCalls ?? null}
            isLoadingTranscript={fetchingTranscriptFor === selected.id}
            onNameClick={selected.lead_id ? () => openLead(selected.lead_id!) : undefined}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Select a call to view the transcript
          </div>
        )}
      </div>
      )}
    </div>
    </>
  )
}
