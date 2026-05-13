'use client'

import { useState } from 'react'
import { Maximize2, X } from 'lucide-react'

interface ExpandableTextareaProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  rows?: number
  label?: string
  style?: React.CSSProperties
  className?: string
  onFocus?: React.FocusEventHandler<HTMLTextAreaElement>
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>
}

export function ExpandableTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  label,
  style = {},
  className = '',
  onFocus,
  onBlur,
}: ExpandableTextareaProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <div className="relative">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          style={{ ...style, resize: 'none' }}
          className={className}
          placeholder={placeholder}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute bottom-2 right-2 p-0.5 rounded transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          title="Expand"
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
        >
          <Maximize2 size={12} />
        </button>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setExpanded(false)} />
          <div
            className="relative w-full max-w-2xl mx-4 rounded-2xl shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
          >
            <div
              className="flex items-center justify-between px-5 py-3"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {label ?? placeholder}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              <textarea
                value={value}
                onChange={e => onChange(e.target.value)}
                rows={14}
                autoFocus
                style={{ ...style, resize: 'none', width: '100%' }}
                className={className}
                placeholder={placeholder}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
