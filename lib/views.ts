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
  level:          'Level',
  action:         'Action',
  phone:          'Phone',
  last_contacted: 'Last Contacted',
  first_lesson:   'First Lesson',
  comments:       'Comments',
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

const ACTIVE_VIEW_KEY = 'lead_active_view'

export function loadActiveViewId(): string {
  if (typeof window === 'undefined') return 'all'
  return localStorage.getItem(ACTIVE_VIEW_KEY) ?? 'all'
}

export function saveActiveViewId(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ACTIVE_VIEW_KEY, id)
}
