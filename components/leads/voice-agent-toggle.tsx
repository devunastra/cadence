'use client'

import { useState, useEffect, useRef } from 'react'
import { useCurrentStudio } from '@/components/studio-context'
import { setVoiceAgentEnabled } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { useMounted } from '@/lib/hooks'
import { X } from 'lucide-react'
import { useToast } from '@/components/ui/toast-provider'

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
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({ pausing, saving, onConfirm, onCancel }: ConfirmModalProps) {
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
  // Force a re-render every minute so the "Paused X ago" label updates.
  const [, setTick] = useState(0)
  const canToggle = isSuper || userRole === 'studio_owner'
  const enabled = currentStudio.voice_agent_enabled
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)

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
            }
            updateCurrentStudio({
              voice_agent_enabled: row.voice_agent_enabled ?? true,
              voice_agent_paused_at: row.voice_agent_paused_at ?? null,
              voice_agent_paused_by: row.voice_agent_paused_by ?? null,
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

  // Tick once per minute so "X minutes ago" stays fresh.
  useEffect(() => {
    if (enabled) return
    const interval = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [enabled])

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
        className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 rounded-lg text-sm"
        style={{
          backgroundColor: enabled ? 'var(--color-surface)' : 'rgba(220,38,38,0.08)',
          border: `1px solid ${enabled ? 'var(--color-border)' : 'rgba(220,38,38,0.25)'}`,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block flex-shrink-0 rounded-full"
            style={{
              width: 8,
              height: 8,
              backgroundColor: enabled ? '#16a34a' : '#dc2626',
              boxShadow: enabled ? '0 0 0 3px rgba(22,163,74,0.18)' : '0 0 0 3px rgba(220,38,38,0.18)',
            }}
          />
          <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            AI Voice Agent: {enabled ? 'Active' : 'Paused'}
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
        </div>

        {canToggle && (
          <button
            onClick={() => setConfirming(true)}
            className="flex-shrink-0 px-3 py-1 text-sm font-medium rounded-md transition-colors"
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
        )}
      </div>

      {confirming && (
        <ConfirmModal
          pausing={enabled}
          saving={saving}
          onConfirm={handleConfirm}
          onCancel={() => { if (!saving) setConfirming(false) }}
        />
      )}
    </>
  )
}
