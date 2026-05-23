'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { addStudioFieldOption, renameStudioFieldOption, deleteStudioFieldOption } from '@/app/actions'
import { useIsMobile } from '@/lib/hooks'
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
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<'info' | 'messages'>('info')
  const [lead, setLead] = useState<Lead>(initialLead)
  const [fieldOptions, setFieldOptions] = useState(initialFieldOptions)
  const rightPanelRef = useRef<{ focusMessages: () => void } | null>(null)

  const handleOptionAdded = useCallback(async (field: string, value: string) => {
    return addStudioFieldOption(studioId, field, value)
  }, [studioId])

  const handleOptionRenamed = useCallback((field: string, oldValue: string, newValue: string) => {
    renameStudioFieldOption(studioId, field, oldValue, newValue).catch(console.error)
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).map(o => o.value === oldValue ? { ...o, value: newValue } : o),
    }))
  }, [studioId])

  const handleOptionDeleted = useCallback(async (field: string, optionId: string) => {
    await deleteStudioFieldOption(optionId)
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

      {/* Mobile tab switcher */}
      {isMobile && (
        <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-0">
            {([
              { key: 'info' as const, label: 'Lead Info' },
              { key: 'messages' as const, label: 'Messages' },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setMobileTab(t.key)}
                className="px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap"
                style={{ color: mobileTab === t.key ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
              >
                {t.label}
                {mobileTab === t.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: 'var(--color-accent)' }} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Two-panel body (stacked on mobile via tabs) */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — info */}
        {(!isMobile || mobileTab === 'info') && (
        <div
          className={`flex flex-col ${isMobile ? 'flex-1 min-w-0' : 'flex-shrink-0'}`}
          style={{ width: isMobile ? undefined : 384, borderRight: isMobile ? undefined : '1px solid var(--color-border)' }}
        >
          <LeadInfoPanel
            lead={lead}
            onUpdate={setLead}
            onCallClick={() => {}}
            onMessageClick={() => {
              if (isMobile) setMobileTab('messages')
              rightPanelRef.current?.focusMessages()
            }}
            fieldOptions={fieldOptions}
            onOptionAdded={handleOptionAdded}
            onOptionRenamed={handleOptionRenamed}
            onOptionDeleted={handleOptionDeleted}
            onOptionsChange={handleOptionsChange}
            showViewProfile={false}
            ghlLocationId={ghlLocationId}
          />
        </div>
        )}

        {/* Right panel — messages */}
        {(!isMobile || mobileTab === 'messages') && (
        <div className="flex-1 min-w-0 h-full">
          <LeadProfileRightPanel
            lead={lead}
            initialConversationId={initialConversationId}
            studioEmail={studioEmail}
            imperativeRef={rightPanelRef}
          />
        </div>
        )}
      </div>
    </div>
  )
}
