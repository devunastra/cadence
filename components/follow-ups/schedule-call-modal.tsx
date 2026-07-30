'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Loader2, PhoneOutgoing, AlertTriangle } from 'lucide-react'
import { scheduleCall, cancelScheduledCall, searchLeadsForAppointment } from '@/app/actions'
import type { ScheduleCallResult } from '@/app/actions'
import { useToast } from '@/components/ui/toast-provider'
import { useCurrentStudio } from '@/components/studio-context'
import { DateFieldPicker } from '@/components/date-field-picker'
import { ExpandableTextarea } from '@/components/expandable-textarea'
import { naiveTzPartsToUtcIso, formatDateTime } from '@/lib/date-utils'
import type { ScheduledCall, PendingScheduledCall } from '@/lib/types'

interface LeadOption {
  id: string
  name: string
  email: string | null
  phone: string | null
}

interface Props {
  /** Pre-selects a lead and hides the search field. */
  presetLead?: LeadOption
  onClose: () => void
  onScheduled: (call: ScheduledCall) => void
}

const INPUT_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  color: 'var(--color-text-primary)',
  padding: '8px 12px',
  width: '100%',
  outline: 'none',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.02em',
  color: 'var(--color-text-secondary)',
  marginBottom: 6,
}

/** Short tz label for the helper text, e.g. "CDT". */
function tzAbbrev(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date())
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz
  } catch {
    return tz
  }
}

export function ScheduleCallModal({ presetLead, onClose, onScheduled }: Props) {
  const { studioId, currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  const { showSuccess, showError, showWarning } = useToast()

  const [selected, setSelected] = useState<LeadOption | null>(presetLead ?? null)
  const [search, setSearch] = useState('')
  const [leads, setLeads] = useState<LeadOption[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [dateVal, setDateVal] = useState('')
  const [timeVal, setTimeVal] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  // Set when the server reports the lead already has a pending call. Holds the
  // existing row so the user can replace it without leaving the modal.
  const [conflict, setConflict] = useState<PendingScheduledCall | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lead search. Goes through the server action (not the browser client) so a
  // super_admin viewing a studio they have no studio_users row in still gets
  // results — same reasoning as create-appointment-modal.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = search.trim()
    if (!q) {
      setLeads([])
      setLeadsLoading(false)
      return
    }
    setLeadsLoading(true)
    debounceRef.current = setTimeout(() => {
      searchLeadsForAppointment(studioId, q, 25)
        .then(({ leads }) => setLeads(leads as LeadOption[]))
        .catch(() => setLeads([]))
        .finally(() => setLeadsLoading(false))
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, studioId])

  // The picked wall-clock time, resolved to an absolute instant in the studio's
  // timezone. Doing the conversion here (not on the server) keeps the server
  // action's contract simple: it only ever accepts an absolute ISO instant.
  const callbackIso = useMemo(() => {
    if (!dateVal || !timeVal) return null
    const [y, m, d] = dateVal.split('-').map(Number)
    const [hh, mm] = timeVal.split(':').map(Number)
    if ([y, m, d, hh, mm].some(n => Number.isNaN(n))) return null
    return naiveTzPartsToUtcIso(y, m - 1, d, hh, mm, tz)
  }, [dateVal, timeVal, tz])

  const isPast = callbackIso ? new Date(callbackIso).getTime() <= Date.now() : false
  const canSubmit = !!selected && !!callbackIso && !isPast && !saving

  function applyResult(result: ScheduleCallResult) {
    if (result.ok) {
      showSuccess(`Call scheduled for ${formatDateTime(result.call.callback_time, tz)}`)
      onScheduled(result.call)
      onClose()
      return
    }
    if (result.code === 'duplicate' && result.existing) {
      setConflict(result.existing)
      return
    }
    showError(result.error)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || !callbackIso) return
    setSaving(true)
    try {
      applyResult(await scheduleCall({
        studioId,
        leadId: selected.id,
        callbackTime: callbackIso,
        callNote: note,
      }))
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to schedule the call')
    } finally {
      setSaving(false)
    }
  }

  /** Cancels the conflicting row, then re-submits. */
  async function handleReplace() {
    if (!conflict || !selected || !callbackIso) return
    setSaving(true)
    try {
      const { cancelled } = await cancelScheduledCall(conflict.id)
      if (!cancelled) {
        // The dialer settled it between our read and this click. The lead has
        // now actually been called, so scheduling again is a real decision.
        showWarning('That queued call already went out. Scheduling a new one.')
      }
      setConflict(null)
      applyResult(await scheduleCall({
        studioId,
        leadId: selected.id,
        callbackTime: callbackIso,
        callNote: note,
      }))
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to reschedule the call')
    } finally {
      setSaving(false)
    }
  }

  const filtered = leads.filter(l => l.id !== selected?.id)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={saving ? undefined : onClose} />

      <div
        className="relative w-full max-w-lg mx-3 md:mx-0 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Schedule a Call
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2.5 md:p-1.5 rounded-lg transition-colors disabled:opacity-40"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'transparent')}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-col gap-4 px-6 py-5 flex-1 min-h-0 overflow-y-auto">
            {/* Lead */}
            <div>
              <label style={LABEL_STYLE}>
                Who should the AI call? <span className="text-red-500">*</span>
              </label>

              {selected ? (
                <div
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {selected.name}
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {selected.phone ?? 'No phone on file'}
                    </div>
                  </div>
                  {!presetLead && (
                    <button
                      type="button"
                      onClick={() => { setSelected(null); setConflict(null) }}
                      className="p-2.5 md:p-1 rounded-md flex-shrink-0"
                      style={{ color: 'var(--color-text-muted)' }}
                      aria-label="Clear selected lead"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search leads by name…"
                    className="text-base md:text-sm"
                    style={INPUT_STYLE}
                    onFocus={e => ((e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px var(--color-accent)')}
                    onBlur={e => ((e.currentTarget as HTMLElement).style.boxShadow = 'none')}
                  />
                  {search.trim() && (
                    <div
                      className="mt-1 rounded-lg overflow-y-auto"
                      style={{ border: '1px solid var(--color-border)', maxHeight: 180 }}
                    >
                      {leadsLoading ? (
                        <div className="px-3 py-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>Searching…</div>
                      ) : filtered.length === 0 ? (
                        <div className="px-3 py-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>No leads match.</div>
                      ) : (
                        filtered.map(l => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => { setSelected(l); setSearch(''); setConflict(null) }}
                            className="w-full text-left px-3 py-2 flex flex-col"
                            style={{ backgroundColor: 'transparent', transition: 'none' }}
                            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)')}
                            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'transparent')}
                          >
                            <span className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>{l.name}</span>
                            <span className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                              {l.phone ?? 'No phone on file'}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              {selected && !selected.phone && (
                <p className="mt-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  This lead has no phone number — add one on the lead before scheduling.
                </p>
              )}
            </div>

            {/* Date + time */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 min-w-0">
                <label style={LABEL_STYLE}>
                  Date <span className="text-red-500">*</span>
                </label>
                <DateFieldPicker value={dateVal} onChange={setDateVal} placeholder="Select date" />
              </div>
              <div className="flex-1 min-w-0">
                <label style={LABEL_STYLE}>
                  Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={timeVal}
                  // 30-minute steps to match the dialer's sweep interval — offering
                  // to-the-minute precision the executor can't honour would lie.
                  step={1800}
                  onChange={e => setTimeVal(e.target.value)}
                  className="text-base md:text-sm"
                  style={INPUT_STYLE}
                  onFocus={e => ((e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px var(--color-accent)')}
                  onBlur={e => ((e.currentTarget as HTMLElement).style.boxShadow = 'none')}
                />
              </div>
            </div>

            <p className="text-xs -mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Times are {tzAbbrev(tz)} (studio time). The AI dials within 30 minutes of the
              time you pick.
            </p>

            {isPast && (
              <p className="text-xs" style={{ color: 'var(--color-text-primary)' }}>
                That time has already passed — pick a later one.
              </p>
            )}

            {/* Note. Deliberately not phrased as "why is the AI calling?" — the note
                is delivered to Retell as a dynamic variable but no agent prompt reads
                it yet, so that wording would promise something that doesn't happen.
                It IS shown to staff in the Scheduled Callbacks list today. */}
            <div>
              <label style={LABEL_STYLE}>Reason for the call</label>
              <ExpandableTextarea
                value={note}
                onChange={setNote}
                placeholder="e.g. Follow up on the pricing question from Tuesday's call"
              />
              <p className="mt-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Shown to your team on the Scheduled Callbacks list. The AI agent
                doesn&apos;t read this yet.
              </p>
            </div>

            {/* Duplicate conflict */}
            {conflict && (
              <div
                className="flex gap-3 px-3 py-3 rounded-lg"
                style={{ backgroundColor: 'rgba(217,119,6,0.10)', border: '1px solid rgba(217,119,6,0.35)' }}
              >
                <AlertTriangle size={16} style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }} />
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    This lead already has a call queued
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    Scheduled for {formatDateTime(conflict.callback_time, tz)}. Replacing it cancels
                    that one and queues yours instead.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-3 px-6 py-4 flex-shrink-0"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)')}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)')}
            >
              Cancel
            </button>

            {conflict ? (
              <button
                type="button"
                onClick={handleReplace}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-60 flex items-center gap-2"
                style={{ backgroundColor: '#d97706' }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.backgroundColor = '#b45309')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = '#d97706')}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? 'Replacing…' : 'Replace existing'}
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: 'var(--color-accent)' }}
                onMouseEnter={e => { if (canSubmit) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)' }}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)')}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <PhoneOutgoing size={14} />}
                {saving ? 'Scheduling…' : 'Schedule Call'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
