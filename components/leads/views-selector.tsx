'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, X, Check, Pencil } from 'lucide-react'
import { ALL_COLUMNS_VIEW, ALL_COLUMN_LABELS, ALL_COLUMN_KEYS } from '@/lib/views'
import type { LeadView } from '@/lib/views'

interface ViewsSelectorProps {
  views: LeadView[]
  activeViewId: string
  onViewChange: (view: LeadView) => void
  onCreateView: (view: LeadView) => Promise<void>
  onEditView: (id: string, name: string, columns: string[]) => Promise<void>
  onDeleteView: (id: string) => Promise<void>
}

/* ─── View modal (create / edit) ─── */

interface ViewModalProps {
  existing?: LeadView
  onSave: (view: LeadView) => void
  onClose: () => void
}

function ViewModal({ existing, onSave, onClose }: ViewModalProps) {
  const isEdit = !!existing
  const [name, setName] = useState(existing?.name ?? '')
  const [selectedCols, setSelectedCols] = useState<string[]>(
    existing?.columns ?? ['name', 'status', 'phone']
  )

  function toggle(col: string) {
    setSelectedCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    )
  }

  function handleSave() {
    if (!name.trim() || selectedCols.length === 0) return
    onSave({
      id: existing?.id ?? `tmp-${Date.now()}`,
      name: name.trim(),
      columns: ALL_COLUMN_KEYS.filter(k => selectedCols.includes(k)),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onPointerDown={onClose}
    >
      <div
        className="flex flex-col max-h-[85vh] overflow-hidden"
        style={{
          width: 480,
          backgroundColor: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
        }}
        onPointerDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {isEdit ? 'Edit view' : 'Create new view'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* View name */}
          <div>
            <label
              className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              View name
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value.slice(0, 24))}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
              placeholder="e.g. My View"
              className="w-full text-base md:text-sm px-3 py-2 rounded-lg outline-none"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                transition: 'border-color var(--transition-fast)',
              }}
              onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'}
              onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'}
            />
          </div>

          {/* Column picker */}
          <div>
            <label
              className="block text-xs font-medium mb-2"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Columns — {selectedCols.length} selected
            </label>
            <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
              {ALL_COLUMN_KEYS.map(key => {
                const active = selectedCols.includes(key)
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left"
                    style={{
                      backgroundColor: active ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                      color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      fontWeight: active ? 600 : 400,
                      transition: 'background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)',
                    }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center border"
                      style={{
                        borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                        backgroundColor: active ? 'var(--color-accent)' : 'transparent',
                      }}
                    >
                      {active && <Check size={9} strokeWidth={3} color="#fff" />}
                    </span>
                    {ALL_COLUMN_LABELS[key]}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer — equal width buttons */}
        <div
          className="flex gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={handleSave}
            disabled={!name.trim() || selectedCols.length === 0}
            className="flex-1 text-sm font-medium py-2 rounded-lg transition-colors"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: '#ffffff',
            }}
            onMouseEnter={e => {
              if (!e.currentTarget.disabled)
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'
            }}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
          >
            {isEdit ? 'Save changes' : 'Create view'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 text-sm font-medium py-2 rounded-lg transition-colors"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Main tab bar ─── */

export function ViewsSelector({
  views,
  activeViewId,
  onViewChange,
  onCreateView,
  onEditView,
  onDeleteView,
}: ViewsSelectorProps) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<LeadView | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0, hasDragged: false })

  const allViews = [ALL_COLUMNS_VIEW, ...views.filter(v => !v.isPermanent)]

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current.active || !scrollRef.current) return
      const dx = e.clientX - dragRef.current.startX
      if (Math.abs(dx) > 3) dragRef.current.hasDragged = true
      scrollRef.current.scrollLeft = dragRef.current.scrollLeft - dx
    }
    function onMouseUp() {
      dragRef.current.active = false
      document.body.style.cursor = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  async function handleCreate(view: LeadView) {
    await onCreateView(view)
    setCreating(false)
  }

  async function handleEdit(view: LeadView) {
    await onEditView(view.id, view.name, view.columns)
    setEditing(null)
  }

  return (
    <>
      {/* Tab strip — horizontally scrollable, hidden scrollbar, draggable */}
      <div
        ref={scrollRef}
        className="views-scroll flex items-end"
        style={{
          borderBottom: '1px solid var(--color-border)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          userSelect: 'none',
        }}
        onMouseDown={e => {
          if (!scrollRef.current) return
          dragRef.current = { active: true, startX: e.clientX, scrollLeft: scrollRef.current.scrollLeft, hasDragged: false }
          document.body.style.cursor = 'grabbing'
        }}
        onClickCapture={e => {
          if (dragRef.current.hasDragged) {
            e.stopPropagation()
            dragRef.current.hasDragged = false
          }
        }}
      >
        {allViews.map(view => {
          const active = view.id === activeViewId
          const isDeletable = !view.isPermanent

          return (
            <div key={view.id} className="relative flex items-center group flex-shrink-0">
              <button
                onClick={() => onViewChange(view)}
                className="flex items-center gap-2 px-4 pb-2.5 pt-2 text-sm transition-colors"
                style={{
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  fontWeight: active ? 600 : 500,
                  borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                  whiteSpace: 'nowrap',
                  transition: `color var(--transition-fast), border-color var(--transition-fast)`,
                }}
                onMouseEnter={e => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                }}
              >
                {view.name}
              </button>

              {/* Edit/delete icons on hover for deletable views */}
              {isDeletable && (
                <div className="hidden group-hover:flex items-center gap-0.5 pr-1.5 -ml-1">
                  <button
                    onClick={e => { e.stopPropagation(); setEditing(view) }}
                    className="p-0.5 rounded transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                    title="Edit view"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteView(view.id) }}
                    className="p-0.5 rounded transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#ef4444'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                    title="Delete view"
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {/* Add new view */}
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 px-3 py-2 mb-0.5 text-xs rounded-md transition-colors ml-1 flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
          title="Add view"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Modals */}
      {creating && <ViewModal onSave={handleCreate} onClose={() => setCreating(false)} />}
      {editing && <ViewModal existing={editing} onSave={handleEdit} onClose={() => setEditing(null)} />}
    </>
  )
}
