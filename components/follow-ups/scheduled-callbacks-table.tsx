'use client'

import { useEffect, useState, useCallback, useTransition } from 'react'
import { PhoneOff, X, Loader2 } from 'lucide-react'
import {
  fetchScheduledCalls,
  cancelScheduledCall,
  fetchMostRecentCallForLead,
} from '@/app/actions'
import type { CallHistoryRow } from '@/app/actions'
import { formatDateTime } from '@/lib/date-utils'
import { useCurrentStudio } from '@/components/studio-context'
import { useToast } from '@/components/ui/toast-provider'
import { createClient } from '@/lib/supabase/client'
import { CallDetailDrawer } from '@/components/call-history/call-detail-drawer'
import type { PendingScheduledCall } from '@/lib/types'

function formatPhone(raw: string | null): string {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return raw
}

function formatName(first: string | null, last: string | null): string {
  const parts = [first, last].filter(Boolean) as string[]
  return parts.length > 0 ? parts.join(' ') : '—'
}

const COLUMNS = ['Name', 'Phone', 'Email', 'Scheduled For', 'Source', 'Reason', 'Note', 'Dance Interest', ''] as const

// Total calls in a no-answer ladder: the original call plus four retries.
// followup_attempt counts the retries (1-4), so rung 1 is overall attempt 2.
const LADDER_TOTAL = 5

function SourceBadge({
  source,
  followupAttempt,
}: {
  source: PendingScheduledCall['source']
  followupAttempt: PendingScheduledCall['followup_attempt']
}) {
  // A follow-up says *where in the sequence* it is, not just who queued it —
  // "one more try left" is the thing staff actually need before they decide to
  // call by hand. Orange matches the Callback chip in Call History: same idea of
  // a lead the agent hasn't reached yet.
  if (source === 'followup') {
    const attempt = followupAttempt !== null ? followupAttempt + 1 : null
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap status-bg-orange status-text-orange"
        title="Queued automatically because the previous call went unanswered"
      >
        {attempt !== null ? `Auto follow-up · attempt ${attempt} of ${LADDER_TOTAL}` : 'Auto follow-up'}
      </span>
    )
  }

  const isManual = source === 'manual'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
        isManual ? 'status-bg-blue status-text-blue' : 'status-bg-gray status-text-gray'
      }`}
    >
      {isManual ? 'Scheduled by staff' : 'AI agent'}
    </span>
  )
}

function SkeletonRow() {
  return (
    <tr>
      {COLUMNS.map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div
            className="h-5 rounded skeleton-shimmer"
            style={{ width: i === 0 ? '70%' : i === COLUMNS.length - 1 ? '20%' : '60%' }}
          />
        </td>
      ))}
    </tr>
  )
}

// ── Cancel confirmation modal (amber + PhoneOff variant of confirm-delete-modal) ──

function CancelConfirmModal({
  call,
  isPending,
  onConfirm,
  onClose,
  tz,
}: {
  call: PendingScheduledCall
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
  tz: string
}) {
  const name = formatName(call.first_name, call.last_name)
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-150"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2.5 md:p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'transparent')}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="px-6 pt-6 pb-4">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: 'rgba(217,119,6,0.12)' }}
          >
            <PhoneOff size={20} style={{ color: '#d97706' }} />
          </div>

          <p className="text-base font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Cancel scheduled call?
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            The AI agent will not call <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{name}</span> at{' '}
            {call.callback_time ? formatDateTime(call.callback_time, tz) : 'the scheduled time'}.
            This cannot be undone.
          </p>
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)')}
          >
            Keep Call
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-60 flex items-center gap-2"
            style={{ backgroundColor: '#d97706' }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = '#b45309')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = '#d97706')}
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {isPending ? 'Cancelling…' : 'Cancel Call'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main table ───────────────────────────────────────────────────────────────

interface Props {
  studioId: string
  refreshTrigger: number
}

export function ScheduledCallbacksTable({ studioId, refreshTrigger }: Props) {
  const { currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  const [rows, setRows] = useState<PendingScheduledCall[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<PendingScheduledCall | null>(null)
  const [selectedCall, setSelectedCall] = useState<CallHistoryRow | null>(null)
  const [openingDetailFor, setOpeningDetailFor] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const { showSuccess, showWarning, showError } = useToast()

  async function handleRowClick(row: PendingScheduledCall) {
    if (openingDetailFor !== null) return
    // A queued call can predate the lead record (an inbound caller who isn't a
    // lead yet), so there may be nothing to open.
    if (!row.lead_id) {
      showWarning(`${formatName(row.first_name, row.last_name)} isn't linked to a lead yet`)
      return
    }
    setOpeningDetailFor(row.id)
    try {
      const call = await fetchMostRecentCallForLead(row.lead_id, row.studio_id)
      if (call) {
        setSelectedCall(call)
      } else {
        showWarning(`No call history yet for ${formatName(row.first_name, row.last_name)}`)
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to load call details')
    } finally {
      setOpeningDetailFor(null)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    startTransition(async () => {
      try {
        setRows(await fetchScheduledCalls(studioId))
      } catch (e) {
        const raw = e instanceof Error ? e.message : ''
        // Next.js production builds sanitize server action errors into a generic
        // "An error occurred in the Server Components render..." string. Show a
        // useful message instead of that blob.
        const isSanitized = raw.includes('Server Components render') || raw.includes('digest property')
        setError(isSanitized ? 'Could not load scheduled calls. Please refresh or try again.' : raw || 'Failed to load scheduled calls')
      } finally {
        setLoading(false)
      }
    })
  }, [studioId])

  // Initial load + external refresh trigger
  useEffect(() => {
    load()
  }, [load, refreshTrigger])

  // Realtime: the dialer settles rows out-of-band every 30 minutes, and a
  // colleague may queue one from another session. Pre-053 this table could only
  // learn about either by a manual refresh or a window focus.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('scheduled-calls-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'scheduled_calls',
        filter: `studio_id=eq.${studioId}`,
      }, () => load())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [studioId, load])

  // Auto-refresh on window focus
  useEffect(() => {
    function onFocus() {
      load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  async function handleConfirmCancel() {
    if (!confirmTarget) return
    const target = confirmTarget
    setCancellingId(target.id)
    try {
      const { cancelled } = await cancelScheduledCall(target.id)
      setRows(prev => prev.filter(r => r.id !== target.id))
      if (cancelled) {
        showSuccess(`Call cancelled for ${formatName(target.first_name, target.last_name)}`)
      } else {
        showWarning('That call already went out — the AI agent dialled it before this was cancelled')
      }
      setConfirmTarget(null)
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to cancel the call')
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <>
      <div
        className="relative md:flex-1 md:min-h-0 rounded-xl overflow-hidden shadow-sm"
        style={{ border: '1px solid var(--color-border)' }}
      >
        <div
          className="md:h-full overflow-x-auto md:overflow-y-auto no-theme-transition"
          style={{ backgroundColor: 'var(--color-bg)' }}
        >
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
              <tr>
                {COLUMNS.map((label, i) => (
                  <th
                    key={i}
                    className="pl-3 pr-4 py-3 text-left text-xs font-medium uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}
                  >
                    {label}
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
              ) : error ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    <div className="flex flex-col items-center gap-2">
                      <span>{error}</span>
                      <button
                        onClick={load}
                        className="px-3 py-1.5 text-sm rounded-md"
                        style={{
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-bg)',
                          color: 'var(--color-text-primary)',
                        }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)')}
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No scheduled calls at this time.
                  </td>
                </tr>
              ) : (
                rows.map(row => {
                  const isCancelling = cancellingId === row.id
                  const isOpeningDetail = openingDetailFor === row.id
                  return (
                    <tr
                      key={row.id}
                      className="group cursor-pointer transition-colors bg-[var(--color-bg)] hover:bg-[var(--color-surface)]"
                      style={{ borderBottom: '1px solid var(--color-border)', opacity: isOpeningDetail ? 0.6 : 1 }}
                      onClick={() => handleRowClick(row)}
                    >
                      <td className="px-3 py-3 align-middle font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {formatName(row.first_name, row.last_name)}
                      </td>
                      <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatPhone(row.phone_number)}
                      </td>
                      <td className="px-3 py-3 align-middle" style={{ color: 'var(--color-text-primary)' }}>
                        {row.email ?? <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>}
                      </td>
                      <td className="px-3 py-3 align-middle whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
                        {row.callback_time ? formatDateTime(row.callback_time, tz) : <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <SourceBadge source={row.source} followupAttempt={row.followup_attempt} />
                      </td>
                      <td className="px-3 py-3 align-middle" style={{ color: 'var(--color-text-secondary)', maxWidth: 180 }}>
                        <span className="line-clamp-2">
                          {row.reason ?? <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle" style={{ color: 'var(--color-text-secondary)', maxWidth: 220 }}>
                        <span className="line-clamp-2">
                          {row.call_note ?? <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle" style={{ color: 'var(--color-text-secondary)', maxWidth: 220 }}>
                        <span className="line-clamp-2">
                          {row.dance_interest ?? <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-middle text-right" style={{ width: 56 }}>
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmTarget(row) }}
                          disabled={isCancelling}
                          title="Cancel scheduled call"
                          aria-label="Cancel scheduled call"
                          className="inline-flex items-center justify-center p-2.5 md:p-1.5 rounded-md transition-all"
                          style={{
                            opacity: isCancelling ? 1 : 0.4,
                            color: 'var(--color-text-secondary)',
                            cursor: isCancelling ? 'not-allowed' : 'pointer',
                          }}
                          onMouseEnter={e => {
                            if (isCancelling) return
                            ;(e.currentTarget as HTMLElement).style.opacity = '1'
                            ;(e.currentTarget as HTMLElement).style.color = '#d97706'
                            ;(e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(217,119,6,0.12)'
                          }}
                          onMouseLeave={e => {
                            ;(e.currentTarget as HTMLElement).style.opacity = isCancelling ? '1' : '0.4'
                            ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                            ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                          }}
                        >
                          {isCancelling
                            ? <Loader2 size={16} className="animate-spin" />
                            : <PhoneOff size={16} />}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row count footer (no pagination — the queue is drained every 30 min) */}
      {!loading && !error && rows.length > 0 && (
        <div className="flex-shrink-0 flex items-center justify-end px-2 py-0.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {rows.length === 1 ? '1 scheduled call' : `${rows.length.toLocaleString()} scheduled calls`}
        </div>
      )}

      {confirmTarget && (
        <CancelConfirmModal
          call={confirmTarget}
          isPending={cancellingId !== null}
          tz={tz}
          onConfirm={handleConfirmCancel}
          onClose={() => {
            if (cancellingId !== null) return
            setConfirmTarget(null)
          }}
        />
      )}

      {selectedCall && (
        <CallDetailDrawer call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </>
  )
}
