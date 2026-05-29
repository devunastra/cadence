'use client'

import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import type { OnboardingStudioInput } from '@/lib/types'
import { INPUT, LABEL } from './onboarding-types'

interface StepLeadSourcesProps {
  studio: OnboardingStudioInput
  onChange: (patch: Partial<OnboardingStudioInput>) => void
}

export function StepLeadSources({ studio, onChange }: StepLeadSourcesProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function addSource() {
    const value = draft.trim()
    if (!value) return
    if (studio.sources.some(s => s.toLowerCase() === value.toLowerCase())) {
      setError('That source is already in the list.')
      return
    }
    onChange({ sources: [...studio.sources, value] })
    setDraft('')
    setError(null)
  }

  function removeSource(value: string) {
    onChange({ sources: studio.sources.filter(s => s !== value) })
    setError(null)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        These are the lead sources your team can tag on each lead. We&apos;ve added a few common
        ones — add or remove any to match how your studio gets inquiries.
      </p>

      <div>
        <label className={LABEL}>Lead Sources</label>
        <div
          className="flex flex-wrap gap-2 p-3 rounded-lg min-h-[52px]"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          {studio.sources.length === 0 ? (
            <span className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>
              No sources yet — add one below.
            </span>
          ) : (
            studio.sources.map(source => (
              <span
                key={source}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium"
                style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
              >
                {source}
                <button
                  type="button"
                  onClick={() => removeSource(source)}
                  aria-label={`Remove ${source}`}
                  className="transition-opacity hover:opacity-70"
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
            className={INPUT}
          />
          <button
            type="button"
            onClick={addSource}
            disabled={!draft.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white whitespace-nowrap disabled:opacity-50 transition-colors"
            style={{ backgroundColor: 'var(--color-accent)' }}
            onMouseEnter={e => { if (draft.trim()) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)' }}
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
