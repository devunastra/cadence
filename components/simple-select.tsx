'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'

interface SimpleSelectProps {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  fullWidth?: boolean
  minWidth?: number
  clearable?: boolean
  disabled?: boolean
  triggerBg?: string
  triggerClassName?: string
  /** When true, renders a search input above the options list and filters them as the user types. */
  searchable?: boolean
  /** Placeholder for the search box when `searchable` is on. */
  searchPlaceholder?: string
}

export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  fullWidth = false,
  minWidth,
  clearable = true,
  disabled = false,
  triggerBg,
  triggerClassName,
  searchable = false,
  searchPlaceholder = 'Search…',
}: SimpleSelectProps) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [query, setQuery] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = options.find(o => o.value === value)

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const q = query.trim().toLowerCase()
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, query, searchable])

  function handleToggle() {
    if (disabled) return
    if (!open && buttonRef.current) {
      setRect(buttonRef.current.getBoundingClientRect())
    }
    setOpen(o => !o)
  }

  // Reset the search filter and auto-focus the input every time the panel opens.
  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    if (searchable) {
      // Defer focus until after the panel is in the DOM.
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open, searchable])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        buttonRef.current && buttonRef.current.contains(e.target as Node)
      ) return
      if (
        panelRef.current && panelRef.current.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className={fullWidth ? 'w-full' : 'relative inline-block'}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-sm${fullWidth ? ' w-full' : ''}${triggerClassName ? ` ${triggerClassName}` : ''}`}
        style={{
          border: '1px solid var(--color-border)',
          boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none',
          backgroundColor: triggerBg ?? 'var(--color-surface)',
          color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          minWidth: minWidth ?? (fullWidth ? undefined : 120),
          transition: 'box-shadow var(--transition-fast), background var(--transition-fast)',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={e => {
          if (!open) (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-strong)'
          if (!triggerBg) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'
          if (!triggerBg) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
        }}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--color-text-muted)' }}
        />
      </button>

      {open && rect && (() => {
        const DROPDOWN_HEIGHT = 260
        const spaceBelow = window.innerHeight - rect.bottom - 4
        const openUpward = spaceBelow < DROPDOWN_HEIGHT && rect.top > DROPDOWN_HEIGHT
        return (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            ...(openUpward
              ? { bottom: window.innerHeight - rect.top + 4 }
              : { top: rect.bottom + 4 }),
            left: rect.left,
            width: rect.width,
            zIndex: 1000,
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {searchable && (
            <div
              className="px-2 pt-2 pb-1"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full px-2 py-1 text-base md:text-sm rounded-md focus:outline-none"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                }}
              />
            </div>
          )}
          <div className="py-1" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {clearable && !query && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
                style={{
                  backgroundColor: !value ? 'var(--color-accent)' : 'transparent',
                  color: !value ? '#ffffff' : 'var(--color-text-muted)',
                  transition: 'none',
                }}
                onMouseEnter={e => { if (value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
                onMouseLeave={e => { if (value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                {placeholder}
              </button>
            )}
            {filtered.length === 0 ? (
              <div
                className="px-3 py-2 text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {query.trim()
                  ? 'No matches'
                  : options.length === 0
                    ? 'No options available'
                    : 'No matches'}
              </div>
            ) : (
              filtered.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
                  style={{
                    backgroundColor: value === o.value ? 'var(--color-accent)' : 'transparent',
                    color: value === o.value ? '#ffffff' : 'var(--color-text-primary)',
                    fontWeight: value === o.value ? 500 : 400,
                    transition: 'none',
                  }}
                  onMouseEnter={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)' }}
                  onMouseLeave={e => { if (value !== o.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
        )
      })()}
    </div>
  )
}
