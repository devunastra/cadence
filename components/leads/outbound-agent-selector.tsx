'use client'

import { useState, useEffect, useRef } from 'react'
import { useCurrentStudio } from '@/components/studio-context'
import { setActiveOutboundAgent } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { useMounted } from '@/lib/hooks'
import { useToast } from '@/components/ui/toast-provider'
import { SimpleSelect } from '@/components/simple-select'

type AgentOption = { value: string; label: string }

// Per-studio dropdown to choose which Retell agent places outbound calls to future
// leads. Options come from the studio's studio_test_agents (same source + route as the
// /test page). The selection is persisted to studios.active_outbound_agent_id via the
// setActiveOutboundAgent server action; n8n reads that column at call time. Sits beside
// VoiceAgentToggle in the Leads header and mirrors its realtime + role-gating pattern.
export function OutboundAgentSelector() {
  const { currentStudio, updateCurrentStudio, userRole, isSuper } = useCurrentStudio()
  const mounted = useMounted()
  const { showError } = useToast()
  const canEdit = isSuper || userRole === 'studio_owner'

  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)

  // Effective selection: explicit choice, else the studio's default agent.
  const selected = currentStudio.active_outbound_agent_id ?? currentStudio.retell_agent_id ?? ''

  // Load this studio's agents (same source + route as the /test page dropdown).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/test-agents')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const list: { id: string; label: string }[] = data?.agents ?? []
        setAgents(list.map(a => ({ value: a.id, label: a.label })))
      })
      .catch(() => { if (!cancelled) setAgents([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentStudio.id])

  // Realtime — reflect changes from other sessions (mirrors VoiceAgentToggle).
  useEffect(() => {
    if (!mounted) return
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session) return
      supabase.realtime.setAuth(session.access_token)
      const channel = supabase
        .channel(`studio-outbound-agent-${currentStudio.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'studios', filter: `id=eq.${currentStudio.id}` },
          (payload) => {
            const row = payload.new as { active_outbound_agent_id?: string | null }
            updateCurrentStudio({ active_outbound_agent_id: row.active_outbound_agent_id ?? null })
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

  async function handleChange(value: string) {
    const prev = currentStudio.active_outbound_agent_id ?? null
    const next = value || null
    if (next === prev) return
    setSaving(true)
    updateCurrentStudio({ active_outbound_agent_id: next }) // optimistic
    try {
      await setActiveOutboundAgent(currentStudio.id, next)
    } catch (e) {
      updateCurrentStudio({ active_outbound_agent_id: prev }) // revert
      showError(e instanceof Error ? e.message : 'Failed to set outbound agent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <span className="font-medium whitespace-nowrap" style={{ color: 'var(--color-text-primary)' }}>
        Outbound agent
      </span>
      {loading ? (
        <span style={{ color: 'var(--color-text-secondary)' }}>Loading…</span>
      ) : agents.length === 0 ? (
        <span style={{ color: 'var(--color-text-secondary)' }}>No voice agents configured</span>
      ) : (
        <SimpleSelect
          value={selected}
          onChange={handleChange}
          options={agents}
          placeholder="Select agent…"
          clearable={false}
          disabled={!canEdit || saving}
          minWidth={200}
        />
      )}
    </div>
  )
}
