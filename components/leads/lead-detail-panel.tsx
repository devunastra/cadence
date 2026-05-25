'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Phone, Clock, Tag, MessageSquare, Zap, Mic, Pencil } from 'lucide-react'
import { updateLead, fetchCallsForLead } from '@/app/actions'
import { STATUS_COLORS } from '@/lib/constants'
import type { TranscriptCallRow } from '@/app/actions'
import type { Lead } from '@/lib/types'
import type { FieldOption } from '@/lib/field-options'
import { EnumDropdown } from './enum-dropdown'
import { PhoneInput } from './phone-input'
import { DatePickerPopup } from './date-picker-popup'
import { TranscriptViewer } from '@/components/call-analytics/transcript-viewer'
import { Spinner } from '@/components/spinner'

interface LeadDetailPanelProps {
  lead: Lead
  onClose: () => void
  onUpdate: (updated: Lead) => void
  onSaved?: (lead: { id: string; name: string }) => void
  fieldOptions: Record<string, FieldOption[]>
  onOptionAdded: (field: string, value: string) => Promise<{ id: string; value: string }>
  onOptionRenamed: (field: string, oldValue: string, newValue: string) => void
  onOptionDeleted: (field: string, optionId: string) => Promise<void>
  onOptionsChange: (field: string, options: FieldOption[]) => void
  onViewInTranscriptsClick?: () => void
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Chicago',
  }).replace(' at ', ', ')
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export function LeadDetailPanel({
  lead, onClose, onUpdate, onSaved,
  fieldOptions, onOptionAdded, onOptionRenamed, onOptionDeleted, onOptionsChange,
  onViewInTranscriptsClick,
}: LeadDetailPanelProps) {
  const [data, setData] = useState<Lead>(lead)
  const [editingField, setEditingField] = useState<keyof Lead | null>(null)
  const [editValue, setEditValue] = useState('')
  const [enumDropdown, setEnumDropdown] = useState<{ field: string; anchorRect: DOMRect } | null>(null)
  const [datePicker, setDatePicker] = useState<{ field: 'last_contacted' | 'first_lesson'; anchorRect: DOMRect } | null>(null)
  const editCommittedRef = useRef(false)
  const phoneEditRef     = useRef('')

  // ── Call transcripts ──────────────────────────────────────────────────────
  const [callsLoaded, setCallsLoaded] = useState(false)
  const [leadCalls, setLeadCalls] = useState<TranscriptCallRow[]>([])
  const [selectedCall, setSelectedCall] = useState<TranscriptCallRow | null>(null)

  const [transcriptCache, setTranscriptCache] = useState<Record<string, string | null>>({})
  const [fetchingTranscriptFor, setFetchingTranscriptFor] = useState<string | null>(null)
  const fetchingRef = useRef<Set<string>>(new Set())

  async function fetchTranscriptIfMissing(callId: string) {
    if (transcriptCache[callId] !== undefined || fetchingRef.current.has(callId)) return
    
    fetchingRef.current.add(callId)
    setFetchingTranscriptFor(callId)
    try {
      // Lazy load fetchCallTranscriptText from actions
      const { fetchCallTranscriptText } = await import('@/app/actions')
      const text = await fetchCallTranscriptText(callId)
      setTranscriptCache(prev => ({ ...prev, [callId]: text }))
    } finally {
      fetchingRef.current.delete(callId)
      setFetchingTranscriptFor(null)
    }
  }

  function handleSelectCall(call: TranscriptCallRow) {
    setSelectedCall(call)
    fetchTranscriptIfMissing(call.id)
  }

  useEffect(() => {
    fetchCallsForLead(lead.id, lead.studio_id).then(calls => {
      setLeadCalls(calls)
      if (calls[0]) {
        setSelectedCall(calls[0])
        fetchTranscriptIfMissing(calls[0].id)
      }
      setCallsLoaded(true)
    }).catch(() => setCallsLoaded(true))
  }, [lead.id, lead.studio_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save helpers ──────────────────────────────────────────────────────────

  async function save(field: keyof Lead, value: string | boolean | null) {
    const updated = { ...data, [field]: value }
    setData(updated)
    onUpdate(updated)
    try {
      await updateLead(data.id, { [field]: value })
      onSaved?.({ id: updated.id, name: updated.name || 'Unknown' })
    } catch {
      setData(data); onUpdate(data)
    }
  }

  async function saveEnum(field: string, value: string | null) {
    const optionId = value
      ? (fieldOptions[field] ?? []).find(o => o.value === value)?.id ?? null
      : null
    const updated = { ...data, [field]: value }
    setData(updated)
    onUpdate(updated)
    try {
      await updateLead(data.id, { [field]: optionId })
      onSaved?.({ id: updated.id, name: updated.name || 'Unknown' })
    } catch {
      setData(data); onUpdate(data)
    }
  }

  function startEdit(field: keyof Lead) {
    editCommittedRef.current = false
    setEditingField(field)
    const val = String(data[field] ?? '')
    setEditValue(val)
    if (field === 'phone') phoneEditRef.current = val
  }

  async function commitPhone() {
    if (editCommittedRef.current) return
    editCommittedRef.current = true
    setEditingField(null)
    const newValue = phoneEditRef.current || null
    const currentValue = data.phone || null
    if (newValue !== currentValue) await save('phone', newValue)
  }

  async function commitEdit(field: keyof Lead) {
    if (editCommittedRef.current) return  // prevent double-fire from Enter key + unmount blur
    editCommittedRef.current = true
    setEditingField(null)
    const newValue = editValue.trim() === '' ? null : editValue.trim()
    const currentValue = data[field] === '' ? null : data[field]
    if (newValue !== currentValue) await save(field, newValue)
  }

  // ── Shared primitives ─────────────────────────────────────────────────────

  function TagBadge({ value, field }: { value: string | null; field: string }) {
    if (!value) return <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>—</span>
    const opt = (fieldOptions[field] ?? []).find(o => o.value === value)
    const fallback = STATUS_COLORS[value] ?? { bg: 'status-bg-default', text: 'status-text-default' }
    const bg   = opt?.bg   ?? fallback.bg
    const text = opt?.text ?? fallback.text
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium ${bg} ${text}`}>
        {value}
      </span>
    )
  }

  function EditableText({ field, placeholder }: { field: keyof Lead; placeholder?: string }) {
    if (editingField === field) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => commitEdit(field)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(field); if (e.key === 'Escape') setEditingField(null) }}
          className="w-full text-base md:text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          style={{ border: '1px solid var(--color-accent)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
        />
      )
    }
    return (
      <span
        onClick={() => startEdit(field)}
        className="text-sm cursor-pointer rounded px-1 py-0.5 -ml-1 transition-colors"
        style={{ color: 'var(--color-text-secondary)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
      >
        {data[field]
          ? String(data[field])
          : <span style={{ color: 'var(--color-text-muted)' }}>{placeholder ?? '—'}</span>}
      </span>
    )
  }

  function EnumCell({ field }: { field: string }) {
    const isOpen = enumDropdown?.field === field
    return (
      <div className="relative inline-block">
        <button onClick={e => setEnumDropdown(isOpen ? null : { field, anchorRect: e.currentTarget.getBoundingClientRect() })}>
          <TagBadge value={data[field as keyof Lead] as string | null} field={field} />
        </button>
        {isOpen && (
          <EnumDropdown
            field={field}
            currentValue={data[field as keyof Lead] as string | null}
            options={fieldOptions[field] ?? []}
            anchorRect={enumDropdown!.anchorRect}
            getUsageCount={() => 0}
            inline
            onSelect={value => { saveEnum(field, value); setEnumDropdown(null) }}
            onOptionsChange={opts => onOptionsChange(field, opts)}
            onOptionAdded={value => onOptionAdded(field, value)}
            onOptionRenamed={(oldVal, newVal) => onOptionRenamed(field, oldVal, newVal)}
            onOptionDeleted={id => onOptionDeleted(field, id)}
            onClose={() => setEnumDropdown(null)}
          />
        )}
      </div>
    )
  }

  function DateCell({ field }: { field: 'last_contacted' | 'first_lesson' }) {
    return (
      <button
        suppressHydrationWarning
        onClick={e => setDatePicker({ field, anchorRect: e.currentTarget.getBoundingClientRect() })}
        className="text-sm cursor-pointer rounded px-1 py-0.5 -ml-1 text-left transition-colors"
        style={{ color: 'var(--color-text-secondary)' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
      >
        {formatDateTime(data[field])}
      </button>
    )
  }

  /** Consistent row inside a card: label on the left, value on the right */
  function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className="flex items-center gap-3 py-2.5 last:border-b-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-sm w-32 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    )
  }

  /** Rounded card wrapper */
  function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
      <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <span style={{ color: 'var(--color-text-muted)' }}>{icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{title}</span>
        </div>
        {children}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay — fills content area (sidebar excluded by parent layout) */}
      <div className="absolute inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)' }}>
        <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="rounded-2xl shadow-sm p-6 space-y-5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>

          {/* ── Header ── */}
          <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-accent)' }}>
                <span className="text-white font-bold text-lg">{initials(data.name)}</span>
              </div>
              <div>
                {editingField === 'name' ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => commitEdit('name')}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit('name') }}
                    className="text-2xl font-bold bg-transparent focus:outline-none w-full max-w-72"
                    style={{ borderBottom: '2px solid var(--color-accent)', color: 'var(--color-text-primary)' }}
                  />
                ) : (
                  <h2
                    onClick={() => startEdit('name')}
                    className="flex items-center gap-2 text-2xl font-bold cursor-pointer transition-colors"
                    style={{ color: 'var(--color-text-primary)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'}
                  >
                    {data.name}
                    <Pencil size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                  </h2>
                )}
                <p suppressHydrationWarning className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  Added {formatDateTime(data.created_at)}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
            >
              <X size={18} />
            </button>
          </div>

          {/* ── 2-column grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Contact */}
            <Card icon={<Phone size={14} />} title="Contact">
              <Row label="Phone">
                {editingField === 'phone' ? (
                  <PhoneInput
                    defaultValue={data.phone ?? ''}
                    autoFocus
                    onChange={v => { phoneEditRef.current = v }}
                    onBlur={commitPhone}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitPhone()
                      if (e.key === 'Escape') setEditingField(null)
                    }}
                  />
                ) : (
                  <span
                    onClick={() => startEdit('phone')}
                    className="text-sm cursor-pointer rounded px-1 py-0.5 -ml-1 transition-colors"
                    style={{ color: 'var(--color-text-secondary)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                  >
                    {data.phone
                      ? data.phone
                      : <span style={{ color: 'var(--color-text-muted)' }}>Add phone</span>}
                  </span>
                )}
              </Row>
              <Row label="Email"><EditableText field="email" placeholder="Add email" /></Row>
              <Row label="Available"><EditableText field="available" placeholder="Add availability" /></Row>
            </Card>

            {/* Statuses */}
            <Card icon={<Tag size={14} />} title="Statuses">
              <Row label="Status"><EnumCell field="status" /></Row>
              <Row label="Level"><EnumCell field="level" /></Row>
              <Row label="Action"><EnumCell field="action" /></Row>
            </Card>

            {/* Progress */}
            <Card icon={<Zap size={14} />} title="Progress">
              <Row label="Partnership"><EnumCell field="partnership" /></Row>
              <Row label="Reason"><EnumCell field="reason" /></Row>
              <Row label="Milestones">
                <div className="flex items-center gap-5">
                  {(['showed', 'bought', 'old'] as const).map(field => (
                    <label key={field} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!data[field]}
                        onChange={() => save(field, !data[field])}
                        className="w-3.5 h-3.5 rounded accent-[var(--color-accent)] cursor-pointer"
                      />
                      <span className="text-sm capitalize" style={{ color: 'var(--color-text-secondary)' }}>{field}</span>
                    </label>
                  ))}
                </div>
              </Row>
            </Card>

            {/* Timeline */}
            <Card icon={<Clock size={14} />} title="Timeline">
              <Row label="Last Contacted"><DateCell field="last_contacted" /></Row>
              <Row label="First Lesson"><DateCell field="first_lesson" /></Row>
            </Card>

            {/* Background */}
            <Card icon={<Tag size={14} />} title="Background">
              <Row label="Source"><EnumCell field="source" /></Row>
            </Card>

            {/* Comments */}
            <Card icon={<MessageSquare size={14} />} title="Comments">
              {editingField === 'comments' ? (
                <textarea
                  autoFocus
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => commitEdit('comments')}
                  rows={4}
                  className="w-full text-base md:text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none"
                  style={{ border: '1px solid var(--color-accent)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
                />
              ) : (
                <p
                  onClick={() => startEdit('comments')}
                  className="text-sm cursor-pointer rounded-lg p-2 -m-2 leading-relaxed whitespace-pre-wrap min-h-[80px] transition-colors"
                  style={{ color: 'var(--color-text-secondary)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  {data.comments || <span style={{ color: 'var(--color-text-muted)' }}>Add a comment...</span>}
                </p>
              )}
            </Card>

          </div>

          {/* ── Call Transcripts ── */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Mic size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Call Transcripts</span>
              {callsLoaded && (
                <span className="ml-1 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                  {leadCalls.length}
                </span>
              )}
            </div>

            {!callsLoaded ? (
              <div className="flex items-center justify-center py-8"><Spinner /></div>
            ) : leadCalls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'var(--color-surface)' }}>
                  <Mic size={20} style={{ color: 'var(--color-text-muted)' }} />
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No calls linked to this lead yet.</p>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row gap-3 md:h-[960px]">
                {/* Call list */}
                <div className="w-full md:w-52 flex-shrink-0 flex flex-col rounded-xl overflow-hidden max-h-48 md:max-h-none" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  <div className="flex-1 overflow-y-auto">
                    {leadCalls.map(call => {
                      const isSelected = selectedCall?.id === call.id
                      return (
                        <button
                          key={call.id}
                          onClick={() => handleSelectCall(call)}
                          className="w-full text-left px-3 py-2.5 transition-colors"
                          style={{
                            borderBottom: '1px solid var(--color-border)',
                            backgroundColor: isSelected ? 'var(--color-accent-subtle)' : 'transparent',
                          }}
                          onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
                          onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                        >
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {formatDateTime(call.created_at)}
                          </p>
                          {call.outcome && (() => {
                            const oc = STATUS_COLORS[call.outcome] ?? { bg: 'status-bg-default', text: 'status-text-default' }
                            return (
                              <span className={`mt-0.5 inline-block text-sm px-2 py-0.5 rounded-md font-medium ${oc.bg} ${oc.text}`}>
                                {call.outcome[0].toUpperCase() + call.outcome.slice(1)}
                              </span>
                            )
                          })()}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Transcript viewer */}
                <div className="flex-1 min-h-[400px] md:min-h-0 rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  {selectedCall ? (
                    <TranscriptViewer
                      call={{ ...selectedCall, transcript: transcriptCache[selectedCall.id] ?? null }}
                      isLoadingTranscript={fetchingTranscriptFor === selectedCall.id}
                      showViewInTranscripts={onViewInTranscriptsClick ?? true}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      Select a call to view the transcript
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
        </div>
      </div>

      {/* Date picker portal */}
      {datePicker && (
        <DatePickerPopup
          currentValue={data[datePicker.field]}
          anchorRect={datePicker.anchorRect}
          onSelect={iso => save(datePicker.field, iso)}
          onClose={() => setDatePicker(null)}
        />
      )}
    </>
  )
}
