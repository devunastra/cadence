'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { createLead } from '@/app/actions'
import { useToast } from '@/components/ui/toast-provider'
import type { FieldOption } from '@/lib/field-options'
import type { Lead } from '@/lib/types'
import { PhoneInput } from './phone-input'
import { ExpandableTextarea } from '@/components/expandable-textarea'
import { SimpleSelect } from '@/components/simple-select'

interface NewLeadModalProps {
  studioId: string
  fieldOptions: Record<string, FieldOption[]>
  onCreated: (lead: Lead) => void
  onClose: () => void
  onBeforeCreate?: () => void
  onCreateFailed?: () => void
}

const INPUT_CLASS  = "w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
const INPUT_STYLE  = { backgroundColor: 'var(--color-surface)' }

export function NewLeadModal({ studioId, fieldOptions, onCreated, onClose, onBeforeCreate, onCreateFailed }: NewLeadModalProps) {
  const [name, setName]         = useState('')
  const [phone, setPhone]       = useState('')
  const [email, setEmail]       = useState('')
  const [status, setStatus]     = useState('')
  const [level, setLevel]       = useState('')
  const [source, setSource]     = useState('')
  const [reason, setReason]     = useState('')
  const [available, setAvailable] = useState('')
  const [comments, setComments] = useState('')
  const [saving, setSaving]     = useState(false)
  const { showError } = useToast()

  // Default status/level to common values if the studio has them
  useEffect(() => {
    if ((fieldOptions['status'] ?? []).some(o => o.value === 'Active')) setStatus('Active')
    if ((fieldOptions['level']  ?? []).some(o => o.value === 'Inquiry')) setLevel('Inquiry')
  }, [fieldOptions])

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { showError('Name is required.'); return }
    if (!phone.trim()) { showError('Phone is required.'); return }
    if (!email.trim()) { showError('Email is required.'); return }
    setSaving(true)
    onBeforeCreate?.()
    try {
      const statusId = status ? (fieldOptions['status'] ?? []).find(o => o.value === status)?.id ?? null : null
      const levelId  = level  ? (fieldOptions['level']  ?? []).find(o => o.value === level)?.id  ?? null : null
      const sourceId = source ? (fieldOptions['source'] ?? []).find(o => o.value === source)?.id ?? null : null
      const reasonId = reason ? (fieldOptions['reason'] ?? []).find(o => o.value === reason)?.id ?? null : null
      const lead = await createLead({ studioId, name: name.trim(), phone, email, statusId, levelId, sourceId, reasonId, available, comments })
      onCreated(lead)
      onClose()
    } catch (err) {
      onCreateFailed?.()
      showError(err instanceof Error ? err.message : 'Failed to create lead.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>New Lead</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Name <span className="text-red-500">*</span></label>
            <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className={INPUT_CLASS} style={INPUT_STYLE} />
          </div>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Phone <span className="text-red-500">*</span></label>
              <PhoneInput defaultValue={phone} onChange={setPhone} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Email <span className="text-red-500">*</span></label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" className={INPUT_CLASS} style={INPUT_STYLE} />
            </div>
          </div>

          {/* Status + Level */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Status</label>
              <SimpleSelect value={status} onChange={setStatus} placeholder="— None —" options={(fieldOptions['status'] ?? []).map(o => ({ value: o.value, label: o.value }))} fullWidth />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Level</label>
              <SimpleSelect value={level} onChange={setLevel} placeholder="— None —" options={(fieldOptions['level'] ?? []).map(o => ({ value: o.value, label: o.value }))} fullWidth />
            </div>
          </div>

          {/* Source + Reason */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Source</label>
              <SimpleSelect value={source} onChange={setSource} placeholder="— None —" options={(fieldOptions['source'] ?? []).map(o => ({ value: o.value, label: o.value }))} fullWidth />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Reason</label>
              <SimpleSelect value={reason} onChange={setReason} placeholder="— None —" options={(fieldOptions['reason'] ?? []).map(o => ({ value: o.value, label: o.value }))} fullWidth />
            </div>
          </div>

          {/* Available */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Available</label>
            <input type="text" value={available} onChange={e => setAvailable(e.target.value)} placeholder="Availability notes" className={INPUT_CLASS} style={INPUT_STYLE} />
          </div>

          {/* Comments */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Comments</label>
            <ExpandableTextarea
              value={comments}
              onChange={setComments}
              placeholder="Any notes…"
              rows={3}
              label="Comments"
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-colors"
              style={{ backgroundColor: 'var(--color-accent)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
            >
              {saving ? 'Creating…' : 'Create Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
