'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react'

type ToastVariant = 'error' | 'success' | 'warning'

interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: string
  message: string
  variant: ToastVariant
  action?: ToastAction
}

interface ToastContextValue {
  showError: (message: string) => void
  showSuccess: (message: string) => void
  showWarning: (message: string) => void
  /**
   * Queue a toast to appear on the next page load. Use right before
   * `window.location.reload()` or `router.push()` when the in-memory toast
   * would otherwise be destroyed by the navigation. The toast is stashed in
   * `sessionStorage` and replayed on mount.
   */
  showDeferred: (variant: ToastVariant, message: string) => void
  /**
   * Show a toast with a single action button (e.g. Undo). The toast
   * auto-dismisses at the standard duration; clicking the action fires
   * onAction and dismisses immediately.
   */
  showAction: (variant: ToastVariant, message: string, action: ToastAction) => void
}

const ToastContext = createContext<ToastContextValue>({
  showError: () => {},
  showSuccess: () => {},
  showWarning: () => {},
  showDeferred: () => {},
  showAction: () => {},
})

const DEFERRED_STORAGE_KEY = 'cadence_deferred_toasts'

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
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); onDismiss(toast.id) }}
          className="flex-shrink-0 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ color }}
        >
          {toast.action.label}
        </button>
      )}
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
  if (typeof document === 'undefined' || toasts.length === 0) return null

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

  const push = useCallback((variant: ToastVariant, message: string, action?: ToastAction) => {
    const id = String(++counterRef.current)
    setToasts(prev => {
      const next = [...prev, { id, message, variant, action }]
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
    })
  }, [])

  const showError = useCallback((message: string) => push('error', message), [push])
  const showSuccess = useCallback((message: string) => push('success', message), [push])
  const showWarning = useCallback((message: string) => push('warning', message), [push])
  const showAction = useCallback((variant: ToastVariant, message: string, action: ToastAction) => push(variant, message, action), [push])

  // showDeferred queues a toast for the *next* page load. Stash it in
  // sessionStorage now; the mount-time effect below replays it via push().
  // If sessionStorage is disabled (private mode / no JS storage), fall back
  // to the in-memory pipeline so the user still gets feedback.
  const showDeferred = useCallback((variant: ToastVariant, message: string) => {
    try {
      const raw = sessionStorage.getItem(DEFERRED_STORAGE_KEY)
      const queue: Array<{ variant: ToastVariant; message: string }> = raw ? JSON.parse(raw) : []
      queue.push({ variant, message })
      sessionStorage.setItem(
        DEFERRED_STORAGE_KEY,
        JSON.stringify(queue.slice(-MAX_TOASTS)),
      )
    } catch {
      push(variant, message)
    }
  }, [push])

  // On mount, drain any queued deferred toasts left by a previous render
  // (e.g. before a window.location.reload()).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem(DEFERRED_STORAGE_KEY)
      if (!raw) return
      sessionStorage.removeItem(DEFERRED_STORAGE_KEY)
      const queue: Array<{ variant: ToastVariant; message: string }> = JSON.parse(raw)
      for (const t of queue) {
        if (t && typeof t.message === 'string' && (t.variant === 'error' || t.variant === 'success' || t.variant === 'warning')) {
          push(t.variant, t.message)
        }
      }
    } catch {
      try { sessionStorage.removeItem(DEFERRED_STORAGE_KEY) } catch { /* noop */ }
    }
  }, [push])

  return (
    <ToastContext.Provider value={{ showError, showSuccess, showWarning, showDeferred, showAction }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
