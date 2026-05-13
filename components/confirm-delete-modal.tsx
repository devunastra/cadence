'use client'

import { Trash2, X } from 'lucide-react'

interface ConfirmDeleteModalProps {
  title: string
  message: string
  confirmLabel?: string
  isDeleting?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDeleteModal({
  title,
  message,
  confirmLabel = 'Delete',
  isDeleting = false,
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      <div
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-150"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
        >
          <X size={20} />
        </button>

        <div className="px-6 pt-6 pb-4">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: 'rgba(220,38,38,0.12)' }}
          >
            <Trash2 size={20} style={{ color: '#dc2626' }} />
          </div>

          <p className="text-base font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{title}</p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: '#dc2626' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#b91c1c'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#dc2626'}
          >
            {isDeleting ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
