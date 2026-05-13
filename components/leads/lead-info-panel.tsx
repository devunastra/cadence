'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Phone, Clock, Tag, MessageSquare, Zap, Mic, PhoneCall, Copy, Check, ExternalLink, ChevronDown } from 'lucide-react'
import { updateLead } from '@/app/actions'
import type { Lead } from '@/lib/types'
import type { FieldOption } from '@/lib/field-options'
import { EnumDropdown } from './enum-dropdown'
import { PhoneInput } from './phone-input'
import { DatePickerPopup } from './date-picker-popup'

export interface LeadInfoPanelProps {
  lead: Lead
  onUpdate: (updated: Lead) => void
  onCallClick?: () => void
  onMessageClick?: () => void
  fieldOptions: Record<string, FieldOption[]>
  onOptionAdded: (field: string, value: string) => Promise<{ id: string; value: string }>
  onOptionRenamed: (field: string, oldValue: string, newValue: string) => void
  onOptionDeleted: (field: string, optionId: string) => Promise<void>
  onOptionsChange: (field: string, options: FieldOption[]) => void
  /** Show "View Full Profile" link next to name (true in conversations panel) */
  showViewProfile?: boolean
  /** URL for the "View Full Profile" link, e.g. `/leads/${lead.id}` */
  profileUrl?: string
  /** Used to construct the GHL Contact URL for the native Call button redirect */
  ghlLocationId?: string | null
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Chicago',
  })
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export function LeadInfoPanel({
  lead,
  onUpdate,
  onCallClick,
  onMessageClick,
  fieldOptions,
  onOptionAdded,
  onOptionRenamed,
  onOptionDeleted,
  onOptionsChange,
  showViewProfile = false,
  profileUrl,
  ghlLocationId,
}: LeadInfoPanelProps) {
  const [data, setData] = useState<Lead>(lead)
  const [editingField, setEditingField] = useState<keyof Lead | null>(null)
  const [editValue, setEditValue] = useState('')
  const [enumDropdown, setEnumDropdown] = useState<{ field: string; anchorRect: DOMRect } | null>(null)
  const [datePicker, setDatePicker] = useState<{ field: 'last_contacted' | 'first_lesson'; anchorRect: DOMRect } | null>(null)
  const [calling, setCalling] = useState(false)
  const editCommittedRef = useRef(false)
  const phoneEditRef = useRef('')

  useEffect(() => { setData(lead) }, [lead])

  async function handleCall() {
    if (!data.phone || !data.ghl_contact_id || !ghlLocationId) return
    const ghlUrl = `https://app.gohighlevel.com/v2/location/${ghlLocationId}/contacts/detail/${data.ghl_contact_id}`
    window.open(ghlUrl, '_blank', 'noopener,noreferrer')
    onCallClick?.()
  }

  async function save(field: keyof Lead, value: string | boolean | null) {
    const updated = { ...data, [field]: value }
    setData(updated); onUpdate(updated)
    try { await updateLead(data.id, { [field]: value }) }
    catch { setData(data); onUpdate(data) }
  }

  async function saveEnum(field: string, value: string | null) {
    // Look up the option ID for DB storage (DB stores UUID FK, not display string)
    const optionId = value
      ? (fieldOptions[field] ?? []).find(o => o.value === value)?.id ?? null
      : null
    const updated = { ...data, [field]: value }
    setData(updated); onUpdate(updated)
    try { await updateLead(data.id, { [field]: optionId }) }
    catch { setData(data); onUpdate(data) }
  }

  function startEdit(field: keyof Lead) {
    editCommittedRef.current = false
    setEditingField(field)
    setEditValue(String(data[field] ?? ''))
    if (field === 'phone') phoneEditRef.current = String(data[field] ?? '')
  }

  async function commitPhone() {
    if (editCommittedRef.current) return
    editCommittedRef.current = true
    setEditingField(null)
    const newVal = phoneEditRef.current || null
    if (newVal !== (data.phone || null)) await save('phone', newVal)
  }

  async function commitEdit(field: keyof Lead) {
    if (editCommittedRef.current) return
    editCommittedRef.current = true
    setEditingField(null)
    const newVal = editValue.trim() === '' ? null : editValue.trim()
    const curVal = data[field] === '' ? null : data[field]
    if (newVal !== curVal) await save(field, newVal)
  }

  // ── Primitives ─────────────────────────────────────────────────────────────

  function TagBadge({ value, field }: { value: string | null; field: string }) {
    if (!value) return <span className="text-sm" style={{ color: 'var(--color-text-body)' }}>—</span>
    // Try to find by display value first; if not found, try by ID (handles old UUID-stored data)
    const opts = fieldOptions[field] ?? []
    const byValue = opts.find(o => o.value === value)
    const byId = opts.find(o => o.id === value)
    const opt = byValue ?? byId
    const displayValue = byValue ? value : (byId?.value ?? value)
    const fallbackBg = 'status-bg-default'
    const fallbackText = 'status-text-default'
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium ${opt?.bg ?? fallbackBg} ${opt?.text ?? fallbackText}`}>
        {displayValue}
      </span>
    )
  }

  function EditableText({ field, placeholder }: { field: keyof Lead; placeholder?: string }) {
    if (editingField === field) {
      return (
        <div className="-mx-2">
          <input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(field)}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(field); if (e.key === 'Escape') setEditingField(null) }}
            className="w-full text-sm bg-transparent focus:outline-none focus:ring-0 px-2 py-1"
            style={{ color: 'var(--color-text-body)' }}
          />
        </div>
      )
    }
    return (
      <span
        onClick={() => startEdit(field)}
        className="text-sm px-0 py-1 block cursor-text hover:underline"
        style={{ color: 'var(--color-text-body)', textUnderlineOffset: '4px' }}
      >
        {data[field] ? String(data[field]) : placeholder ?? '—'}
      </span>
    )
  }

  function EnumCell({ field }: { field: string }) {
    const isOpen = enumDropdown?.field === field
    return (
      <div className="relative w-full">
        <button
          onClick={e => setEnumDropdown(isOpen ? null : { field, anchorRect: e.currentTarget.getBoundingClientRect() })}
          className="w-full flex items-center justify-between text-left group/btn"
          style={{ paddingBottom: '4px' }}
        >
          <div>
            <TagBadge value={data[field as keyof Lead] as string | null} field={field} />
          </div>
          <ChevronDown size={14} className="opacity-0 group-hover/btn:opacity-100 transition-opacity" style={{ color: 'var(--color-text-muted)' }} />
        </button>
        {isOpen && (
          <EnumDropdown
            field={field}
            currentValue={data[field as keyof Lead] as string | null}
            options={fieldOptions[field] ?? []}
            anchorRect={enumDropdown!.anchorRect}
            dropdownWidth={enumDropdown!.anchorRect.width}
            getUsageCount={() => 0}
            onSelect={v => { saveEnum(field, v); setEnumDropdown(null) }}
            onOptionsChange={opts => onOptionsChange(field, opts)}
            onOptionAdded={v => onOptionAdded(field, v)}
            onOptionRenamed={(o, n) => onOptionRenamed(field, o, n)}
            onOptionDeleted={id => onOptionDeleted(field, id)}
            onClose={() => setEnumDropdown(null)}
          />
        )}
      </div>
    )
  }

  function DateCell({ field }: { field: 'last_contacted' | 'first_lesson' }) {
    return (
      <div className="relative w-full">
        <button
          suppressHydrationWarning
          onClick={e => setDatePicker({ field, anchorRect: e.currentTarget.getBoundingClientRect() })}
          className="w-full flex items-center justify-between text-left group/btn"
          style={{ paddingBottom: '4px' }}
        >
          <div className="text-sm" style={{ color: 'var(--color-text-body)' }}>
            {formatDateTime(data[field])}
          </div>
          <ChevronDown size={14} className="opacity-0 group-hover/btn:opacity-100 transition-opacity" style={{ color: 'var(--color-text-muted)' }} />
        </button>
      </div>
    )
  }

  function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div
        className="flex flex-col gap-2 px-4 py-3 border-b last:border-b-0 group"
        style={{ borderColor: 'var(--color-border)', overflow: 'visible' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm capitalize" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
        </div>
        <div className="w-full min-w-0">{children}</div>
      </div>
    )
  }

  // Section: a rounded card with a header inside
  function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
      <div
        className="rounded-xl"
        style={{ border: '1px solid var(--color-border)', overflow: 'visible' }}
      >
        {/* Card header */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-t-xl"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <span style={{ color: 'var(--color-text-body)' }}>{icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-body)' }}>{title}</span>
        </div>
        {children}
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-[200px] space-y-3" style={{ backgroundColor: 'var(--color-bg)' }}>

        {/* Identity */}
        <div className="px-1 pb-2">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold" style={{ backgroundColor: 'var(--color-accent)' }}>
                {initials(data.name)}
              </div>
              <div className="min-w-0">
                  <h2
                    className="text-lg font-bold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {editingField === 'name' ? editValue : data.name}
                  </h2>
                <p suppressHydrationWarning className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  Added {formatDateTime(data.created_at)}
                </p>
              </div>
            </div>

            {/* View Full Profile link (conversations context only) */}
            {showViewProfile && profileUrl && (
              <Link
                href={profileUrl}
                className="flex items-center gap-1 text-xs flex-shrink-0 mt-1 transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-accent)' }}
              >
                View Full Profile
              </Link>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleCall}
              disabled={!data.phone || !data.ghl_contact_id || !ghlLocationId}
              className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 flex-1 justify-center transition-colors"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: (!data.phone || !data.ghl_contact_id) ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                cursor: (!data.phone || !data.ghl_contact_id) ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => { if (data.phone && data.ghl_contact_id) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
              title={!data.phone ? 'No phone number' : !data.ghl_contact_id ? 'No GHL contact' : !ghlLocationId ? 'No GHL Location ID' : undefined}
            >
              <PhoneCall size={13} />
              Call
            </button>
            <button
              onClick={onMessageClick}
              className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 flex-1 justify-center transition-colors"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            >
              <MessageSquare size={13} />
              Message
            </button>
          </div>
        </div>

        {/* Contact */}
        <Section icon={<Phone size={13} />} title="Contact">
          <Row label="Full Name">
            <EditableText field="name" placeholder="—" />
          </Row>
          <Row label="Phone">
            {editingField === 'phone' ? (
              <div className="-mx-2">
                <PhoneInput
                  defaultValue={data.phone ?? ''}
                  autoFocus
                  onChange={v => { phoneEditRef.current = v }}
                  onBlur={commitPhone}
                  onKeyDown={e => { if (e.key === 'Enter') commitPhone(); if (e.key === 'Escape') setEditingField(null) }}
                />
              </div>
            ) : (
              <span
                onClick={() => startEdit('phone')}
                className="text-sm px-0 py-1 block cursor-text hover:underline"
                style={{ color: 'var(--color-text-body)', textUnderlineOffset: '4px' }}
              >
                {data.phone || '—'}
              </span>
            )}
          </Row>
          <Row label="Email">
            <EditableText field="email" placeholder="—" />
          </Row>
          <Row label="Available">
            <EditableText field="available" placeholder="—" />
          </Row>
        </Section>

        {/* Statuses */}
        <Section icon={<Tag size={13} />} title="Statuses">
          <Row label="Status"><EnumCell field="status" /></Row>
          <Row label="Level"><EnumCell field="level" /></Row>
          <Row label="Action"><EnumCell field="action" /></Row>
        </Section>

        {/* Progress */}
        <Section icon={<Zap size={13} />} title="Progress">
          <Row label="Partnership"><EnumCell field="partnership" /></Row>
          <Row label="Reason"><EnumCell field="reason" /></Row>
          <Row label="Milestones">
            <div className="flex flex-col gap-2">
              {(['showed', 'bought', 'old'] as const).map(f => (
                <label key={f} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!data[f]}
                    onChange={() => save(f, !data[f])}
                    className="w-4 h-4 rounded accent-[var(--color-accent)] cursor-pointer"
                  />
                  <span className="text-sm capitalize" style={{ color: 'var(--color-text-body)' }}>{f}</span>
                </label>
              ))}
            </div>
          </Row>
        </Section>

        {/* Timeline */}
        <Section icon={<Clock size={13} />} title="Timeline">
          <Row label="Last Contacted"><DateCell field="last_contacted" /></Row>
          <Row label="First Lesson"><DateCell field="first_lesson" /></Row>
        </Section>

        {/* Background */}
        <Section icon={<Tag size={13} />} title="Background">
          <Row label="Source"><EnumCell field="source" /></Row>
        </Section>

        {/* Comments */}
        <Section icon={<MessageSquare size={13} />} title="Comments">
          <div className="px-4 py-3">
            {editingField === 'comments' ? (
              <div className="-mx-2">
                <textarea
                  autoFocus
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => commitEdit('comments')}
                  rows={8}
                  className="w-full text-sm rounded-lg px-2 py-2 focus:outline-none focus:ring-0 resize-none bg-transparent"
                  style={{ color: 'var(--color-text-body)' }}
                />
              </div>
            ) : (
              <p
                onClick={() => startEdit('comments')}
                className="text-sm leading-relaxed whitespace-pre-wrap min-h-[160px] cursor-text"
                style={{ color: 'var(--color-text-body)' }}
              >
                {data.comments || '—'}
              </p>
            )}
          </div>
        </Section>
      </div>

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
