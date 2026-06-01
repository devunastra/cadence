'use client'

import { useState } from 'react'
import { X, Plus } from 'lucide-react'

interface LeadSourcesEditorProps {
  sources: string[]
  onChange: (sources: string[]) => void
  /** Label rendered above the chips. Defaults to "Lead Sources". */
  label?: string
  /** Helper line under the chips. Defaults to the onboarding-wizard copy. */
  helper?: string
  /** Optional className passed to the surrounding wrapper. */
  className?: string
  /** Disable add/remove (used when a save is in flight). */
  disabled?: boolean
}

/**
 * Chip-style editor for a studio's lead-source list. Used by the onboarding
 * wizard step (where it works against an in-memory `OnboardingStudioInput`)
 * and by both Settings forms (where the parent persists changes to
 * `studio_field_options.source` rows).
 */
export function LeadSourcesEditor({
  sources,
  onChange,
  label = 'Lead Sources',
  helper = 'These are the lead sources your team can tag on each lead. Add or remove any to match how your studio gets inquiries.',
  className,
  disabled = false,
}: LeadSourcesEditorProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function addSource() {
    const value = draft.trim()
    if (!value) return
    if (sources.some(s => s.toLowerCase() === value.toLowerCase())) {
      setError('That source is already in the list.')
      return
    }
    onChange([...sources, value])
    setDraft('')
    setError(null)
  }

  function removeSource(value: string) {
    onChange(sources.filter(s => s !== value))
    setError(null)
  }

  const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'
  const INPUT =
    'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-50'

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{helper}</p>

      <div>
        <label className={LABEL}>{label}</label>
        <div
          className="flex flex-wrap gap-2 p-3 rounded-lg min-h-[52px]"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          {sources.length === 0 ? (
            <span className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>
              No sources yet — add one below.
            </span>
          ) : (
            sources.map(source => (
              <span
                key={source}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium"
                style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
              >
                {source}
                <button
                  type="button"
                  onClick={() => removeSource(source)}
                  disabled={disabled}
                  aria-label={`Remove ${source}`}
                  className="transition-opacity hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <X size={13} />
                </button>
              </span>
            ))
          )}
        </div>
      </div>

      <div>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={e => { setDraft(e.target.value); setError(null) }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSource()
              }
            }}
            placeholder="Add a custom source…"
            disabled={disabled}
            className={INPUT}
          />
          <button
            type="button"
            onClick={addSource}
            disabled={!draft.trim() || disabled}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white whitespace-nowrap disabled:opacity-50 transition-colors"
            style={{ backgroundColor: 'var(--color-accent)' }}
            onMouseEnter={e => { if (draft.trim() && !disabled) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)' }}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
          >
            <Plus size={15} />
            Add
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  )
}
