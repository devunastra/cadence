'use client'

import { useEffect, useRef, useState } from 'react'
import { useCurrentStudio } from '@/components/studio-context'
import { setFollowupsEnabled } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { useMounted } from '@/lib/hooks'
import { useToast } from '@/components/ui/toast-provider'

// Per-studio switch for the automatic no-answer follow-up ladder (migrations 061
// and 062). Sits beside VoiceAgentToggle and OutboundAgentSelector in the Leads
// header and mirrors their realtime + role-gating pattern.
//
// This is NOT a second voice-agent pause, and the copy works hard to say so. With
// it off the agent still answers inbound calls, still dials new inquiries, still
// books and escalates — the only thing that stops is the +1/+2/+3/+5-day retry
// ladder after a lead doesn't pick up.
//
// A setting, not a status: no coloured dot, because the dot vocabulary belongs to
// the AI Voice Agent pill directly above and two dots in one header would read as
// two systems reporting health. The off state still earns a tint — an automation
// that has quietly stopped calling people should not look identical to one that is
// running.
export function FollowupsToggle() {
  const { currentStudio, updateCurrentStudio, userRole, isSuper } = useCurrentStudio()
  const mounted = useMounted()
  const { showError } = useToast()
  const [saving, setSaving] = useState(false)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)

  const canToggle = isSuper || userRole === 'studio_owner'
  const enabled = currentStudio.followups_enabled

  // Realtime — reflect changes from other sessions (mirrors VoiceAgentToggle).
  useEffect(() => {
    if (!mounted) return
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session) return
      supabase.realtime.setAuth(session.access_token)
      const channel = supabase
        .channel(`studio-followups-${currentStudio.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'studios', filter: `id=eq.${currentStudio.id}` },
          (payload) => {
            const row = payload.new as {
              followups_enabled?: boolean
              followups_paused_at?: string | null
              followups_paused_by?: string | null
            }
            updateCurrentStudio({
              // Absent reads as on — a studio row that predates migration 062 must
              // never render as "paused" and imply follow-ups have stopped.
              followups_enabled: row.followups_enabled ?? true,
              followups_paused_at: row.followups_paused_at ?? null,
              followups_paused_by: row.followups_paused_by ?? null,
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

  async function handleToggle() {
    if (!canToggle || saving) return
    const prev = enabled
    const next = !enabled
    setSaving(true)
    updateCurrentStudio({
      followups_enabled: next,
      followups_paused_at: next ? null : new Date().toISOString(),
    }) // optimistic
    try {
      await setFollowupsEnabled(currentStudio.id, next)
    } catch (e) {
      updateCurrentStudio({ followups_enabled: prev }) // revert
      showError(e instanceof Error ? e.message : 'Failed to update automatic follow-ups')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-1.5 rounded-lg text-sm"
      style={{
        backgroundColor: enabled ? 'var(--color-surface)' : 'rgba(217,119,6,0.08)',
        border: `1px solid ${enabled ? 'var(--color-border)' : 'rgba(217,119,6,0.25)'}`,
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
          Automatic follow-ups: {enabled ? 'On' : 'Off'}
        </span>
        {/* The load-bearing clause in each state. On: what it will do, so nobody
            has to remember the ladder. Off: that nothing was thrown away, which is
            the single most important thing about this switch — and the reason it
            holds rather than cancels. */}
        {enabled ? (
          <span className="hidden lg:inline truncate" style={{ color: 'var(--color-text-secondary)' }}>
            · Leads who don&apos;t pick up get 4 more calls over 11 days.
          </span>
        ) : (
          <span className="hidden sm:inline truncate" style={{ color: 'var(--color-text-secondary)' }}>
            · Queued follow-ups are on hold, not cancelled.
          </span>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Automatic follow-up calls"
        disabled={!canToggle || saving}
        onClick={handleToggle}
        title={
          canToggle
            ? 'Pause or resume automatic follow-up calls. Does not affect the AI voice agent.'
            : 'Only studio owners can change this.'
        }
        className="relative flex-shrink-0 rounded-full"
        style={{
          width: 44,
          height: 26,
          backgroundColor: enabled ? 'var(--color-accent)' : 'var(--color-border-strong)',
          transition: 'background-color var(--transition-base)',
          cursor: canToggle && !saving ? 'pointer' : 'not-allowed',
          opacity: canToggle ? 1 : 0.6,
        }}
      >
        <span
          className="absolute rounded-full bg-white"
          style={{
            width: 20, height: 20, top: 3,
            left: enabled ? 21 : 3,
            transition: 'left var(--transition-base)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}
        />
      </button>
    </div>
  )
}
