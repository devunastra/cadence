'use client'

import { useState, useEffect } from 'react'
import { Spinner } from '@/components/spinner'
import { LeadDetailPanel } from '@/components/leads/lead-detail-panel'
import { getStudioFieldOptions, addStudioFieldOption, renameStudioFieldOption, deleteStudioFieldOption } from '@/app/actions'
import { buildDefaultOptions } from '@/lib/field-options'
import type { Lead } from '@/lib/types'
import type { FieldOption } from '@/lib/field-options'

interface CalendarLeadPanelProps {
  initialLead: Lead
  studioId: string
  onClose: () => void
}

export function CalendarLeadPanel({ initialLead, studioId, onClose }: CalendarLeadPanelProps) {
  const [lead, setLead] = useState<Lead>(initialLead)
  const [fieldOptions, setFieldOptions] = useState<Record<string, FieldOption[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Must wait for DB options — they carry the real UUIDs that match lead field values
    getStudioFieldOptions(studioId).then(rawOpts => {
      const merged: Record<string, FieldOption[]> = {}
      for (const field of Object.keys(rawOpts)) {
        const defaults = buildDefaultOptions(field)
        merged[field] = rawOpts[field].map(opt => {
          const def = defaults.find(d => d.value === opt.value)
          return { id: opt.id, value: opt.value, bg: def?.bg ?? 'bg-gray-200', text: def?.text ?? 'text-gray-700' }
        })
      }
      // Remap lead UUID field values to their string labels so TagBadge can match
      const remappedLead = { ...initialLead }
      for (const field of Object.keys(merged)) {
        const rawVal = (remappedLead as Record<string, unknown>)[field]
        if (typeof rawVal === 'string' && rawVal) {
          const match = merged[field].find(o => o.id === rawVal)
          if (match) (remappedLead as Record<string, unknown>)[field] = match.value
        }
      }
      setLead(remappedLead)
      setFieldOptions(merged)
      setLoading(false)
    })
  }, [studioId])

  if (loading) {
    return (
      <div className="absolute inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)' }}>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div
            className="rounded-2xl shadow-sm flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', minHeight: 480 }}
          >
            <Spinner />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <LeadDetailPanel
        lead={lead}
        onClose={onClose}
        onUpdate={setLead}
        fieldOptions={fieldOptions}
        onOptionAdded={async (field, value) => {
          const newOpt = await addStudioFieldOption(studioId, field, value)
          const fullOpt: FieldOption = { id: newOpt.id, value: newOpt.value, bg: 'bg-gray-200', text: 'text-gray-700' }
          setFieldOptions(prev => ({
            ...prev,
            [field]: [...(prev[field] ?? []), fullOpt],
          }))
          return newOpt
        }}
        onOptionRenamed={(field, oldValue, newValue) => {
          renameStudioFieldOption(studioId, field, oldValue, newValue)
          setFieldOptions(prev => ({
            ...prev,
            [field]: (prev[field] ?? []).map(o => o.value === oldValue ? { ...o, value: newValue } : o),
          }))
        }}
        onOptionDeleted={async (field, optionId) => {
          await deleteStudioFieldOption(optionId)
          setFieldOptions(prev => ({
            ...prev,
            [field]: (prev[field] ?? []).filter(o => o.id !== optionId),
          }))
        }}
        onOptionsChange={(field, options) => {
          setFieldOptions(prev => ({ ...prev, [field]: options }))
        }}
      />
    </>
  )
}
