'use client'

import { useState } from 'react'
import { X, CalendarDays, User, Phone, Mail, MapPin, FileText, Trash2, Pencil, Check, ExternalLink } from 'lucide-react'
import { rescheduleAppointment, updateAppointmentDetails, updateAppointmentStatus } from '@/app/actions'
import { useToast } from '@/components/ui/toast-provider'
import { getSlotsForDate, validateSlot } from '@/lib/appointment-slots'
import { AppointmentDatePicker } from './appointment-date-picker'
import { SimpleSelect } from '@/components/simple-select'
import { ExpandableTextarea } from '@/components/expandable-textarea'
import { ConfirmDeleteModal } from '@/components/confirm-delete-modal'
import type { Appointment, Lead, StudioSlotConfig } from '@/lib/types'

interface AppointmentModalProps {
  appointment: Appointment
  lead: Lead | null
  onClose: () => void
  onDelete: (id: string) => Promise<void>
  onViewLead: (lead: Lead) => void
  onReschedule: (id: string, newStartTime: string, newEndTime: string, newId?: string) => void
  onUpdate?: (id: string, changes: Partial<Appointment>) => void
  studioId: string
  slotConfig: StudioSlotConfig
  initialEditing?: boolean
}

const STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'showed',    label: 'Showed' },
  { value: 'noshow',    label: 'No Show' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'invalid',   label: 'Invalid' },
]

const FIELD_INPUT = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  color: 'var(--color-text-primary)',
  fontSize: 14,
  padding: '8px 12px',
  width: '100%',
  outline: 'none',
} as const

// Times stored as plain local ISO — read hours/minutes directly
function localTime(iso: string) {
  const h = parseInt(iso.substring(11, 13), 10)
  const m = parseInt(iso.substring(14, 16), 10)
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function localDate(iso: string) {
  const d = new Date(iso.substring(0, 19) + 'Z')
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function toDateInput(iso: string) {
  const d = new Date(iso.substring(0, 19) + 'Z')
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function toTimeInput(iso: string) {
  return iso.substring(11, 16)
}

interface RowProps {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  alignStart?: boolean
}

function Row({ icon, label, children, alignStart }: RowProps) {
  return (
    <div className={`flex gap-4 ${alignStart ? 'items-start' : 'items-center'}`}>
      <div className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
        <div className="text-sm" style={{ color: 'var(--color-text-body)' }}>{children}</div>
      </div>
    </div>
  )
}

export function AppointmentModal({
  appointment, lead, onClose, onDelete, onViewLead,
  onReschedule, onUpdate, slotConfig, initialEditing = false,
}: AppointmentModalProps) {
  const { showError } = useToast()
  const [isDeleting, setIsDeleting]             = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [editing, setEditing]                   = useState(initialEditing)

  const isLocked = !!appointment.deleted_at

  const [editTitle, setEditTitle] = useState(appointment.title ?? '')
  const [editDate,  setEditDate]  = useState(toDateInput(appointment.start_time))
  const [editTime,  setEditTime]  = useState(toTimeInput(appointment.start_time))
  const [editNotes, setEditNotes] = useState(appointment.notes ?? '')
  const [isSaving,  setIsSaving]  = useState(false)

  async function handleDelete() {
    setIsDeleting(true)
    await onDelete(appointment.id)
    onClose()
  }

  function startEdit() {
    if (isLocked) return
    setEditTitle(appointment.title ?? '')
    setEditDate(toDateInput(appointment.start_time))
    setEditTime(toTimeInput(appointment.start_time))
    setEditNotes(appointment.notes ?? '')
    setEditing(true)
  }

  async function saveEdit() {
    setIsSaving(true)

    const origDate = toDateInput(appointment.start_time)
    const origTime = toTimeInput(appointment.start_time)
    const timeChanged  = editDate !== origDate || editTime !== origTime
    const titleChanged = editTitle !== (appointment.title ?? '')
    const notesChanged = editNotes !== (appointment.notes ?? '')

    let effectiveId = appointment.id

    if (timeChanged) {
      const slotError = validateSlot(editDate, editTime, slotConfig)
      if (slotError) { showError(slotError); setIsSaving(false); return }

      const newStart = `${editDate}T${editTime}:00`
      const asUTC    = (s: string) => new Date(s.substring(0, 19) + 'Z').getTime()
      const duration = asUTC(appointment.end_time) - asUTC(appointment.start_time)
      const newEnd   = new Date(asUTC(newStart) + duration).toISOString().substring(0, 19)

      // Mock reschedule — local only
      onReschedule(appointment.id, newStart, newEnd, undefined)
    }

    if (titleChanged || notesChanged) {
      // Mock update — local only
      onUpdate?.(effectiveId, { title: editTitle || null, notes: editNotes || null })
    }

    setIsSaving(false)
    setEditing(false)
  }

  async function handleStatusChange(newStatus: string) {
    // Mock status change — local only
    onUpdate?.(appointment.id, { status: newStatus })
  }

  const editSlots   = getSlotsForDate(editDate, slotConfig)
  const editOptions = editSlots ?? []

  return (
    <>
    {showConfirmDelete && (
      <ConfirmDeleteModal
        title="Delete Appointment?"
        message="Are you sure you want to delete this appointment? This action cannot be undone."
        isDeleting={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setShowConfirmDelete(false)}
      />
    )}

    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onClose} />

      <div
        className="relative w-full max-w-md shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <p className="text-base font-semibold leading-snug pr-4" style={{ color: 'var(--color-text-primary)' }}>
            {editing ? 'Edit Appointment' : (appointment.title || 'Appointment')}
          </p>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {!editing && !isLocked && (
              <button
                onClick={startEdit}
                title="Edit"
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <Pencil size={20} />
              </button>
            )}
            {!isLocked && (
              <button
                onClick={() => setShowConfirmDelete(true)}
                title="Delete"
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: '#dc2626' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(220,38,38,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <Trash2 size={20} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {editing ? (
          /* ── Edit mode ──────────────────────────────── */
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Title</label>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                style={FIELD_INPUT}
                onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'}
                onBlur={e  => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'}
              />
            </div>

            {/* Date + Slot */}
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Date</label>
                <AppointmentDatePicker
                  value={editDate}
                  config={slotConfig}
                  onChange={newDate => {
                    const s = getSlotsForDate(newDate, slotConfig)
                    setEditDate(newDate)
                    if (!s?.some(o => o.value === editTime)) setEditTime(s?.[0]?.value ?? '')
                  }}
                  className="w-full"
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Slot</label>
                {editOptions.length > 0 ? (
                  <SimpleSelect
                    value={editTime}
                    onChange={v => { setEditTime(v) }}
                    options={editOptions}
                    placeholder="Select a slot…"
                    fullWidth
                    clearable={false}
                  />
                ) : (
                  <div
                    className="flex items-center text-sm px-3 rounded-lg"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', height: 37, cursor: 'not-allowed' }}
                  >
                    No slots on this day
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Description{' '}
                <span className="text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>optional</span>
              </label>
              <ExpandableTextarea
                value={editNotes}
                onChange={setEditNotes}
                placeholder="Add a description…"
                rows={4}
                label="Description"
                style={FIELD_INPUT}
                onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'}
                onBlur={e  => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={saveEdit}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
                style={{ backgroundColor: 'var(--color-accent)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
              >
                <Check size={14} />
                {isSaving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={() => { setEditing(false) }}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* ── View mode ──────────────────────────────── */
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {appointment.deleted_at && (
              <div
                className="px-3 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#FFE2DD', color: '#C4554D' }}
              >
                This appointment has been deleted
              </div>
            )}

            {/* Appointment Time */}
            <Row icon={<CalendarDays size={20} />} label="Appointment Time">
              {localDate(appointment.start_time)}, {localTime(appointment.start_time)}
              {appointment.end_time && ` – ${localTime(appointment.end_time)}`}
            </Row>

            {/* Name */}
            {appointment.contact_name && (
              <Row icon={<User size={20} />} label="Name">
                {lead ? (
                  <button
                    onClick={() => onViewLead(lead)}
                    className="flex items-center gap-1 hover:underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {appointment.contact_name}
                    <ExternalLink size={12} />
                  </button>
                ) : (
                  appointment.contact_name
                )}
              </Row>
            )}

            {/* Phone */}
            {lead?.phone && (
              <Row icon={<Phone size={20} />} label="Phone">
                {lead.phone}
              </Row>
            )}

            {/* Email */}
            {lead?.email && (
              <Row icon={<Mail size={20} />} label="Email">
                {lead.email}
              </Row>
            )}

            {/* Location */}
            {appointment.address && (
              <Row icon={<MapPin size={20} />} label="Location">
                {appointment.address}
              </Row>
            )}

            {/* Description */}
            {appointment.notes && (
              <Row icon={<FileText size={20} />} label="Description" alignStart>
                <span className="leading-relaxed whitespace-pre-wrap">{appointment.notes}</span>
              </Row>
            )}

          </div>
        )}

        {/* Status footer — always visible in both view and edit mode */}
        <div
          className="flex items-center gap-3 px-6 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>Status</span>
          {isLocked ? (
            <span className="text-sm font-medium px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
              {STATUS_OPTIONS.find(o => o.value === appointment.status)?.label ?? appointment.status ?? '—'}
            </span>
          ) : (
            <SimpleSelect
              value={appointment.status ?? ''}
              onChange={handleStatusChange}
              options={STATUS_OPTIONS}
              placeholder="Set status…"
              clearable={false}
              minWidth={140}
            />
          )}
        </div>
      </div>
    </div>
    </>
  )
}
