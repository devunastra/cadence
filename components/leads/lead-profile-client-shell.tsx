'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { addStudioFieldOption, renameStudioFieldOption, deleteStudioFieldOption } from '@/app/actions'
import type { Lead } from '@/lib/types'
import type { FieldOption } from '@/lib/field-options'
import { LeadInfoPanel } from './lead-info-panel'
import { LeadProfileRightPanel } from './lead-profile-right-panel'

interface LeadProfileClientShellProps {
  lead: Lead
  studioId: string
  initialFieldOptions: Record<string, FieldOption[]>
  initialConversationId: string | null
  studioEmail?: string
  ghlLocationId?: string | null
}

export function LeadProfileClientShell({
  lead: initialLead,
  studioId,
  initialFieldOptions,
  initialConversationId,
  studioEmail,
  ghlLocationId,
}: LeadProfileClientShellProps) {
  const router = useRouter()
  const [lead, setLead] = useState<Lead>(initialLead)
  const [fieldOptions, setFieldOptions] = useState(initialFieldOptions)
  const rightPanelRef = useRef<{ focusMessages: () => void } | null>(null)

  const handleOptionAdded = useCallback(async (_field: string, value: string) => {
    return { id: `mock-${Date.now()}`, value }
  }, [])

  const handleOptionRenamed = useCallback((field: string, oldValue: string, newValue: string) => {
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).map(o => o.value === oldValue ? { ...o, value: newValue } : o),
    }))
  }, [])

  const handleOptionDeleted = useCallback(async (field: string, optionId: string) => {
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).filter(o => o.id !== optionId),
    }))
  }, [])

  const handleOptionsChange = useCallback((field: string, options: FieldOption[]) => {
    setFieldOptions(prev => ({ ...prev, [field]: options }))
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Back navigation */}
      <div
        className="flex items-center flex-shrink-0 px-4 py-2"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
      >
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-base font-medium transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
        >
          <ChevronLeft size={18} />
          Back
        </button>
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel */}
        <div
          className="flex flex-col flex-shrink-0"
          style={{ width: 384, borderRight: '1px solid var(--color-border)' }}
        >
          <LeadInfoPanel
            lead={lead}
            onUpdate={setLead}
            onCallClick={() => {}}
            onMessageClick={() => rightPanelRef.current?.focusMessages()}
            fieldOptions={fieldOptions}
            onOptionAdded={handleOptionAdded}
            onOptionRenamed={handleOptionRenamed}
            onOptionDeleted={handleOptionDeleted}
            onOptionsChange={handleOptionsChange}
            showViewProfile={false}
            ghlLocationId={ghlLocationId}
          />
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0 h-full">
          <LeadProfileRightPanel
            lead={lead}
            initialConversationId={initialConversationId}
            studioEmail={studioEmail}
            imperativeRef={rightPanelRef}
          />
        </div>
      </div>
    </div>
  )
}
