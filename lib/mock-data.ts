/**
 * Mock data helpers for the deploy/SIT branch.
 * Returns static data from mock-data.json instead of hitting Supabase/GHL APIs.
 */
import mockJson from './mock-data.json'
import type { Lead, Call, Appointment, CallAnalyticsData, CallReview } from '@/lib/types'
import type { CallHistoryRow, QualityReviewRow, QualityKpis, FollowUpKpis } from '@/app/actions'
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
          switch (op) {
            case '>=': return r.quality_score >= target
            case '<=': return r.quality_score <= target
            case '>': return r.quality_score > target
            case '<': return r.quality_score < target
            case '=': return Math.abs(r.quality_score - target) < 0.05
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

// ── Mock Call Reviews ──────────────────────────────────────────────────────

const AGENT_MISTAKES = [
  'Did not ask about dance experience',
  'Interrupted the caller',
  'Failed to offer alternative time slots',
  'Did not confirm contact details',
  'Missed upsell opportunity',
  'Too aggressive with booking push',
  'Did not address pricing concerns',
  'Forgot to mention trial class offer',
]

const FOLLOW_UP_REASONS = [
  'Caller interested but needs to check schedule',
  'Requested more info about pricing',
  'Wants to bring partner next time',
  'Asked about group classes availability',
  'Needs to discuss with spouse',
  'Interested in wedding package details',
]

const TOPICS = [
  'Trial lesson', 'Pricing', 'Schedule', 'Dance styles',
  'Wedding prep', 'Group classes', 'Private lessons', 'Competition',
]

const SUMMARIES = [
  'Caller inquired about beginner classes and was offered a trial lesson. Seemed interested but wanted to check their schedule first.',
  'Lead called back about pricing for couples packages. Agent provided details and attempted to book a consultation.',
  'Inbound call from a wedding couple looking for dance lessons. Successfully booked their first session.',
  'Follow-up call to discuss group class options. Caller was enthusiastic but needed to confirm dates.',
  'Lead expressed interest in competitive dance training. Agent explained the program structure.',
  'Cold call to a web inquiry. Reached voicemail, left a detailed message about current promotions.',
  'Callback from a lead who missed the initial outbound call. Discussed bronze-level program options.',
  'Caller asked about kids classes. Agent redirected to adult programs as studio doesn\'t offer kids classes.',
]

function generateMockReviews(): QualityReviewRow[] {
  const calls = MOCK_CALLS
  const reviews: QualityReviewRow[] = []

  // Generate reviews for ~70% of calls
  for (let i = 0; i < calls.length; i++) {
    if (i % 10 >= 7) continue // skip ~30%
    const call = calls[i]
    const grade: 'Pass' | 'Fail' = Math.random() > 0.25 ? 'Pass' : 'Fail'
    const mistakeCount = grade === 'Fail' ? Math.floor(Math.random() * 3) + 1 : Math.random() > 0.6 ? 1 : 0
    const mistakes: string[] = []
    for (let m = 0; m < mistakeCount; m++) {
      const pick = AGENT_MISTAKES[Math.floor(Math.random() * AGENT_MISTAKES.length)]
      if (!mistakes.includes(pick)) mistakes.push(pick)
    }

    const followUp = Math.random() > 0.65
    const callbackReq = Math.random() > 0.8
    const topicCount = Math.floor(Math.random() * 3) + 1
    const topics: string[] = []
    for (let t = 0; t < topicCount; t++) {
      const pick = TOPICS[Math.floor(Math.random() * TOPICS.length)]
      if (!topics.includes(pick)) topics.push(pick)
    }

    const lead = call.lead_id ? MOCK_LEADS.find(l => l.id === call.lead_id) : null

    reviews.push({
      review_id: `review-${call.id}`,
      call_id: call.id,
      grade,
      summary: SUMMARIES[i % SUMMARIES.length],
      agent_mistakes: mistakes,
      user_repeats: Math.floor(Math.random() * 4),
      booking_attempted: call.appointment_booked != null ? true : Math.random() > 0.5,
      booking_successful: call.appointment_booked ?? (Math.random() > 0.6),
      follow_up_needed: followUp,
      follow_up_reason: followUp ? FOLLOW_UP_REASONS[Math.floor(Math.random() * FOLLOW_UP_REASONS.length)] : null,
      callback_requested: callbackReq,
      topics_discussed: topics,
      trigger_type: Math.random() > 0.3 ? 'cron' : 'manual',
      review_created_at: call.created_at,
      // call fields
      call_created_at: call.created_at,
      duration_seconds: call.duration_seconds,
      direction: call.direction,
      sentiment: call.sentiment,
      outcome: call.outcome,
      quality_score: call.quality_score,
      appointment_booked: call.appointment_booked,
      recording_url: call.recording_url,
      lead_id: call.lead_id,
      retell_call_id: call.retell_call_id,
      picked_up: call.picked_up ?? null,
      transferred: call.transferred ?? null,
      disconnected_reason: call.disconnected_reason,
      transcript_summary: call.transcript_summary,
      lead_name: lead?.name ?? null,
    })
  }

  return reviews
}

const MOCK_REVIEWS = generateMockReviews()

function getCallResult(row: { disconnected_reason: string | null; picked_up: boolean | null; transferred: boolean | null; appointment_booked: boolean | null }): string | null {
  if (row.disconnected_reason === 'voicemail') return 'Voicemail'
  if (row.disconnected_reason === 'dial_no_answer') return 'No Answer'
  if (row.disconnected_reason === 'dial_busy') return 'Busy'
  if (row.transferred) return 'Transferred'
  if (row.appointment_booked) return 'Booked'
  if (row.disconnected_reason === 'user_hangup') return 'Hung Up'
  if (row.picked_up === true) return 'Completed'
  return null
}

export function getMockQualityReviews(opts?: {
  filters?: {
    grade?: string
    direction?: string
    sentiment?: string[]
    result?: string[]
    qualityScore?: { op: string; value: string }
    dateFrom?: string
    dateTo?: string
    followUpNeeded?: boolean
    callbackRequested?: boolean
  }
  page?: number
  pageSize?: number
  sort?: { field: string; ascending: boolean }
}): { rows: QualityReviewRow[]; total: number } {
  const { filters, page = 1, pageSize = 50, sort } = opts ?? {}
  let rows = [...MOCK_REVIEWS]

  if (filters) {
    if (filters.grade) rows = rows.filter(r => r.grade === filters.grade)
    if (filters.direction) rows = rows.filter(r => r.direction === filters.direction)
    if (filters.sentiment && filters.sentiment.length > 0) {
      rows = rows.filter(r => r.sentiment && filters.sentiment!.includes(r.sentiment))
    }
    if (filters.result && filters.result.length > 0) {
      rows = rows.filter(r => {
        const result = getCallResult(r)
        return result && filters.result!.includes(result)
      })
    }
    if (filters.qualityScore?.value) {
      const target = parseFloat(filters.qualityScore.value)
      const op = filters.qualityScore.op
      if (!isNaN(target)) {
        rows = rows.filter(r => {
          if (r.quality_score == null) return false
          switch (op) {
            case '>=': return r.quality_score >= target
            case '<=': return r.quality_score <= target
            case '>': return r.quality_score > target
            case '<': return r.quality_score < target
            case '=': return Math.abs(r.quality_score - target) < 0.05
            default: return true
          }
        })
      }
    }
    if (filters.dateFrom) rows = rows.filter(r => r.call_created_at >= filters.dateFrom!)
    if (filters.dateTo) rows = rows.filter(r => r.call_created_at <= filters.dateTo! + 'T23:59:59Z')
    if (filters.followUpNeeded) rows = rows.filter(r => r.follow_up_needed)
    if (filters.callbackRequested) rows = rows.filter(r => r.callback_requested)
  }

  if (sort) {
    rows.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sort.field] ?? ''
      const bVal = (b as unknown as Record<string, unknown>)[sort.field] ?? ''
      const cmp = String(aVal).localeCompare(String(bVal))
      return sort.ascending ? cmp : -cmp
    })
  }

  const total = rows.length
  const start = (page - 1) * pageSize
  return { rows: rows.slice(start, start + pageSize), total }
}

export function getMockQualityKpis(): QualityKpis {
  const reviews = MOCK_REVIEWS
  const totalReviewed = reviews.length
  const totalEligible = MOCK_CALLS.length
  const passCount = reviews.filter(r => r.grade === 'Pass').length
  const failCount = reviews.filter(r => r.grade === 'Fail').length
  const avgUserRepeats = totalReviewed > 0
    ? Math.round((reviews.reduce((s, r) => s + r.user_repeats, 0) / totalReviewed) * 10) / 10
    : 0
  const followUpNeededCount = reviews.filter(r => r.follow_up_needed).length
  const bookingAttempted = reviews.filter(r => r.booking_attempted).length
  const bookingSuccessful = reviews.filter(r => r.booking_successful).length

  // Count mistakes
  const mistakeMap: Record<string, number> = {}
  for (const r of reviews) {
    for (const m of r.agent_mistakes) {
      mistakeMap[m] = (mistakeMap[m] ?? 0) + 1
    }
  }
  const topAgentMistakes = Object.entries(mistakeMap)
    .map(([mistake, count]) => ({ mistake, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // Count topics
  const topicMap: Record<string, number> = {}
  for (const r of reviews) {
    for (const t of r.topics_discussed) {
      topicMap[t] = (topicMap[t] ?? 0) + 1
    }
  }
  const topTopics = Object.entries(topicMap)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    totalReviewed, totalEligible, passCount, failCount,
    avgUserRepeats, followUpNeededCount, bookingAttempted, bookingSuccessful,
    topAgentMistakes, topTopics,
  }
}

export function getMockFollowUpKpis(): FollowUpKpis {
  const reviews = MOCK_REVIEWS
  const followUpCount = reviews.filter(r => r.follow_up_needed).length
  const callbackCount = reviews.filter(r => r.callback_requested).length
  const followUpRows = reviews.filter(r => r.follow_up_needed || r.callback_requested)
  const passRate = followUpRows.length > 0
    ? Math.round((followUpRows.filter(r => r.grade === 'Pass').length / followUpRows.length) * 100)
    : 0
  return { followUpCount, callbackCount, passRate }
}

export function getMockCallReviewFull(callId: string): CallReview | null {
  const review = MOCK_REVIEWS.find(r => r.call_id === callId)
  if (!review) return null
  return {
    id: review.review_id,
    call_id: review.call_id,
    studio_id: 'mock-studio-1',
    grade: review.grade,
    summary: review.summary,
    agent_mistakes: review.agent_mistakes,
    user_repeats: review.user_repeats,
    booking_attempted: review.booking_attempted,
    booking_successful: review.booking_successful,
    objections: [],
    callback_requested: review.callback_requested,
    follow_up_needed: review.follow_up_needed,
    follow_up_reason: review.follow_up_reason,
    topics_discussed: review.topics_discussed,
    raw_ai_response: null,
    model_used: 'mock',
    trigger_type: review.trigger_type,
    created_at: review.review_created_at,
    updated_at: review.review_created_at,
  }
}
