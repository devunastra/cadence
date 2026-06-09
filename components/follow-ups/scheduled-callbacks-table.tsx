'use client'

import { useEffect, useState, useCallback, useTransition } from 'react'
import { PhoneOff, X, Loader2 } from 'lucide-react'
import {
  fetchScheduledCallbacks,
  cancelScheduledCallback,
  fetchMostRecentCallForLead,
} from '@/app/actions'
import type { CallHistoryRow } from '@/app/actions'
import { formatDateTime } from '@/lib/date-utils'
import { useCurrentStudio } from '@/components/studio-context'
import { useToast } from '@/components/ui/toast-provider'
import { CallDetailDrawer } from '@/components/call-history/call-detail-drawer'
import type { ScheduledCallback } from '@/lib/types'

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

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div
            className="h-5 rounded skeleton-shimmer"
            style={{ width: i === 0 ? '70%' : i === 6 ? '20%' : '60%' }}
          />
        </td>
      ))}
    </tr>
  )
}

// ── Cancel confirmation modal (amber + PhoneOff variant of confirm-delete-modal) ──

function CancelConfirmModal({
  callback,
  isPending,
  onConfirm,
  onClose,
  tz,
}: {
  callback: ScheduledCallback
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
  tz: string
}) {
  const name = formatName(callback.first_name, callback.last_name)
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-150"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'transparent')}
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
            Cancel scheduled callback?
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            The AI agent will not call <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{name}</span> at{' '}
            {callback.callback_time ? formatDateTime(callback.callback_time, tz) : 'the scheduled time'}.
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
            Keep Callback
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
            {isPending ? 'Cancelling…' : 'Cancel Callback'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main table ───────────────────────────────────────────────────────────────

interface Props {
  refreshTrigger: number
}

export function ScheduledCallbacksTable({ refreshTrigger }: Props) {
  const { currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  const [rows, setRows] = useState<ScheduledCallback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<ScheduledCallback | null>(null)
  const [selectedCall, setSelectedCall] = useState<CallHistoryRow | null>(null)
  const [openingDetailFor, setOpeningDetailFor] = useState<number | null>(null)
  const [, startTransition] = useTransition()
  const [cancellingId, setCancellingId] = useState<number | null>(null)
  const { showSuccess, showWarning, showError } = useToast()

  async function handleRowClick(row: ScheduledCallback) {
    if (openingDetailFor !== null) return
    setOpeningDetailFor(row.n8n_row_id)
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
        const data = await fetchScheduledCallbacks()
        setRows(data)
      } catch (e) {
        const raw = e instanceof Error ? e.message : ''
        // Next.js production builds sanitize server action errors into a generic
        // "An error occurred in the Server Components render..." string. Show a
        // useful message instead of that blob.
        const isSanitized = raw.includes('Server Components render') || raw.includes('digest property')
        setError(isSanitized ? 'Could not load scheduled callbacks. Please refresh or try again.' : raw || 'Failed to load scheduled callbacks')
      } finally {
        setLoading(false)
      }
    })
  }, [])

  // Initial load + external refresh trigger
  useEffect(() => {
    load()
  }, [load, refreshTrigger])

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
    setCancellingId(target.n8n_row_id)
    try {
      const result = await cancelScheduledCallback(target.n8n_row_id)
      setRows(prev => prev.filter(r => r.n8n_row_id !== target.n8n_row_id))
      if (result.rowsUpdated > 0) {
        showSuccess(`Callback cancelled for ${formatName(target.first_name, target.last_name)}`)
      } else {
        showWarning('Callback was already made by the AI agent')
      }
      setConfirmTarget(null)
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to cancel callback')
    } finally {
      setCancellingId(null)
    }
  }

  return (
    <>
      <div
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden shadow-sm"
        style={{ border: '1px solid var(--color-border)' }}
      >
        <div
          className="h-full overflow-y-auto overflow-x-auto no-theme-transition"
          style={{ backgroundColor: 'var(--color-bg)' }}
        >
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
              <tr>
                {['Name', 'Phone', 'Email', 'Scheduled For', 'Reason', 'Dance Interest', ''].map((label, i) => (
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
                  <td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
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
                  <td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    No scheduled callbacks at this time.
                  </td>
                </tr>
              ) : (
                rows.map(row => {
                  const isCancelling = cancellingId === row.n8n_row_id
                  const isOpeningDetail = openingDetailFor === row.n8n_row_id
                  return (
                    <tr
                      key={row.n8n_row_id}
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
                      <td className="px-3 py-3 align-middle" style={{ color: 'var(--color-text-secondary)', maxWidth: 220 }}>
                        <span className="line-clamp-2">
                          {row.reason ?? <span style={{ color: 'var(--color-text-muted)' }}>{'—'}</span>}
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
                          title="Cancel scheduled callback"
                          aria-label="Cancel scheduled callback"
                          className="inline-flex items-center justify-center p-1.5 rounded-md transition-all"
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

      {/* Row count footer (no pagination for v1) */}
      {!loading && !error && rows.length > 0 && (
        <div className="flex-shrink-0 flex items-center justify-end px-2 py-0.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {rows.length === 1 ? '1 scheduled callback' : `${rows.length.toLocaleString()} scheduled callbacks`}
        </div>
      )}

      {confirmTarget && (
        <CancelConfirmModal
          callback={confirmTarget}
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
