'use client'

import { useState, useEffect, useCallback } from 'react'
import { findLeadsByContactIds, getStudioFieldOptions, addStudioFieldOption, renameStudioFieldOption, deleteStudioFieldOption } from '@/app/actions'
import { buildDefaultOptions } from '@/lib/field-options'
import { ALL_LEAD_ENUM_FIELDS } from '@/lib/constants'
import type { Lead } from '@/lib/types'
import type { FieldOption } from '@/lib/field-options'
import { LeadInfoPanel } from '@/components/leads/lead-info-panel'

interface GHLConversation {
  id: string
  contactId: string
  contactName: string
  email: string | null
  phone: string | null
}

interface ContactSidePanelProps {
  selectedConv: GHLConversation | null
  blank?: boolean
  studioId: string | null
  ghlLocationId?: string | null
  onMessageClick?: () => void
  onLeadResolved?: () => void
}

const ENUM_FIELDS = Object.keys(ALL_LEAD_ENUM_FIELDS)

export function ContactSidePanel({ selectedConv, blank, studioId, ghlLocationId, onMessageClick, onLeadResolved }: ContactSidePanelProps) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [leadLoading, setLeadLoading] = useState(false)
  const [fieldOptions, setFieldOptions] = useState<Record<string, FieldOption[]>>({})

  // Fetch field options once when studioId is available — same as lead profile page (server-side resolved)
  useEffect(() => {
    if (!studioId) return
    getStudioFieldOptions(studioId).then(raw => {
      const defaults: Record<string, FieldOption[]> = {}
      for (const field of ENUM_FIELDS) defaults[field] = buildDefaultOptions(field)

      const merged: Record<string, FieldOption[]> = {}
      for (const field of ENUM_FIELDS) {
        const rows = raw[field] ?? []
        merged[field] = rows.map(({ id, value, bg, text }) => {
          const defaultColor = defaults[field].find(o => o.value === value)
          return {
            id, value,
            bg:   bg   ?? defaultColor?.bg   ?? 'status-bg-default',
            text: text ?? defaultColor?.text ?? 'status-text-default',
          }
        })
      }
      setFieldOptions(merged)
    }).catch(console.error)
  }, [studioId])

  const fetchLead = useCallback(async (contactId: string) => {
    if (!studioId) return
    setLeadLoading(true)
    const map = await findLeadsByContactIds([contactId], studioId)
    setLead(map[contactId] ?? null)
    setLeadLoading(false)
    onLeadResolved?.()
  }, [studioId, onLeadResolved])

  useEffect(() => {
    if (!selectedConv) {
      setLead(null)
      setLeadLoading(false)
      onLeadResolved?.()
      return
    }
    setLead(null)
    fetchLead(selectedConv.contactId)
  }, [selectedConv?.contactId, fetchLead, onLeadResolved])

// ── Option handlers (mirrors lead-profile-client-shell) ───────────────────

  async function handleOptionAdded(field: string, value: string): Promise<{ id: string; value: string }> {
    if (!studioId) return { id: '', value }
    const result = await addStudioFieldOption(studioId, field, value)
    setFieldOptions(prev => ({
      ...prev,
      [field]: [...(prev[field] ?? []), { id: result.id, value: result.value, bg: 'status-bg-default', text: 'status-text-default' }],
    }))
    return result
  }

  function handleOptionRenamed(field: string, oldValue: string, newValue: string) {
    if (!studioId) return
    renameStudioFieldOption(studioId, field, oldValue, newValue).catch(console.error)
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).map(o => o.value === oldValue ? { ...o, value: newValue } : o),
    }))
  }

  async function handleOptionDeleted(field: string, optionId: string): Promise<void> {
    await deleteStudioFieldOption(optionId)
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).filter(o => o.id !== optionId),
    }))
  }

  function handleOptionsChange(field: string, options: FieldOption[]) {
    setFieldOptions(prev => ({ ...prev, [field]: options }))
  }

  async function handleUpdate(updated: Lead) {
    setLead(updated)
    // updateLead is already called optimistically inside LeadInfoPanel — no double-save needed
  }

  // No conversation selected → hide panel entirely
  if (!selectedConv) return null

  // Switching conversations → show empty shell to preserve layout width
  if (blank) return (
    <div
      className="w-96 shrink-0 flex flex-col overflow-hidden"
      style={{ borderLeft: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
    />
  )

  // Conversation selected but lead not yet found → show nothing in the lead area
  // (panel is still rendered at the right width so layout doesn't shift)
  return (
    <div
      className="w-96 shrink-0 flex flex-col overflow-hidden"
      style={{ borderLeft: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
    >
      {lead ? (
        <LeadInfoPanel
          lead={lead}
          onUpdate={handleUpdate}
          onMessageClick={onMessageClick}
          ghlLocationId={ghlLocationId}
          fieldOptions={fieldOptions}
          onOptionAdded={handleOptionAdded}
          onOptionRenamed={handleOptionRenamed}
          onOptionDeleted={handleOptionDeleted}
          onOptionsChange={handleOptionsChange}
          showViewProfile={true}
          profileUrl={`/leads/${lead.id}`}
        />
      ) : !leadLoading ? (
        <div className="flex-1 flex items-start px-4 py-5">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No lead record found in system.
          </p>
        </div>
      ) : null}
    </div>
  )
}
