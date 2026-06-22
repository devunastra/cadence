'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { useCurrentStudio } from '@/components/studio-context'
import { useToast } from '@/components/ui/toast-provider'
import { createClient } from '@/lib/supabase/client'
import {
  getNotifications,
  getUnreadNotificationCount,
  getUserPreferences,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/app/actions'
import type { Notification } from '@/lib/types'

const POPOVER_WIDTH = 360
const LIST_LIMIT = 30

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function NotificationBell() {
  const router = useRouter()
  const { studioId } = useCurrentStudio()
  const { showSuccess } = useToast()
  const supabase = useMemo(() => createClient(), [])

  const [userId, setUserId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const toastPrefRef = useRef(true)

  const containerRef = useRef<HTMLDivElement>(null)

  // Resolve auth user once (needed for Realtime filter).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
  }, [supabase])

  // Toast pref — fetched once per studio change so the Realtime handler can read it without re-subscribing.
  useEffect(() => {
    let cancelled = false
    getUserPreferences(studioId)
      .then(prefs => {
        if (cancelled) return
        toastPrefRef.current = prefs?.notify_appointment_toast !== false
      })
      .catch(() => { /* default stays true */ })
    return () => { cancelled = true }
  }, [studioId])

  // Initial fetch: badge count is cheap; full list only when popover opens.
  useEffect(() => {
    let cancelled = false
    getUnreadNotificationCount(studioId)
      .then(n => { if (!cancelled) setUnread(n) })
      .catch(() => { /* leave at 0 */ })
    return () => { cancelled = true }
  }, [studioId])

  // Realtime — fires for any notification row for this user across any studio,
  // which is what super_admins want. We filter the visible list by studioId below.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        payload => {
          const row = payload.new as Notification
          setUnread(prev => prev + 1)
          if (row.studio_id === studioId) {
            setItems(prev => [row, ...prev].slice(0, LIST_LIMIT))
          }
          if (toastPrefRef.current) {
            showSuccess(row.title)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        payload => {
          const row = payload.new as Notification
          setItems(prev => prev.map(n => (n.id === row.id ? row : n)))
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, userId, studioId, showSuccess])

  // Outside click + Esc — same pattern as studio-switcher.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const openPopover = useCallback(async () => {
    setOpen(true)
    setLoading(true)
    try {
      const rows = await getNotifications(studioId, { limit: LIST_LIMIT })
      setItems(rows)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [studioId])

  const handleRowClick = useCallback(async (n: Notification) => {
    setOpen(false)
    if (!n.read_at) {
      setUnread(prev => Math.max(0, prev - 1))
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      markNotificationRead(n.id).catch(() => { /* Realtime UPDATE will reconcile */ })
    }
    if (n.link) router.push(n.link)
  }, [router])

  const handleMarkAll = useCallback(async () => {
    const unreadIds = items.filter(n => !n.read_at).map(n => n.id)
    if (unreadIds.length === 0) return
    const now = new Date().toISOString()
    setUnread(0)
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }))
    markAllNotificationsRead(studioId).catch(() => { /* Realtime will reconcile */ })
  }, [items, studioId])

  const badgeText = unread > 9 ? '9+' : String(unread)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-label="Notifications"
        className="relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface)] transition-colors"
        style={{ color: 'var(--color-text-primary)' }}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span
            className="absolute top-1.5 right-1.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full text-[10px] font-semibold leading-none"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: '#ffffff',
            }}
          >
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 mt-2 rounded-xl shadow-lg overflow-hidden"
          style={{
            width: `min(${POPOVER_WIDTH}px, calc(100vw - 2.5rem))`,
            maxHeight: 'min(560px, calc(100vh - 80px))',
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            zIndex: 40,
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Notifications
            </span>
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={!items.some(n => !n.read_at)}
              className="text-xs disabled:opacity-40"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Mark all as read
            </button>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
            {loading && items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                No notifications yet
              </div>
            ) : (
              items.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleRowClick(n)}
                  className="w-full text-left px-4 py-3 flex gap-3 transition-colors hover:bg-[var(--color-surface)]"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span
                    className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full"
                    style={{ backgroundColor: n.read_at ? 'transparent' : 'var(--color-accent)' }}
                    aria-hidden
                  />
                  <span className="flex-1 min-w-0">
                    <span
                      className="block text-sm"
                      style={{
                        color: 'var(--color-text-primary)',
                        fontWeight: n.read_at ? 400 : 600,
                      }}
                    >
                      {n.title}
                    </span>
                    {n.body && (
                      <span
                        className="block text-xs mt-0.5 truncate"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {n.body}
                      </span>
                    )}
                    <span
                      className="block text-xs mt-1"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {formatRelative(n.created_at)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
