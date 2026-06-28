'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft } from 'lucide-react'
import type { FieldOption } from '@/lib/field-options'
import { STATUS_COLORS } from '@/lib/constants'

type FieldKind = 'enum' | 'boolean'

interface BulkField {
  key: string
  label: string
  kind: FieldKind
}

const FIELDS: BulkField[] = [
  { key: 'status',      label: 'Status',      kind: 'enum' },
  { key: 'level',       label: 'Level',       kind: 'enum' },
  { key: 'action',      label: 'Action',      kind: 'enum' },
  { key: 'source',      label: 'Source',      kind: 'enum' },
  { key: 'reason',      label: 'Reason',      kind: 'enum' },
  { key: 'partnership', label: 'Partnership', kind: 'enum' },
  { key: 'showed',      label: 'Showed',      kind: 'boolean' },
  { key: 'bought',      label: 'Bought',      kind: 'boolean' },
  { key: 'old',         label: 'Old',         kind: 'boolean' },
]

const CONFIRM_THRESHOLD = 25
const POPOVER_WIDTH = 260

interface BulkEditPopoverProps {
  anchorRect: DOMRect
  selectedCount: number
  fieldOptions: Record<string, FieldOption[]>
  onApply: (field: string, value: string | boolean | null) => void
  onClose: () => void
}

export function BulkEditPopover({ anchorRect, selectedCount, fieldOptions, onApply, onClose }: BulkEditPopoverProps) {
  const [step, setStep] = useState<'field' | 'value' | 'confirm'>('field')
  const [field, setField] = useState<BulkField | null>(null)
  const [pendingValue, setPendingValue] = useState<string | boolean | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  function pickField(f: BulkField) {
    setField(f)
    setStep('value')
  }

  function pickValue(v: string | boolean | null) {
    if (selectedCount >= CONFIRM_THRESHOLD) {
      setPendingValue(v)
      setStep('confirm')
      return
    }
    commit(v)
  }

  function commit(v: string | boolean | null) {
    if (!field) return
    onApply(field.key, v)
  }

  function back() {
    if (step === 'confirm') { setStep('value'); setPendingValue(null); return }
    if (step === 'value') { setStep('field'); setField(null); return }
  }

  // Position below the anchor, right-aligned to it. Keep on-screen by clamping left.
  const margin = 8
  const top = anchorRect.bottom + 6
  const idealLeft = anchorRect.right - POPOVER_WIDTH
  if (typeof document === 'undefined') return null
  const maxLeft = window.innerWidth - POPOVER_WIDTH - margin
  const left = Math.max(margin, Math.min(idealLeft, maxLeft))

  const heading = step === 'field'
    ? `Edit ${selectedCount} ${selectedCount === 1 ? 'lead' : 'leads'}`
    : step === 'value'
      ? field!.label
      : 'Confirm'

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 rounded-xl shadow-lg overflow-hidden"
      style={{
        top, left, width: POPOVER_WIDTH,
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {step !== 'field' && (
          <button
            onClick={back}
            className="p-0.5 rounded transition-colors hover:opacity-70"
            style={{ color: 'var(--color-text-secondary)' }}
            aria-label="Back"
          >
            <ChevronLeft size={14} />
          </button>
        )}
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          {heading}
        </span>
      </div>

      {step === 'field' && (
        <div className="py-1 max-h-72 overflow-y-auto">
          {FIELDS.map(f => {
            const disabled = f.kind === 'enum' && (fieldOptions[f.key] ?? []).length === 0
            return (
              <button
                key={f.key}
                disabled={disabled}
                onClick={() => pickField(f)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors disabled:cursor-not-allowed"
                style={{
                  color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                  opacity: disabled ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <span>{f.label}</span>
                {disabled && <span className="text-xs">No options</span>}
              </button>
            )
          })}
        </div>
      )}

      {step === 'value' && field && field.kind === 'enum' && (
        <div className="py-1 max-h-72 overflow-y-auto">
          {(fieldOptions[field.key] ?? []).map(opt => {
            const colors = (opt.bg && opt.text)
              ? { bg: opt.bg, text: opt.text }
              : (STATUS_COLORS[opt.value] ?? { bg: 'status-bg-default', text: 'status-text-default' })
            return (
              <button
                key={opt.id ?? opt.value}
                onClick={() => pickValue(opt.value)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors"
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium ${colors.bg} ${colors.text}`}>
                  {opt.value}
                </span>
              </button>
            )
          })}
          <ClearButton onClick={() => pickValue(null)} />
        </div>
      )}

      {step === 'value' && field && field.kind === 'boolean' && (
        <div className="py-1">
          <BoolButton label="True" onClick={() => pickValue(true)} />
          <BoolButton label="False" onClick={() => pickValue(false)} />
          <ClearButton onClick={() => pickValue(null)} />
        </div>
      )}

      {step === 'confirm' && field && (
        <div className="p-3">
          <p className="text-sm mb-3" style={{ color: 'var(--color-text-primary)' }}>
            Apply <strong>{field.label}</strong> to <strong>{selectedCount} leads</strong>?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => commit(pendingValue)}
              className="flex-1 px-3 py-1.5 text-sm font-medium text-white rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--color-accent)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
            >
              Apply
            </button>
            <button
              onClick={back}
              className="flex-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
              style={{
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

function BoolButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2 text-sm text-left transition-colors"
      style={{ color: 'var(--color-text-primary)' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
    >
      {label}
    </button>
  )
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2 text-sm text-left transition-colors"
      style={{ color: 'var(--color-text-secondary)', borderTop: '1px solid var(--color-border)' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
    >
      Clear value
    </button>
  )
}
