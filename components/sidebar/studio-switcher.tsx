'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronsUpDown, Check } from 'lucide-react'
import type { Studio } from '@/lib/types'

interface StudioSwitcherProps {
  studios: Studio[]
  currentStudio: Studio
  onSwitch: (studio: Studio) => void
  collapsed?: boolean
}

export function StudioSwitcher({ studios, currentStudio, onSwitch, collapsed }: StudioSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = studios.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.city || s.location || '').toLowerCase().includes(search.toLowerCase())
  )

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  // Focus search when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50)
      setSearch('')
    }
  }, [open])

  const initials = currentStudio.name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center py-2 rounded-lg group min-h-[52px] ${collapsed ? 'justify-center' : 'gap-2.5 px-3 text-left'}`}
        style={{ boxShadow: open ? '0 0 0 2px var(--color-accent)' : 'none', transition: 'background var(--transition-fast)' }}
        title={collapsed ? currentStudio.name : undefined}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
      >
        {/* Studio avatar */}
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {initials}
        </div>

        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                {currentStudio.name}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {[currentStudio.city, currentStudio.state].filter(Boolean).join(', ') || currentStudio.location}
              </p>
            </div>
            <ChevronsUpDown
              size={14}
              className="flex-shrink-0 opacity-40 group-hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-text-secondary)' }}
            />
          </>
        )}
      </button>

      {/* Floating panel — appears to the RIGHT of the sidebar, with arrow tip */}
      {open && (
        <div
          className="absolute top-0 z-[100] w-72 rounded-xl shadow-xl overflow-hidden"
          style={{
            left: 'calc(100% + 2px)',
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          }}
        >
          {/* Arrow tip pointing left toward the sidebar */}
          <div style={{ position: 'absolute', left: -9, top: 18, width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderRight: '9px solid var(--color-border)' }} />
          <div style={{ position: 'absolute', left: -8, top: 19, width: 0, height: 0, borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderRight: '8px solid var(--color-bg)' }} />
          {/* Search */}
          <div className="p-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search studios..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-lg outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              }}
            />
          </div>

          {/* Studio list */}
          <div className="py-1 max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
                No studios found
              </p>
            ) : (
              filtered.map(studio => {
                const isActive = studio.id === currentStudio.id
                const studioInitials = studio.name
                  .split(' ')
                  .slice(0, 2)
                  .map(w => w[0])
                  .join('')
                  .toUpperCase()

                return (
                  <button
                    key={studio.id}
                    onClick={() => { onSwitch(studio); setOpen(false) }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                    style={{
                      backgroundColor: isActive ? 'var(--color-surface-hover)' : 'transparent',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'
                    }}
                    onMouseLeave={e => {
                      if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                    }}
                  >
                    <div
                      className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                      style={{ backgroundColor: 'var(--color-accent)' }}
                    >
                      {studioInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {studio.name}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                        {[studio.city, studio.state].filter(Boolean).join(', ') || studio.location}
                      </p>
                    </div>
                    {isActive && (
                      <Check size={14} style={{ color: 'var(--color-accent)' }} className="flex-shrink-0" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
