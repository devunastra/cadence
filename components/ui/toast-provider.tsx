'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react'

type ToastVariant = 'error' | 'success' | 'warning'

interface Toast {
  id: string
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  showError: (message: string) => void
  showSuccess: (message: string) => void
  showWarning: (message: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  showError: () => {},
  showSuccess: () => {},
  showWarning: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

const MAX_TOASTS = 4
const DURATION_MS = 5000

const VARIANT_STYLES: Record<ToastVariant, { color: string; Icon: typeof AlertCircle }> = {
  error: { color: '#dc2626', Icon: AlertCircle },
  success: { color: '#16a34a', Icon: CheckCircle2 },
  warning: { color: '#d97706', Icon: AlertTriangle },
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  const { color, Icon } = VARIANT_STYLES[toast.variant]

  return (
    <div
      className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-lg"
      style={{
        backgroundColor: 'var(--color-bg)',
        border: `2px solid ${color}`,
        color: 'var(--color-text-body)',
        minWidth: 280,
        maxWidth: 380,
      }}
    >
      <Icon size={16} color={color} className="flex-shrink-0 mt-0.5" />
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 transition-opacity hover:opacity-60"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <X size={14} />
      </button>
    </div>
  )
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || toasts.length === 0) return null

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2" style={{ pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>,
    document.body,
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const push = useCallback((variant: ToastVariant, message: string) => {
    const id = String(++counterRef.current)
    setToasts(prev => {
      const next = [...prev, { id, message, variant }]
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
    })
  }, [])

  const showError = useCallback((message: string) => push('error', message), [push])
  const showSuccess = useCallback((message: string) => push('success', message), [push])
  const showWarning = useCallback((message: string) => push('warning', message), [push])

  return (
    <ToastContext.Provider value={{ showError, showSuccess, showWarning }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
