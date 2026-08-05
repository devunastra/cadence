'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { updateStudio } from '@/app/actions'
import { useCurrentStudio } from '@/components/studio-context'
import { useToast } from '@/components/ui/toast-provider'
import { CallHoursEditor, callHoursAreValid } from '@/components/settings/call-hours-editor'
import { normalizeCallHours, formatCallHoursSummary, type CallHours } from '@/lib/call-hours'

interface CallHoursModalProps {
  onClose: () => void
}

/**
 * Edit the studio's outbound calling window without leaving Leads.
 *
 * The same control also lives at Settings → Business Profile; this is a shortcut
 * from the AI Voice Agent pill, which is where you actually notice the window is
 * wrong. Both write the same column through the same server action, so neither is
 * a special case.
 */
export function CallHoursModal({ onClose }: CallHoursModalProps) {
  const { currentStudio, updateCurrentStudio } = useCurrentStudio()
  const { showSuccess, showError } = useToast()

  const [hours, setHours] = useState<CallHours | null>(() =>
    normalizeCallHours(currentStudio.call_hours),
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const valid = callHoursAreValid(hours)

  async function handleSave() {
    if (!valid) return
    setSaving(true)
    try {
      await updateStudio(currentStudio.id, { call_hours: hours })
      // Push into context so the pill re-reads the window immediately rather than
      // waiting for the studios Realtime event to make the round trip.
      updateCurrentStudio({ call_hours: hours })
      showSuccess(
        hours ? `Calling hours saved — ${formatCallHoursSummary(hours)}.` : 'Calling hours saved — calling any time.',
      )
      onClose()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to save calling hours.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => { if (!saving) onClose() }} />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl animate-in zoom-in-95 duration-150"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        role="dialog"
        aria-modal="true"
        aria-label="AI calling hours"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              AI Calling Hours
            </p>
            <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>
              {currentStudio.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!saving) onClose() }}
            aria-label="Close"
            className="flex-shrink-0 p-2.5 md:p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <X size={20} />
          </button>
        </div>

        {/* The 7-day editor is taller than most modals — scroll the body, keep the
            header and footer pinned so Save is always reachable. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2">
          <CallHoursEditor
            value={hours}
            onChange={setHours}
            timezone={currentStudio.timezone}
            bare
          />
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {!valid && (
            <p className="text-sm text-red-600 dark:text-red-400 mr-auto">
              Fix the highlighted days first.
            </p>
          )}
          <button
            type="button"
            onClick={() => { if (!saving) onClose() }}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !valid}
            className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
