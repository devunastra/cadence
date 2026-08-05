/**
 * Unit tests for the column-order helpers in lib/views.ts — the logic behind
 * drag-to-rearrange on the Leads table.
 *
 * The cases that matter are the ones a saved preference outlives: a column added
 * to the app after the user last dragged (must still appear), a column removed
 * from the app (must not resurrect), and a move made while some columns are
 * hidden by the active view (the hidden ones must keep their relative spot).
 */

import { describe, it, expect } from 'vitest'
import { resolveColumnOrder, moveColumn, visibleColumnsFor, ALL_COLUMN_KEYS } from '@/lib/views'

describe('resolveColumnOrder', () => {
  it('falls back to the canonical order when nothing is saved', () => {
    expect(resolveColumnOrder(null)).toEqual(ALL_COLUMN_KEYS)
    expect(resolveColumnOrder(undefined)).toEqual(ALL_COLUMN_KEYS)
    expect(resolveColumnOrder([])).toEqual(ALL_COLUMN_KEYS)
  })

  it('leads with the saved keys, in the saved order', () => {
    const resolved = resolveColumnOrder(['phone', 'name'])
    expect(resolved.slice(0, 2)).toEqual(['phone', 'name'])
  })

  it('appends columns added to the app after the preference was saved', () => {
    // A preference saved before `notes` existed must still surface `notes`.
    const saved = ALL_COLUMN_KEYS.filter(k => k !== 'notes')
    const resolved = resolveColumnOrder(saved)
    expect(resolved).toHaveLength(ALL_COLUMN_KEYS.length)
    expect(resolved.at(-1)).toBe('notes')
  })

  it('drops keys the app no longer knows', () => {
    // `level` was a real column once (migration 052 dropped it).
    const resolved = resolveColumnOrder(['level', 'name', 'phone'])
    expect(resolved).not.toContain('level')
    expect(resolved.slice(0, 2)).toEqual(['name', 'phone'])
  })

  it('dedupes a corrupt saved order', () => {
    const resolved = resolveColumnOrder(['name', 'name', 'phone'])
    expect(resolved).toEqual([...new Set(resolved)])
    expect(resolved).toHaveLength(ALL_COLUMN_KEYS.length)
  })

  it('always returns every known column exactly once', () => {
    const resolved = resolveColumnOrder(['old', 'bought', 'zzz_not_a_column'])
    expect([...resolved].sort()).toEqual([...ALL_COLUMN_KEYS].sort())
  })
})

describe('moveColumn', () => {
  const order = ['a', 'b', 'c', 'd']

  it('drops the column before the target', () => {
    expect(moveColumn(order, 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('drops the column after the target', () => {
    expect(moveColumn(order, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a column to the very front', () => {
    expect(moveColumn(order, 'c', 'a', false)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('moves a column to the very back', () => {
    expect(moveColumn(order, 'a', 'd', true)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('is a no-op when dropped on itself', () => {
    expect(moveColumn(order, 'b', 'b', true)).toEqual(order)
    expect(moveColumn(order, 'b', 'b', false)).toEqual(order)
  })

  it('is a no-op when dropped back where it already sits', () => {
    // 'b' already follows 'a' — dropping it after 'a' changes nothing, which is
    // what suppresses the "Moved …" toast on an accidental nudge.
    expect(moveColumn(order, 'b', 'a', true)).toEqual(order)
  })

  it('ignores an unknown target', () => {
    expect(moveColumn(order, 'a', 'nope', false)).toEqual(order)
  })

  it('keeps hidden columns in place when moving a visible one', () => {
    // View shows a and d only; 'b' and 'c' are hidden between them.
    // Dropping 'd' before 'a' must not disturb b/c's relative order.
    expect(moveColumn(order, 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('lands a column directly after its target even across hidden ones', () => {
    // Dropping 'a' after visible 'b' puts it between the hidden 'c' and 'b',
    // so visually it sits right after 'b' — which is what the user aimed at.
    expect(moveColumn(order, 'a', 'b', true)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('does not mutate the input array', () => {
    const input = [...order]
    moveColumn(input, 'a', 'd', true)
    expect(input).toEqual(order)
  })
})

describe('visibleColumnsFor', () => {
  const view = ['name', 'status', 'phone', 'email']

  it('shows the whole view when nothing is hidden', () => {
    expect(visibleColumnsFor(view, undefined, null)).toEqual(['name', 'status', 'phone', 'email'])
    expect(visibleColumnsFor(view, [], null)).toEqual(['name', 'status', 'phone', 'email'])
  })

  it('drops hidden columns', () => {
    expect(visibleColumnsFor(view, ['status', 'email'], null)).toEqual(['name', 'phone'])
  })

  it('applies the saved order to what is left', () => {
    const ordered = visibleColumnsFor(view, ['status'], ['phone', 'email', 'name'])
    expect(ordered).toEqual(['phone', 'email', 'name'])
  })

  it('ignores hidden keys the view does not offer', () => {
    // Stale entry left behind after a view's column set shrank
    expect(visibleColumnsFor(view, ['comments', 'old'], null)).toEqual(view)
  })

  it('shows a column added to the app after the preference was written', () => {
    // The point of storing HIDDEN rather than VISIBLE: `notes` was never hidden,
    // so it appears the moment the view offers it.
    const withNotes = [...view, 'notes']
    expect(visibleColumnsFor(withNotes, ['status'], null)).toContain('notes')
  })

  it('can hide everything — the last-column guard lives in the UI, not here', () => {
    expect(visibleColumnsFor(view, view, null)).toEqual([])
  })

  it('never invents a column the view does not offer', () => {
    const result = visibleColumnsFor(['name'], [], ALL_COLUMN_KEYS)
    expect(result).toEqual(['name'])
  })
})
