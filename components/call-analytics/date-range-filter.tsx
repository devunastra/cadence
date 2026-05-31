'use client'

import { useState } from 'react'
import type { DatePreset, DateRange } from '@/lib/types'
import { getPresetRange, toDateInputValue } from '@/lib/date-utils'
import { useCurrentStudio } from '@/components/studio-context'

interface DateRangeFilterProps {
  value: DateRange
  onChange: (range: DateRange) => void
  onCustomApply?: (range: DateRange) => void
}

const PRESETS: { label: string; preset: DatePreset }[] = [
  { label: 'Today',    preset: 'today' },
  { label: '7d',       preset: '7d'    },
  { label: '4 weeks',  preset: '4w'    },
  { label: '3 months', preset: '3m'    },
  { label: 'All time', preset: 'all'   },
  { label: 'Custom',   preset: 'custom'},
]

export function DateRangeFilter({ value, onChange, onCustomApply }: DateRangeFilterProps) {
  const { currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  const [customFrom, setCustomFrom] = useState(toDateInputValue(value.from))
  const [customTo,   setCustomTo]   = useState(toDateInputValue(value.to))

  function selectPreset(preset: DatePreset) {
    if (preset === 'custom') {
      onChange({ ...value, preset: 'custom' })
      return
    }
    const { from, to } = getPresetRange(preset, tz)
    onChange({ from, to, preset })
  }

  function applyCustom() {
    const from = new Date(customFrom)
    const to   = new Date(customTo + 'T23:59:59')
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return
    const range: DateRange = { from, to, preset: 'custom' }
    if (onCustomApply) onCustomApply(range)
    else onChange(range)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        {PRESETS.map(({ label, preset }) => (
          <button
            key={preset}
            onClick={() => selectPreset(preset)}
            className="px-3 h-8 text-sm font-medium rounded-md border transition-colors"
            style={{
              backgroundColor: value.preset === preset ? 'var(--color-accent)' : 'var(--color-bg)',
              color: value.preset === preset ? '#ffffff' : 'var(--color-text-secondary)',
              borderColor: value.preset === preset ? 'var(--color-accent)' : 'var(--color-border)',
            }}
            onMouseEnter={e => {
              if (value.preset !== preset) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
            }}
            onMouseLeave={e => {
              if (value.preset !== preset) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {value.preset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            className="text-base md:text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
          />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>to</span>
          <input
            type="date"
            value={customTo}
            onChange={e => setCustomTo(e.target.value)}
            className="text-base md:text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
          />
          <button
            onClick={applyCustom}
            className="text-xs px-3 py-1 text-white rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--color-accent)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
