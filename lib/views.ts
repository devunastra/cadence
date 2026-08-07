export interface LeadView {
  id: string
  name: string
  columns: string[]
  isPermanent?: boolean // true only for "All Columns" — cannot be deleted
}

export const ALL_COLUMN_LABELS: Record<string, string> = {
  created_at:     'Created Time',
  name:           'Name',
  status:         'Status',
  action:         'Action',
  dnd:            'DND',
  phone:          'Phone',
  last_contacted: 'Last Contacted',
  first_lesson:   'First Lesson',
  comments:       'Comments',
  notes:          'Notes',
  source:         'Source',
  email:          'Email',
  reason:         'Reason',
  available:      'Available',
  showed:         'Showed',
  bought:         'Bought',
  partnership:    'Partnership',
  old:            'OLD',
}

export const ALL_COLUMN_KEYS = Object.keys(ALL_COLUMN_LABELS)

// The only permanent client-side view — always available, cannot be deleted
export const ALL_COLUMNS_VIEW: LeadView = {
  id: 'all',
  name: 'Default View',
  columns: ALL_COLUMN_KEYS,
  isPermanent: true,
}

/* ─── Column order ───────────────────────────────────────────────────────────
 * The saved order lives in `user_preferences.col_order` — per user, per studio,
 * exactly like `col_widths`. It is one global ordering of every lead column, not
 * a per-view one: a view decides *which* columns show, the preference decides
 * *what order* they show in. Dragging a column in one view therefore moves it in
 * every view, which keeps a user's table layout stable as they switch tabs.
 *
 * `[]` means "never reordered" → canonical ALL_COLUMN_KEYS order.
 */

/** Expand a saved order into a complete, deduped ordering of every known column.
 *  Unknown keys (a column that was removed from the app) are dropped; columns
 *  added after the preference was saved are appended at the end. */
export function resolveColumnOrder(saved: string[] | null | undefined): string[] {
  if (!saved || saved.length === 0) return ALL_COLUMN_KEYS
  const seen = new Set<string>()
  const known: string[] = []
  for (const key of saved) {
    if (seen.has(key) || !(key in ALL_COLUMN_LABELS)) continue
    seen.add(key)
    known.push(key)
  }
  return [...known, ...ALL_COLUMN_KEYS.filter(k => !seen.has(k))]
}

/** Move `dragKey` to sit immediately before (or after) `targetKey`.
 *  Operates on the full ordering, so hidden columns keep their relative spot —
 *  a column dropped "after Phone" lands right after Phone whether or not the
 *  columns in between are visible in the current view. */
export function moveColumn(
  order: string[],
  dragKey: string,
  targetKey: string,
  placeAfter: boolean,
): string[] {
  if (dragKey === targetKey) return order
  const next = order.filter(k => k !== dragKey)
  const idx = next.indexOf(targetKey)
  if (idx === -1) return order
  next.splice(placeAfter ? idx + 1 : idx, 0, dragKey)
  return next
}

/* ─── Column visibility ──────────────────────────────────────────────────────
 * Two layers, deliberately:
 *   `view.columns`                     — the SHARED studio baseline (lead_views)
 *   `user_preferences.hidden_columns`  — what one user has dropped from their own
 *                                        screen, keyed by view id
 * So a studio agrees on a view's column set, and each person can still hide the
 * ones they don't use without touching anyone else's table.
 */
export type HiddenColumns = Record<string, string[]>

/** The columns a user actually sees: the view's set, minus what they hid, in
 *  their saved order. Single source of truth for the header and the body. */
export function visibleColumnsFor(
  viewColumns: string[],
  hiddenForView: string[] | undefined,
  savedOrder: string[] | null | undefined,
): string[] {
  const hidden = new Set(hiddenForView ?? [])
  const shown = new Set(viewColumns.filter(k => !hidden.has(k)))
  return resolveColumnOrder(savedOrder).filter(k => shown.has(k))
}

const ACTIVE_VIEW_KEY = 'lead_active_view'

export function loadActiveViewId(): string {
  if (typeof window === 'undefined') return 'all'
  return localStorage.getItem(ACTIVE_VIEW_KEY) ?? 'all'
}

export function saveActiveViewId(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ACTIVE_VIEW_KEY, id)
}
