# AMLS Web App — Implementation Plan

> **Client:** Arthur Murray Lincolnshire (AMLS) via Myrrh (AI Automation Agency)
> **Purpose:** Replace Notion + GHL browsing with a single unified web app for dance studio owners — lead management, call analytics,  conversations (unibox), and calendar.
> **Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase (Auth, PostgreSQL, RLS, Realtime)
> **Hosting:** Vercel
> **Brand:** `#2383E2` accent blue · Inter font · Clean, modern UI (Apple/Stripe/Linear-inspired)

> **Last updated:** 2026-05-08
> **Status:** All three phases complete and live.

---

## Roles

| Role | Access |
|---|---|
| **Super Admin** | Developers / Agency. Full access to all studios, all data. Bypasses RLS. Can create studios, create accounts, assign studios. |
| **Studio Owner** | Inherits all Studio Staff access, plus: sees only their assigned studios, can invite staff, manage studio settings. Settings: Business Profile + My Profile + My Staff + Studios. |
| **Studio Staff** | Can view and edit leads, view call analytics and calendar (read-only), use the unibox. Settings: My Profile only. Cannot access Business Profile, My Staff, or any studio-level settings. |

---

## Pages

| Page | Phase | Status | Description |
|---|---|---|---|
| Leads | 1 | ✅ Live | Notion-style table with all fields, inline editing, views, filters, sort |
| Settings | 1 | ✅ Live | Business Profile, My Profile, My Staff, Studios, Appearance, Activity Log |
| Call Analytics | 2 | ✅ Live | KPI cards + charts + transcript viewer with filters |
| Calendar | 2 | ✅ Live | Week view + appointment list view with filters, create/reschedule/delete |
| Conversations | 3 | ✅ Live | SMS + Email unibox with real-time, inline reply, lead side panel |

---

## Phase 1 — Foundation & Leads · $300

### Status: ✅ Complete

### What was built
- Next.js 14 App Router project with TypeScript + Tailwind CSS v4
- Supabase Auth (email/password), session management via SSR cookies
- 3 roles: `super_admin`, `studio_owner`, `studio_staff` with RLS on all tables
- Left sidebar with studio switcher, collapsible nav, progress bar on route change
- Leads page — Notion-style table: all fields, colored status badges, inline editing, checkboxes, column resizing, pagination (20/50/100), multi-select bulk actions (delete, bulk field update), per-user column width persistence
- Filter bar: multi-select dropdowns for Status, Level, Action, Source, Reason; sort by any field asc/desc
- Saved views (custom column sets per studio)
- GHL new-contact webhook (`POST /api/webhooks/ghl-contact`)
- Notion import script (one-time, CSV)
- Settings page: Business Profile, My Profile (avatar upload, password change), My Staff (invite/remove), Studios (super admin only), Appearance (theme), Activity Log
- Lead detail page (`/leads/[id]`) with full profile, activity log, and inline email reply
- Realtime: Supabase `postgres_changes` on `leads` — new/updated/deleted rows push to browser instantly with toast notifications
- Filter + sort preferences saved per user to Supabase `user_preferences.page_filters`

---

## Phase 2 — Call Analytics & Calendar · $300

### Status: ✅ Complete

### What was built
- Retell post-call webhook (`POST /api/webhooks/retell-call`) — stores full call data in `calls` table
- Call Analytics page:
  - KPI cards: Total Calls, Avg Duration, Pickup Rate, Success Rate, Appointments Booked, Avg Quality Score
  - Charts: Call Volume (line), Disconnect Reason (donut), Outcome (donut), Sentiment (donut)
  - Global date range filter (presets + custom dual-month picker)
  - Transcripts tab: searchable call list with full transcript viewer, quality score, sentiment badge, recording playback
  - Filter bar (multi-select): Direction, Sentiment, Outcome, Appointment Booked, Disconnect Reason, Quality Score
  - Analytics direction + date preset persisted to `user_preferences.analytics`
  - Transcript filters persisted to `user_preferences.page_filters`
- Calendar page:
  - Week view: appointment blocks in a 7-day grid, live Supabase Realtime updates
  - List view: sortable/filterable appointment table with search, status filter (multi-select), date range filter
  - Create appointment modal (slot-constrained scheduling)
  - Reschedule (drag/edit), delete with GHL sync
  - Lead side panel — shows linked lead profile for the appointment's contact
  - Calendar settings: business hours, appointment duration, advance booking window, per-day time slots
  - Appointment list filters persisted to `user_preferences.page_filters`

---

## Phase 3 — Conversations (Unibox) · $300

### Status: ✅ Complete

### What was built
- GHL Conversations webhook (`POST /api/webhooks/ghl-message`) — inbound messages saved to Supabase
- Conversations list + thread UI: SMS + Email, chronological, channel badge per message
- Compose bar: send SMS or Email via GHL Conversations API (`POST /api/conversations/send`)
- Inline email reply compose (expands in-thread)
- Lead side panel — shows linked lead profile for the conversation's contact
- Outbound call button (via GHL)
- Appointment activity chips in thread (linked appointment details)
- Realtime: Supabase subscription on `messages` and `conversations` — new messages appear instantly
- Search + filter conversations by contact name/phone

---

## Database Schema (Current — as of 2026-05-08)

### `studios`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | Display name |
| location | text | Legacy — kept for compat |
| street_address | text | |
| city | text | |
| postal_code | text | |
| state | text | |
| country | text | |
| logo_url | text nullable | |
| ghl_account_id | text | GHL sub-account / location ID |
| ghl_calendar_id | text nullable | GHL calendar ID |
| retell_agent_id | text | |
| retell_api_key | text nullable | |
| calendar_start_hour | integer | Business hours start (0–23) |
| calendar_end_hour | integer | Business hours end (1–24) |
| appointment_duration_minutes | integer | Default appointment length |
| appointment_min_advance_weeks | integer | Min weeks ahead for booking |
| appointment_slots | jsonb | `Record<dayOfWeek, "HH:MM"[]>` — available slots per day |
| created_at | timestamptz | |
| deleted_at | timestamptz nullable | Soft delete |

### `studio_users`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| studio_id | uuid FK → studios | |
| user_id | uuid FK → auth.users | |
| role | text | 'super_admin' \| 'studio_owner' \| 'studio_staff' |
| avatar_url | text nullable | |
| created_at | timestamptz | |

### `user_preferences`

Stores per-user per-studio preferences. Unique on `(user_id, studio_id)`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| studio_id | uuid FK → studios | |
| col_widths | jsonb | `Record<string, number>` — leads table column widths |
| active_view_id | text | Last active lead view ID |
| theme | text | 'light' \| 'dark' |
| nav_collapsed | boolean | Sidebar collapsed state |
| notify_lead_created | boolean | Toast on new lead |
| notify_lead_updated | boolean | Toast on lead update |
| notify_lead_deleted | boolean | Toast on lead delete |
| analytics | jsonb | `{ direction: string, preset: string }` — call analytics filters |
| page_filters | jsonb | See structure below |
| updated_at | timestamptz | |

**`page_filters` structure:**
```json
{
  "leads": {
    "filters": { "status": [], "level": [], "action": [], "source": [], "reason": [] },
    "sort": { "field": "created_at", "ascending": false }
  },
  "transcripts": {
    "direction": "all", "sentiment": [], "outcome": "",
    "appointmentBooked": "", "disconnectedReason": [],
    "qualityScore": { "op": ">=", "value": "" }
  },
  "appointmentList": {
    "statusFilters": [], "dateFrom": "", "dateTo": "",
    "sortField": "start_time", "sortAscending": true
  }
}
```

### `leads`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| studio_id | uuid FK → studios | |
| created_at | timestamptz | Notion "Created Time" |
| name | text | Lead full name |
| status | text nullable | See enum values below |
| level | text nullable | See enum values below |
| action | text nullable | See enum values below |
| phone | text nullable | |
| email | text nullable | |
| last_contacted | timestamptz nullable | |
| first_lesson | timestamptz nullable | |
| comments | text nullable | Free text |
| source | text nullable | See enum values below |
| tick | boolean | ✅ field |
| reason | text nullable | See enum values below |
| available | text nullable | Free text |
| showed | boolean | ✅ Showed |
| bought | boolean | ✅ Bought |
| partnership | text nullable | 'Couple' \| 'Single' |
| old | boolean | ✅ OLD |
| ghl_contact_id | text nullable | For deduplication with GHL |
| created_by_email | text nullable | Email of user who created the lead |

**Enum options are stored in `studio_field_options` — not hardcoded.** Studios can add/rename/reorder options. The defaults are seeded on studio creation.

### `studio_field_options`

Stores per-studio enum options for lead fields. Supports custom options, colors, and sort order.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| studio_id | uuid FK → studios | |
| field | text | 'status' \| 'level' \| 'action' \| 'source' \| 'reason' \| 'partnership' |
| value | text | Display value (e.g. "Active") |
| bg | text nullable | Notion-style background color class |
| text | text nullable | Notion-style text color class |
| sort_order | integer nullable | Custom ordering |

### `lead_views`

Custom column-set views, per studio.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| studio_id | uuid FK → studios | |
| name | text | View label |
| columns | text[] | Ordered list of column keys |
| created_by | uuid FK → auth.users | |
| created_at | timestamptz | |

### `activity_logs`

Lead activity log entries.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| studio_id | uuid FK → studios | |
| lead_name | text | Name of affected lead |
| actor_email | text nullable | Email of user who acted |
| event_type | text | 'create' \| 'update' \| 'delete' |
| created_at | timestamptz | |

### `calls`

Retell AI call records, written by the post-call webhook.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| studio_id | uuid FK → studios | |
| retell_call_id | text unique | |
| created_at | timestamptz | |
| duration_seconds | integer nullable | |
| sentiment | text nullable | 'positive' \| 'neutral' \| 'negative' \| 'unknown' |
| outcome | text nullable | 'successful' \| 'unsuccessful' |
| disconnected_reason | text nullable | 'agent_hangup' \| 'user_hangup' \| 'voicemail' \| 'dial_no_answer' \| 'dial_busy' \| 'call_transfer' |
| picked_up | boolean nullable | |
| transferred | boolean nullable | |
| voicemail | boolean nullable | |
| direction | text nullable | 'inbound' \| 'outbound' |
| transcript | text nullable | Full raw transcript |
| transcript_summary | text nullable | AI-generated summary |
| quality_score | numeric nullable | 0–10 Retell quality score |
| appointment_booked | boolean nullable | |
| recording_url | text nullable | |
| lead_id | uuid FK → leads nullable | Linked if contact matched |

### `appointments`

Written by GHL appointment webhook. Primary key is the GHL appointment ID.

| Column | Type | Notes |
|---|---|---|
| id | text PK | GHL appointment ID |
| studio_id | uuid FK → studios | |
| title | text nullable | |
| start_time | timestamptz | |
| end_time | timestamptz | |
| status | text nullable | 'confirmed' \| 'showed' \| 'noshow' \| 'cancelled' \| 'invalid' \| 'deleted' |
| calendar_id | text nullable | GHL calendar ID |
| calendar_name | text nullable | |
| contact_id | text nullable | GHL contact ID |
| contact_name | text nullable | |
| assigned_user_id | text nullable | GHL user ID |
| assigned_user_name | text nullable | |
| notes | text nullable | |
| address | text nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz nullable | Soft delete |
| appointment_id | text nullable | Alternative GHL reference |

### `conversations`

GHL conversation threads, upserted by the GHL message webhook.

| Column | Type | Notes |
|---|---|---|
| id | text PK | GHL conversation ID |
| studio_id | uuid FK → studios | |
| contact_id | text nullable | GHL contact ID |
| contact_name | text nullable | |
| email | text nullable | |
| phone | text nullable | |
| last_message_body | text nullable | Preview text |
| last_message_date | timestamptz nullable | |
| type | text nullable | 'SMS' \| 'Email' etc. |
| unread_count | integer | Incremented for inbound messages |
| updated_at | timestamptz | |

### `messages`

Individual messages within conversations.

| Column | Type | Notes |
|---|---|---|
| id | text PK | GHL message ID |
| conversation_id | text FK → conversations | |
| studio_id | uuid FK → studios | |
| direction | text | 'inbound' \| 'outbound' |
| body | text nullable | Message content |
| date_added | timestamptz nullable | |
| message_type | text nullable | 'SMS' \| 'Email' |
| status | text nullable | Delivery status or appointment verb |
| appointment_id | text nullable | Linked appointment if messageType is appointment |

### `appointment_events`

Tracks appointment verb events (Created/Updated/Rescheduled/Deleted). Written by server actions (`rescheduleAppointment`, `deleteAppointment`, `updateAppointmentDetails`) and the GHL appointment webhook. The conversations page subscribes via Supabase Realtime to update appointment chips in message threads in real-time.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| studio_id | uuid FK → studios | Realtime filter key |
| appointment_id | text | GHL appointment ID |
| contact_id | text nullable | GHL contact ID |
| verb | text | 'Created' \| 'Updated' \| 'Rescheduled' \| 'Deleted' |
| new_start_time | timestamptz nullable | New time for Updated/Rescheduled events |
| created_at | timestamptz | |

RLS: studio members can SELECT; service role can INSERT.
Realtime: enabled via `supabase_realtime` publication.

---

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/webhooks/ghl-contact` | POST | GHL new/updated contact → upserts lead |
| `/api/webhooks/ghl-message` | POST | GHL inbound message → upserts conversation + message |
| `/api/webhooks/ghl-appointment` | POST | GHL appointment create/update/delete → upserts appointment |
| `/api/webhooks/retell-call` | POST | Retell post-call → inserts call record |
| `/api/conversations` | GET | Lists conversations for a studio (paginated, searchable) |
| `/api/conversations/[id]/messages` | GET | Lists messages for a conversation (enriched with appointment status) |
| `/api/conversations/outbound-call` | POST | Initiates outbound call via GHL |
| `/api/conversations/messages/email/[emailId]` | GET | Fetches full email body |
| `/api/conversations/messages/[msgId]/recording` | GET | Proxies Retell recording audio |
| `/api/staff/invite` | POST | Sends staff invite email |
| `/api/staff/remove` | POST | Removes staff member |
| `/api/admin/backfill-lead-links` | POST | One-time admin: links calls to leads by contact ID |

---

## Server Actions (`app/actions.ts`)

Key server actions (called from client components via `'use server'`):

- `fetchLeadsPage` — paginated, filtered, sorted leads query
- `fetchLeadById` — single lead with activity log
- `updateLead` / `bulkUpdateLeads` / `deleteLeads` — mutations with GHL sync
- `createLeadView` / `updateLeadView` / `deleteLeadView` — view management
- `addStudioFieldOption` / `renameStudioFieldOption` / `deleteStudioFieldOption` / `updateStudioFieldOptionColor` / `updateStudioFieldOptionOrder` — field option management
- `fetchCallsAnalytics` — aggregated call analytics for a date range
- `getCalendarAppointments` — week appointments from Supabase
- `fetchAppointmentList` — paginated, filtered appointment list
- `rescheduleAppointment` / `deleteAppointment` / `updateAppointmentDetails` / `createAppointment` — appointment mutations with GHL sync
- `getUserPreferences` / `saveUserPreferences` — col widths, theme, view, notifications
- `getPageFilters` / `savePageFilters` — filter/sort state per page
- `getAnalyticsPreferences` / `saveAnalyticsPreferences` — analytics date range + direction
- `logLeadActivity` — writes to activity_logs

---

## Security

- **RLS on all tables** — enforced at DB level, not application level
- **No secrets in frontend** — all GHL/Retell API calls in Next.js API routes only
- **Webhook secrets** — `GHL_WEBHOOK_SECRET` and `RETELL_WEBHOOK_SECRET` validated on every inbound webhook
- **Rate limits** — `lib/rate-limit.ts`: login 10/15min, send message 100/hr, general 100/min

---

## Environment Variables

| Variable | Where used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only (bypasses RLS for super_admin + webhooks) |
| `GHL_API_KEY` | Server only |
| `GHL_WEBHOOK_SECRET` | Server only |
| `RETELL_WEBHOOK_SECRET` | Server only |

---

## Key Libraries

| Library | Purpose |
|---|---|
| `@supabase/ssr` | Supabase SSR client (cookies-based session) |
| `@supabase/supabase-js` | Supabase browser client |
| `next-themes` | Dark/light mode via `.dark` class on `<html>` |
| `lucide-react` | Icons throughout |
| `tailwindcss` v4 | Utility CSS (zero-config, `@tailwindcss/postcss`) |
