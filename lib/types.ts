export type Role = 'super_admin' | 'studio_owner' | 'studio_staff'

export interface StudioSlotConfig {
  appointment_duration_minutes: number
  appointment_min_advance_weeks: number
  appointment_slots: Record<string, string[]> // day-of-week string ("0"–"6") → "HH:MM"[]
}

export interface Studio {
  id: string
  name: string
  location: string // legacy — kept for backward compat, use address fields below
  street_address: string
  city: string
  postal_code: string
  state: string
  country: string
  logo_url: string | null
  ghl_account_id: string
  ghl_calendar_id: string | null
  ghl_api_key: string | null
  retell_agent_id: string
  retell_api_key: string | null
  retell_inbound_agent_id: string | null
  retell_phone_number: string | null
  voice_agent_enabled: boolean
  voice_agent_paused_at: string | null
  voice_agent_paused_by: string | null
  active_outbound_agent_id: string | null
  calendar_start_hour: number
  calendar_end_hour: number
  appointment_duration_minutes: number
  appointment_min_advance_weeks: number
  appointment_slots: Record<string, string[]>
  timezone: string
  // Outbound call window — day-of-week ("0"=Sun.."6"=Sat) -> window or null (closed).
  // Wall-clock in `timezone`. null/{} = no restriction (24/7). Gates outbound
  // dialing only; inbound is answered by Retell regardless. See lib/call-hours.ts.
  call_hours: import('./call-hours').CallHours | null
  review_enabled: boolean
  // Per-studio sidebar tab visibility overrides (nav href -> boolean).
  // Missing key = tab default. Super-admin managed. See lib/nav.ts.
  nav_overrides: Record<string, boolean>
  created_at: string
}

// Payload for a single studio location submitted by the client-onboarding wizard.
export interface OnboardingStudioInput {
  name: string
  street_address: string
  city: string
  state: string
  postal_code: string
  country: string
  ghl_account_id: string
  ghl_calendar_id: string
  ghl_api_key: string
  retell_agent_id: string
  retell_inbound_agent_id: string
  retell_api_key: string
  retell_phone_number: string
  sources: import('./source-kinds').SourceDetail[]
  timezone: string
  calendar_start_hour: number
  calendar_end_hour: number
  appointment_duration_minutes: number
  appointment_min_advance_weeks: number
  appointment_slots: Record<string, string[]>
}

export interface StudioUser {
  id: string
  studio_id: string
  user_id: string
  role: Role
  created_at: string
  avatar_url: string | null
}

export interface Lead {
  id: string
  studio_id: string
  created_at: string
  name: string
  status: string | null
  level: string | null
  action: string | null
  phone: string | null
  email: string | null
  last_contacted: string | null
  first_lesson: string | null
  comments: string | null
  notes: string | null
  source: string | null
  reason: string | null
  available: string | null
  showed: boolean
  bought: boolean
  partnership: string | null
  old: boolean
  ghl_contact_id: string | null
  created_by_email: string | null
}

// ── Call Analytics types ───────────────────────────────────────────────────────

export type CallSentiment = 'positive' | 'neutral' | 'negative' | 'unknown'
export type CallOutcome = 'successful' | 'unsuccessful'
export type CallDisconnectedReason =
  | 'agent_hangup'
  | 'user_hangup'
  | 'voicemail'
  | 'voicemail_reached'
  | 'dial_no_answer'
  | 'dial_busy'
  | 'call_transfer'
  | 'ivr_reached'
  | 'inactivity'

export interface Call {
  id: string
  studio_id: string
  retell_call_id: string
  created_at: string
  duration_seconds: number | null
  sentiment: CallSentiment | null
  outcome: CallOutcome | null
  disconnected_reason: CallDisconnectedReason | null
  picked_up: boolean | null
  transferred: boolean | null
  voicemail: boolean | null
  direction: 'inbound' | 'outbound' | null
  transcript_summary: string | null
  transcript: string | null
  lead_id: string | null
  quality_score: number | null
  appointment_booked: boolean | null
  recording_url: string | null
  caller_phone: string | null
  called_phone: string | null
}

// ── Scheduled Calls (queue of future outbound AI calls) ──────────────────────
//
// Backed by the `scheduled_calls` table (migration 053). Replaced the per-studio
// n8n data tables, which carried no studio_id and forced the app to guess tenant
// ownership by phone-matching against `leads`.

export interface ScheduledCall {
  id: string
  studio_id: string
  lead_id: string | null      // null when the callee isn't a lead yet
  first_name: string | null
  last_name: string | null
  phone_number: string        // E.164, normalised by the writer
  email: string | null
  dance_interest: string | null
  reason: string | null       // lead's dance reason: Wedding / For Fun / ...
  call_note: string | null    // free-text "why are we calling"
  callback_time: string       // ISO timestamp (timestamptz)
  called_at: string | null
  retell_call_id: string | null
  source: 'ai_agent' | 'manual'
  created_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  // Set by the migration-054 trigger when a studio's voice agent is switched back
  // on: resuming abandons the whole queued backlog rather than deferring it.
  skipped_at: string | null
  skip_reason: string | null
  created_at: string
  updated_at: string
}

/**
 * A `scheduled_calls` row still eligible to be dialled — not called, not cancelled
 * by staff, and not abandoned by a voice-agent resume. All three must be null; the
 * dialer's WHERE clause and `idx_scheduled_calls_due` agree on exactly this.
 */
export type PendingScheduledCall = ScheduledCall & {
  called_at: null
  cancelled_at: null
  skipped_at: null
}

export interface CallReview {
  id: string
  call_id: string
  studio_id: string
  grade: 'Pass' | 'Fail'
  summary: string | null
  agent_mistakes: string[]
  user_repeats: number
  booking_attempted: boolean | null
  booking_successful: boolean | null
  objections: string[]
  callback_requested: boolean
  follow_up_needed: boolean
  follow_up_reason: string | null
  topics_discussed: string[]
  raw_ai_response: Record<string, unknown> | null
  model_used: string
  trigger_type: 'manual' | 'cron' | 'realtime'
  created_at: string
  updated_at: string
}

export interface RetellCallEndedPayload {
  event: string
  call_id: string
  agent_id: string
  start_timestamp: number   // Unix ms
  end_timestamp: number     // Unix ms
  direction: 'inbound' | 'outbound'
  disconnection_reason: string
  transcript: string | null
  metadata?: { lead_id?: string; studio_id?: string }
  call_analysis?: {
    call_successful: boolean | null
    call_summary: string | null
    user_sentiment: 'Positive' | 'Neutral' | 'Negative' | 'Unknown' | null
  }
}

export interface CallVolumePoint { date: string; count: number }

export interface CallAnalyticsData {
  calls: Omit<Call, 'transcript'>[]
  volumeByDay: CallVolumePoint[]
  totalCalls: number
  totalDurationSeconds: number
  appointmentsBooked: number
  avgQualityScore: number | null
  successRate: number    // 0–1
  pickupRate: number     // 0–1
  sentimentCounts: Record<string, number>
  disconnectCounts: Record<string, number>
  outcomeCounts: Record<string, number>
}

export type DatePreset = 'today' | '7d' | '4w' | '3m' | 'week-to-date' | 'month-to-date' | 'year-to-date' | 'all' | 'custom'
export interface DateRange { from: Date; to: Date; preset: DatePreset }

// ── GHL webhook payload ────────────────────────────────────────────────────────

// The shape of a GHL contact webhook payload (partial — only fields we use)
export interface GHLContactWebhookPayload {
  type: string
  locationId: string
  contact: {
    id: string
    firstName?: string
    lastName?: string
    phone?: string
    email?: string
    tags?: string[]
    source?: string
  }
}

// Appointment row from Supabase (populated by GHL webhook)
export interface Appointment {
  id: string
  studio_id: string
  title: string | null
  start_time: string
  end_time: string
  status: string | null
  calendar_id: string | null
  calendar_name: string | null
  contact_id: string | null
  contact_name: string | null
  assigned_user_id: string | null
  assigned_user_name: string | null
  notes: string | null
  address: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
  appointment_id?: string
}

// 'ai_escalation' is written by the notify_ai_escalation RPC (migration 059/060)
// when the voice agent cannot hand a caller to a human — the transfer rang out,
// hit voicemail, or the caller was escalated on a question it could not answer.
export type NotificationType = 'appointment_booked' | 'ai_escalation'

export interface Notification {
  id: string
  studio_id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  metadata: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}
