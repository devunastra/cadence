'use client'

import { useState, useEffect, useRef } from 'react'
import { useCurrentStudio } from '@/components/studio-context'
import { setVoiceAgentEnabled } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { useMounted } from '@/lib/hooks'
import { X, MoreHorizontal, Clock } from 'lucide-react'
import { useToast } from '@/components/ui/toast-provider'
import { normalizeCallHours, isWithinCallHours, formatNextOpeningLabel } from '@/lib/call-hours'
import { CallHoursModal } from './call-hours-modal'

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

interface ConfirmModalProps {
  pausing: boolean
  saving: boolean
  /** Set only when resuming would NOT start calls immediately — the studio is
   *  outside its calling window. Carries the label for when it will. */
  resumeDeferredUntil: string | null
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({ pausing, saving, resumeDeferredUntil, onConfirm, onCancel }: ConfirmModalProps) {
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

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
          <p className="text-base font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            {pausing ? 'Pause AI Voice Agent?' : 'Resume AI Voice Agent?'}
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {pausing
              ? 'New inquiries will still appear in your dashboard, but the AI will not place or answer any calls until you resume.'
              : resumeDeferredUntil
                // Resuming outside the calling window: inbound resumes at once,
                // outbound waits. Saying "immediately" here would be a lie.
                ? `The AI will start answering inbound calls straight away. Outbound calls are outside the calling window right now, so they will be queued and start ${resumeDeferredUntil}.`
                : 'The AI will immediately start placing outbound calls to new inquiries and answering inbound calls.'}
          </p>
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: pausing ? '#dc2626' : 'var(--color-accent)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = pausing ? '#b91c1c' : 'var(--color-accent-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = pausing ? '#dc2626' : 'var(--color-accent)'}
          >
            {saving ? 'Saving…' : pausing ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function VoiceAgentToggle() {
  const { currentStudio, updateCurrentStudio, userRole, isSuper } = useCurrentStudio()
  const mounted = useMounted()
  const { showError } = useToast()
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingHours, setEditingHours] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Force a re-render every minute so the "Paused X ago" label updates.
  const [, setTick] = useState(0)
  const canToggle = isSuper || userRole === 'studio_owner'
  const enabled = currentStudio.voice_agent_enabled
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)

  // The switch being on is necessary but not sufficient — the studio also has to
  // be inside its calling window (Settings → Business Profile → AI Calling Hours),
  // which the n8n dialers enforce independently. Showing only the switch would let
  // this read "Active" while every call is being held, which is what it used to do.
  //
  // Gated on `mounted`: isWithinCallHours reads the clock, so evaluating it during
  // SSR would hydrate against a different instant. Pre-mount we show the switch
  // state alone, which is the safe under-claim.
  const callHours = normalizeCallHours(currentStudio.call_hours)
  // Deliberately independent of `enabled` — the confirm modal needs to know
  // whether *resuming* would actually start calls, which is a question about the
  // window alone.
  const withinWindowNow = !mounted || isWithinCallHours(callHours, currentStudio.timezone)
  const nextOpening = withinWindowNow
    ? null
    : formatNextOpeningLabel(callHours, currentStudio.timezone)
  const outsideWindow = mounted && enabled && !withinWindowNow
  const resumesAt = outsideWindow ? nextOpening : null

  const dotColor = !enabled
    ? 'var(--color-status-danger)'
    : outsideWindow
      ? 'var(--color-status-warn)'
      : 'var(--color-status-ok)'
  const dotGlow = !enabled
    ? 'rgba(220,38,38,0.18)'
    : outsideWindow
      ? 'rgba(217,119,6,0.18)'
      : 'rgba(22,163,74,0.18)'
  const statusLabel = !enabled ? 'Paused' : outsideWindow ? 'Outside calling hours' : 'Active'

  // Realtime subscribe to studio row so other sessions see toggle changes instantly.
  useEffect(() => {
    if (!mounted) return
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session) return
      supabase.realtime.setAuth(session.access_token)
      const channel = supabase
        .channel(`studio-voice-agent-${currentStudio.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'studios', filter: `id=eq.${currentStudio.id}` },
          (payload) => {
            const row = payload.new as {
              voice_agent_enabled?: boolean
              voice_agent_paused_at?: string | null
              voice_agent_paused_by?: string | null
              call_hours?: unknown
              timezone?: string
            }
            updateCurrentStudio({
              voice_agent_enabled: row.voice_agent_enabled ?? true,
              voice_agent_paused_at: row.voice_agent_paused_at ?? null,
              voice_agent_paused_by: row.voice_agent_paused_by ?? null,
              // Editing the hours in Settings updates this same row, so the pill
              // reflects a window change without a reload — same as the switch.
              call_hours: normalizeCallHours(row.call_hours),
              ...(row.timezone ? { timezone: row.timezone } : {}),
            })
          },
        )
        .subscribe()
      channelRef.current = channel
      if (cancelled) { supabase.removeChannel(channel); channelRef.current = null }
    })

    return () => {
      cancelled = true
      if (channelRef.current) { createClient().removeChannel(channelRef.current); channelRef.current = null }
    }
  }, [mounted, currentStudio.id, updateCurrentStudio])

  // Close the actions menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Tick once per minute so the time-dependent parts stay honest: the "X minutes
  // ago" label while paused, and — when a calling window is configured — the
  // Active/Outside-hours flip itself, which would otherwise only correct on a
  // navigation. No timer when the agent is on and unrestricted; nothing moves.
  useEffect(() => {
    if (enabled && !callHours) return
    const interval = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [enabled, callHours])

  async function handleConfirm() {
    setSaving(true)
    const nextEnabled = !enabled
    try {
      await setVoiceAgentEnabled(currentStudio.id, nextEnabled)
      updateCurrentStudio({
        voice_agent_enabled: nextEnabled,
        voice_agent_paused_at: nextEnabled ? null : new Date().toISOString(),
      })
      setConfirming(false)
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to update voice agent state')
    } finally {
      setSaving(false)
    }
  }

  // Visual: status pill + (optional) action button. Single row, fits in the leads header area.
  return (
    <>
      <div
        className="min-w-0 flex items-center justify-between gap-3 px-4 py-2 rounded-lg text-sm"
        style={{
          backgroundColor: !enabled
            ? 'rgba(220,38,38,0.08)'
            : outsideWindow
              ? 'rgba(217,119,6,0.08)'
              : 'var(--color-surface)',
          border: `1px solid ${
            !enabled
              ? 'rgba(220,38,38,0.25)'
              : outsideWindow
                ? 'rgba(217,119,6,0.25)'
                : 'var(--color-border)'
          }`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block flex-shrink-0 rounded-full"
            style={{
              width: 8,
              height: 8,
              backgroundColor: dotColor,
              boxShadow: `0 0 0 3px ${dotGlow}`,
            }}
          />
          <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            AI Voice Agent: {statusLabel}
          </span>
          {!enabled && currentStudio.voice_agent_paused_at && (
            <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>
              · {formatRelativeTime(currentStudio.voice_agent_paused_at)}
            </span>
          )}
          {!enabled && (
            <span className="hidden sm:inline truncate" style={{ color: 'var(--color-text-secondary)' }}>
              · No AI calls are being placed or answered.
            </span>
          )}
          {/* Outside the window the switch is still on, so say what's actually
              happening and when it ends — otherwise this reads as a fault. */}
          {outsideWindow && resumesAt && (
            <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>
              · resumes {resumesAt}
            </span>
          )}
          {/* Reassurance, not information — "queued" is the one thing that isn't
              obvious from the status, but it's the first thing to drop for space. */}
          {outsideWindow && (
            <span className="hidden xl:inline truncate" style={{ color: 'var(--color-text-secondary)' }}>
              · Outbound calls are queued until then.
            </span>
          )}
        </div>

        {canToggle && (
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <button
              onClick={() => setConfirming(true)}
              className="px-3 py-1 text-sm font-medium rounded-md transition-colors"
              style={{
                border: `1px solid ${enabled ? 'var(--color-border)' : 'rgba(220,38,38,0.35)'}`,
                backgroundColor: enabled ? 'var(--color-bg)' : 'transparent',
                color: enabled ? 'var(--color-text-primary)' : '#b91c1c',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = enabled ? 'var(--color-surface-hover)' : 'rgba(220,38,38,0.12)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = enabled ? 'var(--color-bg)' : 'transparent'
              }}
            >
              {enabled ? 'Pause' : 'Resume'}
            </button>

            {/* Agent settings that aren't the on/off switch. Calling hours is the
                only one today; this is where the next one goes rather than adding
                another button to an already tight row. */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen(o => !o)}
                aria-label="AI voice agent settings"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center justify-center rounded-md transition-colors w-11 h-11 md:w-7 md:h-7"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <MoreHorizontal size={18} />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 z-50 rounded-lg shadow-lg overflow-hidden whitespace-nowrap"
                  style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', minWidth: 190 }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); setEditingHours(true) }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 md:py-2 text-sm text-left transition-colors"
                    style={{ color: 'var(--color-text-primary)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                  >
                    <Clock size={15} style={{ color: 'var(--color-text-secondary)' }} />
                    Calling hours…
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {confirming && (
        <ConfirmModal
          pausing={enabled}
          saving={saving}
          resumeDeferredUntil={enabled ? null : nextOpening}
          onConfirm={handleConfirm}
          onCancel={() => { if (!saving) setConfirming(false) }}
        />
      )}

      {editingHours && <CallHoursModal onClose={() => setEditingHours(false)} />}
    </>
  )
}
