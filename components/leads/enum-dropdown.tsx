'use client'

import { useState, useEffect, useRef } from 'react'
import { Pencil, Plus, Trash2, Check, X, AlertTriangle, GripVertical } from 'lucide-react'
import { COLOR_PRESETS } from '@/lib/field-options'
import { STATUS_COLORS } from '@/lib/constants'
import { updateStudioFieldOptionColor, updateStudioFieldOptionOrder } from '@/app/actions'
import type { FieldOption } from '@/lib/field-options'

interface EnumDropdownProps {
  field: string
  currentValue: string | null
  options: FieldOption[]
  anchorRect: DOMRect
  getUsageCount: (value: string) => number
  onSelect: (value: string | null) => void
  onOptionsChange: (options: FieldOption[]) => void
  onOptionAdded?: (value: string) => Promise<{ id: string; value: string }>
  onOptionRenamed?: (oldValue: string, newValue: string) => void
  onOptionDeleted?: (optionId: string) => Promise<void>
  onClose: () => void
  inline?: boolean
  dropdownWidth?: number
}

interface OptionEditorProps {
  opt: FieldOption
  usageCount: number
  onSave: (oldValue: string, updated: FieldOption) => void
  onDelete: (value: string) => void
  onCancel: () => void
}

function OptionEditor({ opt, usageCount, onSave, onDelete, onCancel }: OptionEditorProps) {
  const [text, setText] = useState(opt.value)
  const [selectedBg, setSelectedBg] = useState(opt.bg)
  const [selectedText, setSelectedText] = useState(opt.text)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function handleSave() {
    if (!text.trim()) return
    onSave(opt.value, { value: text.trim(), bg: selectedBg, text: selectedText })
  }

  if (confirmingDelete) {
    return (
      <div className="p-2 mx-1 mb-1 rounded-lg" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
        <div className="flex items-start gap-1.5 mb-2">
          <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">
            {usageCount > 0
              ? <><strong>{usageCount} {usageCount === 1 ? 'lead' : 'leads'}</strong> currently {usageCount === 1 ? 'uses' : 'use'} <strong>&ldquo;{opt.value}&rdquo;</strong>. Those cells will be cleared.</>
              : <>No leads use <strong>&ldquo;{opt.value}&rdquo;</strong>. Safe to delete.</>
            }
          </p>
        </div>
        <p className="text-xs text-red-600 mb-2 font-medium">Are you sure you want to delete this option?</p>
        <div className="flex gap-1">
          <button
            onClick={() => onDelete(opt.value)}
            className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded px-2 py-1 transition-colors"
          >
            Yes, delete
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            className="flex-1 text-xs rounded px-2 py-1 transition-colors"
            style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-2 mx-1 mb-1 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <input
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel() }}
        className="w-full text-xs rounded px-2 py-1 mb-2 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
      />
      {/* Preview */}
      <div className="mb-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[13px] font-medium ${selectedBg} ${selectedText}`}>
          {text || opt.value}
        </span>
      </div>
      {/* Color grid */}
      <div className="grid grid-cols-9 gap-1 mb-2">
        {COLOR_PRESETS.map(preset => (
          <button
            key={preset.name}
            title={preset.name}
            onClick={() => { setSelectedBg(preset.bg); setSelectedText(preset.text) }}
            className={`w-5 h-5 rounded-full ${preset.bg} border-2 transition-transform hover:scale-110 ${
              selectedBg === preset.bg ? 'border-gray-600 scale-110' : 'border-transparent'
            }`}
          />
        ))}
      </div>
      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={handleSave}
          className="flex-1 text-xs text-white rounded px-2 py-1 transition-colors"
          style={{ backgroundColor: 'var(--color-accent)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
        >
          Save
        </button>
        <button
          onClick={() => setConfirmingDelete(true)}
          title="Delete option"
          className="p-2 md:p-1 rounded transition-colors text-red-400 hover:text-red-600"
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#FEF2F2'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
        >
          <Trash2 size={13} />
        </button>
        <button
          onClick={onCancel}
          className="p-1 rounded transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

export function EnumDropdown({
  field,
  currentValue,
  options,
  anchorRect,
  getUsageCount,
  onSelect,
  onOptionsChange,
  onOptionAdded,
  onOptionRenamed,
  onOptionDeleted,
  onClose,
  inline = false,
  dropdownWidth,
}: EnumDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [newOptionText, setNewOptionText] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const DROPDOWN_WIDTH = dropdownWidth ?? 300
  const viewportWidth  = typeof window !== 'undefined' ? window.innerWidth  : 1200
  const left    = Math.min(anchorRect.left, viewportWidth - DROPDOWN_WIDTH - 8)
  const top = anchorRect.bottom + 4

  function handleSelect(value: string) {
    onSelect(currentValue === value ? null : value)
    onClose()
  }

  function handleSaveEdit(oldValue: string, updated: FieldOption) {
    const opt = options.find(o => o.value === oldValue)
    const next = options.map(o => o.value === oldValue ? { ...updated, id: o.id } : o)
    onOptionsChange(next)
    // Persist color change to studio_field_options if color changed
    if (opt?.id && (opt.bg !== updated.bg || opt.text !== updated.text)) {
      updateStudioFieldOptionColor(opt.id, updated.bg, updated.text).catch(console.error)
    }
    if (oldValue !== updated.value) {
      onOptionRenamed?.(oldValue, updated.value)
    }
    setEditingValue(null)
  }

  function handleDelete(value: string) {
    const opt = options.find(o => o.value === value)
    const next = options.filter(o => o.value !== value)
    onOptionsChange(next)
    if (opt?.id) onOptionDeleted?.(opt.id)
    setEditingValue(null)
    if (currentValue === value) onSelect(null)
  }

  function handleAddOption() {
    const trimmed = newOptionText.trim()
    if (!trimmed || options.some(o => o.value === trimmed)) return
    const newOpt: FieldOption = { value: trimmed, bg: COLOR_PRESETS[0].bg, text: COLOR_PRESETS[0].text }
    onOptionAdded?.(trimmed).then(saved => {
      onOptionsChange([...options, { ...newOpt, id: saved.id }])
    })
    setNewOptionText('')
  }

  function handleDragStart(index: number) {
    setDragIndex(index)
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    setDragOverIndex(index)
  }

  function handleDrop(dropIndex: number) {
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const next = [...options]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(dropIndex, 0, moved)
    onOptionsChange(next)
    const updates = next
      .filter(o => o.id)
      .map((o, i) => ({ id: o.id!, sortOrder: i + 1 }))
    if (updates.length > 0) updateStudioFieldOptionOrder(updates).catch(console.error)
    setDragIndex(null)
    setDragOverIndex(null)
  }

  function handleDragEnd() {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const positionStyle = inline
    ? { position: 'absolute' as const, top: '100%', left: 0, width: DROPDOWN_WIDTH, zIndex: 50, marginTop: 4 }
    : { position: 'fixed' as const, top, left, width: DROPDOWN_WIDTH, zIndex: 1000 }

  return (
    <div
      ref={ref}
      style={{
        ...positionStyle,
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border-strong)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      }}
      className="rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div
        className="px-3 py-2.5 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          Select an option
        </span>
        <button
          onClick={onClose}
          className="p-0.5 rounded"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
        >
          <X size={13} />
        </button>
      </div>

      {/* Options list */}
      <div className="max-h-80 overflow-y-auto py-1.5" style={{ backgroundColor: 'var(--color-bg)' }}>
        {options.map((opt, index) => {
          const badgeColors = (opt.bg && opt.text) ? { bg: opt.bg, text: opt.text } : (STATUS_COLORS[opt.value] ?? { bg: 'status-bg-default', text: 'status-text-default' })
          const isDraggingThis = dragIndex === index
          const isDragTarget = dragOverIndex === index && dragIndex !== index
          return (
            <div
              key={opt.value}
              draggable={editingValue !== opt.value}
              onDragStart={() => handleDragStart(index)}
              onDragOver={e => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
              style={{
                opacity: isDraggingThis ? 0.4 : 1,
                borderTop: isDragTarget ? '2px solid var(--color-accent)' : '2px solid transparent',
                transition: 'opacity 150ms ease',
              }}
            >
              {editingValue === opt.value ? (
                <OptionEditor
                  opt={opt}
                  usageCount={getUsageCount(opt.value)}
                  onSave={handleSaveEdit}
                  onDelete={handleDelete}
                  onCancel={() => setEditingValue(null)}
                />
              ) : (
                <div
                  className="flex items-center gap-1.5 px-2 py-1.5 group cursor-pointer"
                  style={{ transition: 'background var(--transition-fast)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  {/* Drag handle */}
                  <span
                    className="flex-shrink-0 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing"
                    style={{ color: 'var(--color-text-muted)', lineHeight: 0 }}
                  >
                    <GripVertical size={13} />
                  </span>

                  {/* Badge + checkmark */}
                  <button
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                    onClick={() => handleSelect(opt.value)}
                  >
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[13px] font-medium truncate max-w-[190px] ${badgeColors.bg} ${badgeColors.text}`}>
                      {opt.value}
                    </span>
                    {opt.value === currentValue && (
                      <Check size={13} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                    )}
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={e => { e.stopPropagation(); setEditingValue(opt.value) }}
                    title="Edit option"
                    className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-all"
                    style={{ color: 'var(--color-text-muted)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add option footer */}
      <div className="px-3 py-2.5" style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
        <div className="flex items-center gap-1.5">
          <Plus size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <input
            value={newOptionText}
            onChange={e => setNewOptionText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddOption() }}
            placeholder="Add an option..."
            className="flex-1 text-xs bg-transparent outline-none"
            style={{ color: 'var(--color-text-primary)' }}
          />
          {newOptionText && (
            <button
              onClick={handleAddOption}
              className="text-xs font-medium hover:underline"
              style={{ color: 'var(--color-accent)' }}
            >
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
