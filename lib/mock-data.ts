/**
 * Mock data helpers for the deploy/SIT branch.
 * Returns static data from mock-data.json instead of hitting Supabase/GHL APIs.
 */
import mockJson from './mock-data.json'
import type { Lead, Call, Appointment, CallAnalyticsData } from '@/lib/types'
import type { CallHistoryRow } from '@/app/actions'
import { groupCallsByDay } from '@/lib/date-utils'

// ── Raw JSON accessors ──────────────────────────────────────────────────────

export const MOCK_LEADS = mockJson.leads as Lead[]
export const MOCK_CONVERSATIONS = mockJson.conversations
export const MOCK_MESSAGES = mockJson.messages
export const MOCK_APPOINTMENTS = mockJson.appointments as Appointment[]
export const MOCK_CALLS = mockJson.calls as Call[]
export const MOCK_CALL_HISTORY = mockJson.callHistory

// ── Leads helpers ───────────────────────────────────────────────────────────

export function getMockLeads(opts?: {
  page?: number
  pageSize?: number
  search?: string
  statusFilter?: string[]
  levelFilter?: string[]
  actionFilter?: string[]
  sourceFilter?: string[]
  reasonFilter?: string[]
  sortField?: string
  sortAscending?: boolean
}): { leads: Lead[]; total: number } {
  let filtered = [...MOCK_LEADS]
  const {
    page = 0, pageSize = 50, search = '',
    statusFilter = [], levelFilter = [], actionFilter = [],
    sourceFilter = [], reasonFilter = [],
    sortField = 'created_at', sortAscending = false,
  } = opts ?? {}

  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.phone?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q)
    )
  }
  if (statusFilter.length) filtered = filtered.filter(l => l.status && statusFilter.includes(l.status))
  if (levelFilter.length) filtered = filtered.filter(l => l.level && levelFilter.includes(l.level))
  if (actionFilter.length) filtered = filtered.filter(l => l.action && actionFilter.includes(l.action))
  if (sourceFilter.length) filtered = filtered.filter(l => l.source && sourceFilter.includes(l.source))
  if (reasonFilter.length) filtered = filtered.filter(l => l.reason && reasonFilter.includes(l.reason))

  filtered.sort((a, b) => {
    const aVal = (a as unknown as Record<string, unknown>)[sortField] ?? ''
    const bVal = (b as unknown as Record<string, unknown>)[sortField] ?? ''
    const cmp = String(aVal).localeCompare(String(bVal))
    return sortAscending ? cmp : -cmp
  })

  const total = filtered.length
  const start = page * pageSize
  return { leads: filtered.slice(start, start + pageSize), total }
}

// ── Call Analytics helpers ───────────────────────────────────────────────────

export function getMockCallAnalytics(_from?: string, _to?: string): CallAnalyticsData {
  let rows = MOCK_CALLS.map(({ transcript, ...rest }) => rest)

  if (_from) rows = rows.filter(c => new Date(c.created_at) >= new Date(_from))
  if (_to) rows = rows.filter(c => new Date(c.created_at) <= new Date(_to))

  const totalCalls = rows.length
  const totalDurationSeconds = rows.reduce((s, c) => s + (c.duration_seconds ?? 0), 0)
  const appointmentsBooked = rows.filter(c => c.appointment_booked).length
  const qualityCalls = rows.filter(c => c.quality_score != null)
  const avgQualityScore = qualityCalls.length
    ? Math.round(qualityCalls.reduce((s, c) => s + (c.quality_score ?? 0), 0) / qualityCalls.length * 10) / 10
    : null
  const successRate = totalCalls ? rows.filter(c => c.outcome === 'successful').length / totalCalls : 0
  const pickupRate = totalCalls ? rows.filter(c => c.picked_up).length / totalCalls : 0
  const volumeByDay = groupCallsByDay(rows)
  const sc: Record<string, number> = {}
  const dc: Record<string, number> = {}
  const oc: Record<string, number> = {}
  for (const c of rows) {
    if (c.sentiment) sc[c.sentiment] = (sc[c.sentiment] ?? 0) + 1
    if (c.disconnected_reason) dc[c.disconnected_reason] = (dc[c.disconnected_reason] ?? 0) + 1
    if (c.outcome) oc[c.outcome] = (oc[c.outcome] ?? 0) + 1
  }
  return {
    calls: rows, volumeByDay, totalCalls, totalDurationSeconds,
    appointmentsBooked, avgQualityScore, successRate, pickupRate,
    sentimentCounts: sc, disconnectCounts: dc, outcomeCounts: oc,
  }
}

// ── Call History helpers ─────────────────────────────────────────────────────

type Tab = 'all' | 'outbound' | 'inbound' | 'failed' | 'callbacks'

export function getMockCallHistory(opts?: {
  tab?: Tab
  search?: string
  filters?: {
    direction?: string
    sentiment?: string[]
    outcome?: string
    appointmentBooked?: string
    disconnectedReason?: string[]
    qualityScore?: { op: string; value: string }
    dateFrom?: string
    dateTo?: string
    callbackOnly?: boolean
  }
  page?: number
  pageSize?: number
  sort?: { field: string; ascending: boolean }
}): { calls: CallHistoryRow[]; total: number } {
  const { tab = 'all', search = '', filters, page = 1, pageSize = 50, sort } = opts ?? {}

  let rows = MOCK_CALL_HISTORY.rows.filter(r => r.tabs.includes(tab)) as unknown as CallHistoryRow[]

  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(r =>
      (r.lead_name?.toLowerCase().includes(q)) ||
      (r.lead_phone?.toLowerCase().includes(q)) ||
      (r.transcript_summary?.toLowerCase().includes(q))
    )
  }

  // Apply filters
  if (filters) {
    if (filters.direction && filters.direction !== 'all') {
      rows = rows.filter(r => r.direction === filters.direction)
    }
    if (filters.sentiment && filters.sentiment.length > 0) {
      rows = rows.filter(r => r.sentiment && filters.sentiment!.includes(r.sentiment))
    }
    if (filters.outcome) {
      rows = rows.filter(r => r.outcome === filters.outcome)
    }
    if (filters.appointmentBooked) {
      const booked = filters.appointmentBooked === 'yes'
      rows = rows.filter(r => r.appointment_booked === booked)
    }
    if (filters.disconnectedReason && filters.disconnectedReason.length > 0) {
      rows = rows.filter(r => r.disconnected_reason && filters.disconnectedReason!.includes(r.disconnected_reason))
    }
    if (filters.qualityScore?.value) {
      const target = parseFloat(filters.qualityScore.value)
      const op = filters.qualityScore.op
      if (!isNaN(target)) {
        rows = rows.filter(r => {
          if (r.quality_score == null) return false
          // Quality score in mock is 0-100, but filter UI uses 1-10 scale
          const score = r.quality_score / 10
          switch (op) {
            case '>=': return score >= target
            case '<=': return score <= target
            case '>': return score > target
            case '<': return score < target
            case '=': return Math.abs(score - target) < 0.05
            default: return true
          }
        })
      }
    }
    if (filters.dateFrom) {
      rows = rows.filter(r => r.created_at >= filters.dateFrom!)
    }
    if (filters.dateTo) {
      rows = rows.filter(r => r.created_at <= filters.dateTo! + 'T23:59:59Z')
    }
    if (filters.callbackOnly) {
      rows = rows.filter(r => (r as unknown as { is_callback?: boolean }).is_callback)
    }
  }

  if (sort) {
    rows = [...rows].sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sort.field] ?? ''
      const bVal = (b as unknown as Record<string, unknown>)[sort.field] ?? ''
      const cmp = String(aVal).localeCompare(String(bVal))
      return sort.ascending ? cmp : -cmp
    })
  }

  const total = rows.length
  const start = (page - 1) * pageSize
  return { calls: rows.slice(start, start + pageSize), total }
}

// ── Conversations helpers ───────────────────────────────────────────────────

export interface MockGHLConversation {
  id: string
  contactId: string
  contactName: string
  email: string | null
  phone: string | null
  lastMessageBody: string | null
  lastMessageDate: string | null
  lastMessageType: string | null
  unreadCount: number
  type: string
  starred?: boolean
}

export interface MockGHLMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  dateAdded: string
  messageType: string
  status?: string
  appointment_id?: string | null
}

export function getMockConversations(opts?: {
  status?: string
  q?: string
}): { conversations: MockGHLConversation[]; hasMore: boolean; total: number } {
  let convs: MockGHLConversation[] = MOCK_CONVERSATIONS.map(c => ({
    id: c.id,
    contactId: c.contact_id,
    contactName: c.contact_name,
    email: c.email,
    phone: c.phone,
    lastMessageBody: c.last_message_body,
    lastMessageDate: c.last_message_date,
    lastMessageType: c.type,
    unreadCount: c.unread_count,
    type: c.type,
    starred: false,
  }))

  if (opts?.status === 'unread') {
    convs = convs.filter(c => c.unreadCount > 0)
  }

  if (opts?.q) {
    const q = opts.q.toLowerCase()
    convs = convs.filter(c =>
      c.contactName.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.lastMessageBody?.toLowerCase().includes(q)
    )
  }

  return { conversations: convs, hasMore: false, total: convs.length }
}

export function getMockMessages(conversationId: string): {
  messages: MockGHLMessage[]
  nextCursor: string | null
  hasMore: boolean
} {
  const msgs = MOCK_MESSAGES
    .filter(m => m.conversation_id === conversationId)
    .map(m => ({
      id: m.id,
      direction: m.direction as 'inbound' | 'outbound',
      body: m.body ?? '',
      dateAdded: m.date_added,
      messageType: m.message_type,
      status: m.status ?? undefined,
      appointment_id: m.appointment_id,
    }))
    .sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime())

  return { messages: msgs, nextCursor: null, hasMore: false }
}

// ── Calendar helpers ────────────────────────────────────────────────────────

export function getMockAppointments(opts?: {
  weekStart?: Date
  weekEnd?: Date
}): Appointment[] {
  if (!opts?.weekStart || !opts?.weekEnd) return MOCK_APPOINTMENTS.filter(a => !a.deleted_at)

  return MOCK_APPOINTMENTS.filter(a => {
    if (a.deleted_at) return false
    const t = new Date(a.start_time).getTime()
    return t >= opts.weekStart!.getTime() && t <= opts.weekEnd!.getTime()
  })
}

export function getMockLeadsByContactIds(contactIds: string[]): Record<string, Lead> {
  const map: Record<string, Lead> = {}
  for (const lead of MOCK_LEADS) {
    if (lead.ghl_contact_id && contactIds.includes(lead.ghl_contact_id)) {
      map[lead.ghl_contact_id] = lead
    }
  }
  return map
}
