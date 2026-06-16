'use client'

import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { defaultSourceDetail, SOURCE_KIND_CONFIG } from '@/lib/source-kinds'
import type { SourceDetail } from '@/lib/source-kinds'

interface LeadSourcesEditorProps {
  sources: SourceDetail[]
  onChange: (sources: SourceDetail[]) => void
  /** Label rendered above the cards. Defaults to "Lead Sources". */
  label?: string
  /** Helper line under the label. Defaults to the onboarding-wizard copy. */
  helper?: string
  /** Optional className passed to the surrounding wrapper. */
  className?: string
  /** Disable add/remove/edit (used when a save is in flight). */
  disabled?: boolean
}

/**
 * Stacked-card editor for a studio's lead-source list with per-source detail
 * capture. Each known source (Email, Facebook, Website Form, …) shows the
 * matching typed input below its header; unknown source names fall back to a
 * free-text "How do leads come in here?" field.
 *
 * Used by the onboarding wizard (against `OnboardingStudioInput.sources`) and
 * by Settings → Studios (where the parent persists changes to
 * `studio_field_options.source` rows, including the metadata jsonb column).
 */
export function LeadSourcesEditor({
  sources,
  onChange,
  label = 'Lead Sources',
  helper = 'These are the lead sources your team can tag on each lead. Add or remove any to match how your studio gets inquiries — and tell us how each one reaches you.',
  className,
  disabled = false,
}: LeadSourcesEditorProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function addSource() {
    const value = draft.trim()
    if (!value) return
    if (sources.some(s => s.name.toLowerCase() === value.toLowerCase())) {
      setError('That source is already in the list.')
      return
    }
    onChange([...sources, defaultSourceDetail(value)])
    setDraft('')
    setError(null)
  }

  function removeSource(name: string) {
    onChange(sources.filter(s => s.name !== name))
    setError(null)
  }

  function updateValue(name: string, value: string) {
    onChange(sources.map(s => (s.name === name ? { ...s, value } : s)))
  }

  const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'
  const INPUT =
    'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-50'

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      <div>
        <label className={LABEL}>{label}</label>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>{helper}</p>

        <div className="space-y-2">
          {sources.length === 0 ? (
            <div
              className="p-4 rounded-lg text-sm italic"
              style={{
                border: '1px dashed var(--color-border)',
                color: 'var(--color-text-muted)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              No sources yet — add one below.
            </div>
          ) : (
            sources.map(source => (
              <SourceCard
                key={source.name}
                source={source}
                disabled={disabled}
                onRemove={() => removeSource(source.name)}
                onValueChange={v => updateValue(source.name, v)}
              />
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

interface SourceCardProps {
  source: SourceDetail
  disabled: boolean
  onRemove: () => void
  onValueChange: (value: string) => void
}

function SourceCard({ source, disabled, onRemove, onValueChange }: SourceCardProps) {
  const config = source.kind === 'none' ? null : SOURCE_KIND_CONFIG[source.kind]
  const INPUT =
    'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-50'

  return (
    <div
      className="p-4 rounded-lg"
      style={{
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium"
          style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
        >
          {source.name}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${source.name}`}
          className="p-2.5 md:p-1 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)' }}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
        >
          <X size={16} />
        </button>
      </div>

      {config === null ? (
        <p className="mt-2 text-xs italic" style={{ color: 'var(--color-text-muted)' }}>
          No additional detail needed.
        </p>
      ) : (
        <div className="mt-3">
          <label
            className="block text-xs font-medium mb-1"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {config.label}
          </label>
          {config.multiline ? (
            <textarea
              value={source.value}
              onChange={e => onValueChange(e.target.value)}
              placeholder={config.placeholder}
              disabled={disabled}
              rows={2}
              className={INPUT + ' resize-y min-h-[60px]'}
            />
          ) : (
            <input
              type={config.inputType}
              value={source.value}
              onChange={e => onValueChange(e.target.value)}
              placeholder={config.placeholder}
              disabled={disabled}
              autoComplete="off"
              className={INPUT}
            />
          )}
        </div>
      )}
    </div>
  )
}
