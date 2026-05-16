# AMLS WebApp — Codebase Deep Dive

> **Generated:** 2026-05-15
> **Branch:** staging
> **Status:** All three phases complete. Migrating deployment from Vercel to Netlify.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Folder Structure](#folder-structure)
- [Pages & Routes](#pages--routes)
- [Component Hierarchy](#component-hierarchy)
- [API Routes](#api-routes)
- [Server Actions](#server-actions)
- [Database Schema](#database-schema)
- [RLS Policies](#rls-policies)
- [Migration History](#migration-history)
- [Roles & Permissions](#roles--permissions)
- [Authentication & Session Handling](#authentication--session-handling)
- [Real-Time Subscriptions](#real-time-subscriptions)
- [State Management](#state-management)
- [External Integrations](#external-integrations)
- [Rate Limiting](#rate-limiting)
- [Security Architecture](#security-architecture)
- [Design System](#design-system)
- [Dark Mode](#dark-mode)
- [MCP & Automation](#mcp--automation)
- [Dependencies](#dependencies)
- [Configuration Files](#configuration-files)
- [Git History & Branches](#git-history--branches)
- [Known Limitations](#known-limitations)

---

## Project Overview

**AMLS WebApp ("Cadence")** is a unified web app for Arthur Murray Lincolnshire dance studio, built by **Lunastra AI** for **Myrrh** (AI Automation Agency).

It replaces Notion (lead management) and eliminates context-switching between GoHighLevel (GHL) and Retell AI.

**The app provides:**
- A Notion-style leads table with inline editing, views, filters, and real-time updates
- A call analytics dashboard (KPI cards, charts, transcript viewer) from Retell AI data
- A messaging unibox (SMS + Email via GHL Conversations API) with real-time delivery
- A calendar (week view + list view) with create/reschedule/delete synced to GHL

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + Backend | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 (zero-config, `@tailwindcss/postcss`) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password, SSR cookies) |
| Realtime | Supabase Realtime (`postgres_changes`) |
| Hosting | Netlify (via `@netlify/plugin-nextjs`) |
| Rate Limiting | Upstash Redis (`@upstash/ratelimit`) |
| Charts | Recharts 3.8 |
| Rich Text | TipTap v3 (email composer) |
| Icons | Lucide React |
| Theme | next-themes (class-based dark mode) |
| Font | Inter (Google Fonts) |
| Accent color | `#2383E2` (blue) |

---

## Folder Structure

```
app/
  (app)/                    # Authenticated app routes (sidebar layout)
    leads/                  # Leads table + lead detail (/leads/[id])
    calendar/               # Week view + list view
    call-analytics/         # KPI cards, charts, transcripts tab
    conversations/          # SMS + Email unibox
    settings/               # Business Profile, My Profile, My Staff, Studios, Appearance, Activity Log
    page.tsx                # Root redirect -> /leads
    layout.tsx              # Sidebar + main content layout
    error.tsx               # App-level error boundary
  (auth)/                   # Unauthenticated routes
    login/                  # Email + password sign-in
    accept-invite/          # Invite acceptance / onboarding
    reset-password/         # Password reset completion
  api/                      # API routes (server-side only)
    webhooks/
      ghl-contact/          # New/updated contact -> upserts lead
      ghl-message/          # Inbound message -> upserts conversation + message
      ghl-appointment/      # Appointment create/update/delete -> upserts appointment
      retell-call/          # Archived stub (now uses cron sync)
    conversations/          # GET list, GET messages, POST send, outbound-call, email/recording
    staff/                  # invite, remove, update-role
    admin/                  # backfill-lead-links (one-time admin utility)
  actions.ts                # All server actions (mutations + data fetching)
  globals.css               # Design tokens + global styles
  layout.tsx                # Root layout (ThemeProvider, Inter font)
  global-error.tsx          # Global error boundary

proxy.ts                    # Request proxy (auth, rate limiting)

components/
  sidebar/                  # Sidebar + studio switcher
  leads/                    # Leads table, filters, modals, detail panels
  calendar/                 # Calendar grid, appointment modals, list view
  call-analytics/           # Analytics shell, KPI cards, charts, transcripts
  conversations/            # Compose box, thread, side panel, email editor
  settings/                 # All settings forms and tables
  providers.tsx             # ThemeProvider + ToastProvider wrapper
  ui/                       # Toast provider
  studio-context.tsx        # Studio context provider
  progress-bar.tsx          # Route change progress indicator
  spinner.tsx               # Loading spinner
  error-boundary.tsx        # Error boundary component
  confirm-delete-modal.tsx  # Reusable confirmation dialog
  expandable-textarea.tsx   # Auto-growing textarea
  simple-select.tsx         # Custom select dropdown
  theme-initializer.tsx     # Theme hydration from DB
  theme-toggle.tsx          # Light/dark mode toggle

lib/
  supabase/
    server.ts               # Supabase SSR client (anon + service role)
    client.ts               # Supabase browser client
  constants.ts              # Enum values, color mappings (NOTION_COLORS, STATUS_COLORS)
  types.ts                  # All TypeScript types
  ghl.ts                    # GoHighLevel API helpers (server-side only)
  call-filters.ts           # Client-side transcript filter logic
  field-options.ts          # Lead field option helpers + COLOR_PRESETS
  views.ts                  # Lead view helpers + ALL_COLUMNS_VIEW
  date-utils.ts             # Date formatting, preset ranges, timezone helpers
  data-cache.ts             # React cache() for request-scoped deduplication
  appointment-slots.ts      # Slot availability logic for appointment booking
  rate-limit.ts             # Upstash Redis rate limiting helpers

supabase/
  migrations/               # 28 SQL migration files
  config.toml               # Supabase project config

rules/                      # Project rules for AI agents
  ui-styling.md
  architecture.md
  authentication.md
  state-management.md

docs/                       # Project documentation
  known-limitations.md
  netlify-migration-todo.md
  leads-table-column-rules.txt
  architecture.html
  git-commands.md

.claude/                    # Claude Code customizations
  CLAUDE.md                 # Primary project instructions
  agents/                   # 9 specialized agent definitions
  skills/                   # 7 executable skill workflows
  settings.json             # Permission settings
  settings.local.json       # MCP server enablement
```

---

## Pages & Routes

### Authenticated Pages (`app/(app)/`)

| Page | Route | Type | Description |
|---|---|---|---|
| Root | `/` | Server | Redirects to `/leads` |
| Leads | `/leads` | Server → Client | Notion-style table with inline editing, views, filters, real-time |
| Lead Detail | `/leads/[id]` | Server → Client | Full lead profile, activity log, GHL integration |
| Conversations | `/conversations` | Client | SMS + Email unibox, real-time messaging, 3-panel layout |
| Calendar | `/calendar` | Server → Client | Week view + list view, appointment CRUD |
| Call Analytics | `/call-analytics` | Server → Client | KPI cards, charts, transcript viewer |
| Settings | `/settings` | Server | Redirects based on role |
| Business Profile | `/settings/business-profile` | Client | Studio info (owners only) |
| My Profile | `/settings/my-profile` | Client | User profile settings |
| My Staff | `/settings/my-staff` | Client | Staff management (owners only) |
| Studios | `/settings/studios` | Client | Multi-studio config (owners only) |
| Appearance | `/settings/appearance` | Client | Light/dark mode toggle |
| Activity Log | `/settings/activity-log` | Client | Audit log viewer |

### Auth Pages (`app/(auth)/`)

| Page | Route | Description |
|---|---|---|
| Login | `/login` | Email/password sign-in, forgot password flow |
| Accept Invite | `/accept-invite` | Set initial password after admin invite |
| Reset Password | `/reset-password` | Password reset completion |

---

## Component Hierarchy

### Sidebar (2 files)
- **`sidebar.tsx`** (237 lines) — Collapsible nav (240px / 56px), logo, nav items, settings link, collapse toggle
- **`studio-switcher.tsx`** (186 lines) — Studio selector dropdown with search, avatar initials, floating panel

### Leads (14 files)
| Component | Purpose |
|---|---|
| `leads-table.tsx` | Main table with pagination, column resize, inline editing, bulk ops, view switching |
| `leads-filter-bar.tsx` | Search + multi-filter dropdowns (status, level, action, source, reason) + sort |
| `filter-dropdown.tsx` | Multi-select filter popup |
| `enum-dropdown.tsx` | Inline enum value editor for cells |
| `date-picker-popup.tsx` | Date selection popup |
| `status-tag.tsx` | Colored status badge renderer |
| `lead-detail-panel.tsx` | Inline lead inspector |
| `lead-info-panel.tsx` | Read-only lead info display |
| `lead-profile-client-shell.tsx` | Lead detail page wrapper |
| `lead-profile-right-panel.tsx` | Sidebar on lead detail page |
| `new-lead-modal.tsx` | Create lead dialog (185 lines) |
| `phone-input.tsx` | Formatted phone number input |
| `views-selector.tsx` | View switcher UI |
| `checkbox.tsx` | Styled checkbox |

### Conversations (6 files)
| Component | Purpose |
|---|---|
| `conversation-thread.tsx` | Message display with appointment chips |
| `compose-box.tsx` (715 lines) | SMS/email composer with templates, attachments |
| `contact-side-panel.tsx` | Lead info in conversation view |
| `email-thread-card.tsx` | Email message display |
| `email-editor.tsx` | TipTap rich email editor |
| `message-thread.tsx` | Conversation thread wrapper |

### Calendar (9 files)
| Component | Purpose |
|---|---|
| `calendar-shell.tsx` | Tab switching (calendar/list/settings), week nav, real-time updates |
| `calendar-grid.tsx` | Weekly time-slot grid |
| `appointment-modal.tsx` (432 lines) | Appointment detail/edit modal |
| `create-appointment-modal.tsx` | New appointment dialog |
| `calendar-settings-tab.tsx` | Studio calendar config |
| `appointment-list-panel.tsx` | List view of appointments |
| `appointment-list-filter-bar.tsx` | Filter toolbar for list |
| `appointment-date-picker.tsx` | Date picker for list filter |
| `calendar-lead-panel.tsx` | Lead context in calendar |

### Call Analytics (14 files)
| Component | Purpose |
|---|---|
| `analytics-shell.tsx` | Container with analytics/transcripts tabs |
| `kpi-card.tsx` | Large metric display |
| `stat-card.tsx` | Small stat tile |
| `transcripts-panel.tsx` | Transcript list view |
| `transcript-viewer.tsx` | Single transcript display |
| `transcripts-filter-bar.tsx` | Filter/search for transcripts |
| `date-range-filter.tsx` | Date range selector |
| `date-range-picker-popup.tsx` | Popup date picker |
| `charts/volume-chart.tsx` | Calls per day (bar/line) |
| `charts/outcome-chart.tsx` | Call outcomes (pie) |
| `charts/success-chart.tsx` | Success rate metric |
| `charts/disconnect-chart.tsx` | Disconnect reasons |
| `charts/rate-chart.tsx` | Connect/pickup rates |
| `charts/sentiment-chart.tsx` | Call sentiment distribution |

### Settings (7 files)
| Component | Purpose |
|---|---|
| `settings-nav.tsx` | Settings sidebar navigation |
| `appearance-form.tsx` | Theme selection (light/dark) |
| `business-profile-form.tsx` | Studio info editor |
| `my-profile-form.tsx` | User profile editor |
| `my-staff-table.tsx` | Staff member management |
| `studios-form.tsx` | Multi-studio config |
| `activity-log-table.tsx` | Audit log display |

---

## API Routes

### Conversations (`/api/conversations/`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/conversations` | Search & list conversations from GHL with pagination |
| POST | `/api/conversations` | Create or retrieve conversation by contact ID |
| PATCH | `/api/conversations` | Update starred/unread via GHL |
| DELETE | `/api/conversations` | Delete conversation from GHL |
| GET | `/api/conversations/[id]/messages` | Fetch paginated messages with appointment enrichment |
| POST | `/api/conversations/[id]/messages` | Send SMS or email (rate limited: 100/hr) |
| GET | `/api/conversations/messages/[msgId]/recording` | Fetch audio recording |
| GET | `/api/conversations/messages/email/[emailId]` | Fetch full email details |
| GET | `/api/conversations/unread-count` | Get unread conversation count |
| POST | `/api/conversations/outbound-call` | Initiate outbound call via GHL/Twilio |

### Webhooks (`/api/webhooks/`)

| Method | Path | Secret Header | Description |
|---|---|---|---|
| POST | `/api/webhooks/ghl-contact` | `x-ghl-webhook-secret` | Contact create/update/delete -> lead upsert |
| POST | `/api/webhooks/ghl-message` | `x-ghl-webhook-secret` | Inbound/outbound message -> conversation + message upsert |
| POST | `/api/webhooks/ghl-appointment` | `x-ghl-secret` / `authorization` | Appointment CRUD with soft-delete + event tracking |
| GET/POST | `/api/webhooks/retell-call` | — | Archived stub (returns 200) |

### Staff (`/api/staff/`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/staff/invite` | Invite user to studio (owner/super_admin only) |
| POST | `/api/staff/remove` | Remove user from studio |
| POST | `/api/staff/update-role` | Change user's studio role |

### Admin (`/api/admin/`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/backfill-lead-links` | One-time backfill: link unlinked calls to leads |

---

## Server Actions

All defined in `app/actions.ts`.

### Studio Management
| Action | Description |
|---|---|
| `setSelectedStudio(studioId)` | Sets selected_studio_id cookie |
| `createStudio(config)` | Creates new studio; adds creator as studio_owner |
| `updateStudio(id, updates)` | Updates studio config (owner/super_admin only) |
| `deleteStudio(id)` | Soft-deletes studio (sets deleted_at) |

### Lead Management
| Action | Description |
|---|---|
| `createLead(config)` | Creates lead in Supabase, syncs to GHL, logs activity |
| `updateLead(id, updates)` | Updates fields; syncs name/phone/email to GHL if changed |
| `deleteLeads(ids[])` | Bulk delete with GHL sync; logs activity |
| `bulkUpdateLeads(ids[], field, value)` | Bulk update single field |
| `fetchLeadById(id)` | Fetches lead with enum field display names |
| `fetchLeadsPage(config)` | Paginated search with multi-field filtering, sorting, text search |

### Lead Views
| Action | Description |
|---|---|
| `createLeadView(studioId, name, columns)` | Creates custom column view |
| `updateLeadView(viewId, name, columns)` | Updates view |
| `deleteLeadView(viewId)` | Deletes view |

### Field Options
| Action | Description |
|---|---|
| `getStudioFieldOptions(studioId)` | Fetches all studio field options grouped by field |
| `updateStudioFieldOptionColor(optionId, bg, text)` | Updates option colors |
| `updateStudioFieldOptionOrder(updates[])` | Persists drag-and-drop reorder |
| `addStudioFieldOption(studioId, field, value)` | Adds new option or returns existing |
| `renameStudioFieldOption(studioId, field, old, new)` | Renames option |
| `deleteStudioFieldOption(optionId)` | Deletes option; referencing leads set to NULL |

### User Preferences
| Action | Description |
|---|---|
| `getUserPreferences(studioId)` | Fetches col_widths, active_view_id, theme, nav_collapsed, notifications |
| `saveUserPreferences(studioId, ...)` | Upserts preferences |
| `saveThemePreference(theme)` | Updates theme only |
| `saveNavCollapsed(collapsed)` | Updates nav state |
| `saveNotificationPreferences(...)` | Updates notification flags |
| `getAnalyticsPreferences(studioId)` | Gets direction + date preset |
| `saveAnalyticsPreferences(studioId, ...)` | Saves analytics filters |
| `getPageFilters(studioId)` | Gets page-specific filters |
| `savePageFilters(studioId, filters)` | Merges and saves page filters |

### Activity Logging
| Action | Description |
|---|---|
| `logLeadActivity(studioId, leadName, actorEmail, eventType)` | Logs lead events |
| `getActivityLogs(studioId)` | Fetches last 200 activity logs |
| `deleteActivityLog(id)` | Deletes log entry |

### Call Management
| Action | Description |
|---|---|
| `syncRetellCallsNow(studioId)` | Fetches calls from Retell API, upserts, auto-links to leads |
| `fetchCallsAnalytics(studioId, from, to)` | Aggregates: volume, duration, outcomes, sentiment |
| `fetchCallTranscripts(studioId, from, to, page, pageSize, direction)` | Paginated transcripts with lead enrichment |
| `fetchCallsForLead(leadId, studioId)` | Gets all calls for a lead |
| `refreshSingleCallFromRetell(callId, studioId)` | Refreshes call from Retell API |
| `fetchCallTranscriptText(callId)` | Gets plain transcript text |
| `fetchCallTranscriptFull(callId)` | Gets transcript + tool_calls array |

### Appointment Management
| Action | Description |
|---|---|
| `findLeadsByContactIds(contactIds[], studioId)` | Maps GHL contact IDs to leads |
| `getCalendarAppointments(studioId, start, end)` | Fetches appointments in time range |
| `rescheduleAppointment(id, newStart, newEnd)` | Updates GHL first (fatal), then Supabase |
| `deleteAppointment(id)` | Soft-deletes; mirrors to GHL (non-fatal) |
| `updateAppointmentDetails(id, updates)` | Updates title/notes/status via GHL + Supabase |
| `fetchBookedSlotsForDate(studioId, date)` | Returns "HH:MM" array of booked times |
| `searchLeadsByName(studioId, query)` | Typeahead search for appointment creation |
| `createAppointment(config)` | Creates in GHL, upserts to Supabase, emits event |
| `updateAppointmentStatus(id, status)` | Updates status via GHL + Supabase |
| `fetchAppointmentList(studioId, filters, sort)` | Paginated list with search/date/status filtering |
| `saveCalendarSettings(studioId, config, ...)` | Validates and saves calendar config |

---

## Database Schema

### Core Tables

#### `studios`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `name` | text | |
| `location` | text | Legacy, backward compat |
| `street_address, city, postal_code, state, country` | text | |
| `logo_url` | text nullable | |
| `ghl_account_id` | text | GHL location ID |
| `ghl_calendar_id` | text nullable | |
| `ghl_api_key` | text nullable | Per-studio API key |
| `retell_agent_id` | text | |
| `retell_api_key` | text nullable | Per-studio API key |
| `calendar_start_hour, calendar_end_hour` | int | |
| `appointment_duration_minutes` | int | |
| `appointment_min_advance_weeks` | int | |
| `appointment_slots` | jsonb | `Record<dayOfWeek, string[]>` |
| `created_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

#### `studio_users`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `studio_id` | uuid (FK) | |
| `user_id` | uuid (FK -> auth.users) | |
| `role` | text | CHECK: super_admin / studio_owner / studio_staff |
| `avatar_url` | text nullable | |
| `created_at` | timestamptz | |
| UNIQUE | (studio_id, user_id) | |

#### `leads`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `studio_id` | uuid (FK) | |
| `created_at` | timestamptz | |
| `name` | text nullable | |
| `status` | text nullable | Enum via studio_field_options |
| `level` | text nullable | Enum via studio_field_options |
| `action` | text nullable | Enum via studio_field_options |
| `phone` | text nullable | |
| `email` | text nullable | |
| `last_contacted` | timestamptz nullable | |
| `first_lesson` | timestamptz nullable | |
| `comments` | text nullable | |
| `source` | text nullable | Enum via studio_field_options |
| `tick` | boolean (default: false) | |
| `reason` | text nullable | Enum via studio_field_options |
| `available` | text nullable | |
| `showed` | boolean (default: false) | |
| `bought` | boolean (default: false) | |
| `partnership` | text nullable | Enum via studio_field_options |
| `old` | boolean (default: false) | |
| `ghl_contact_id` | text nullable (UNIQUE) | Deduplication |
| `created_by_email` | text nullable | |
| REPLICA IDENTITY | FULL | For Realtime DELETE filtering |

#### `user_preferences`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK) | |
| `studio_id` | uuid (FK) | |
| `col_widths` | jsonb | `Record<string, number>` |
| `field_options` | jsonb | |
| `active_view_id` | text (default: 'all') | |
| `theme` | text (default: 'light') | |
| `nav_collapsed` | boolean (default: false) | |
| `notify_lead_created/updated/deleted` | boolean | |
| `analytics` | jsonb | `{ direction, preset }` |
| `page_filters` | jsonb | Nested per-page filter state |
| `updated_at` | timestamptz | |
| UNIQUE | (user_id, studio_id) | |

#### `studio_field_options`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `studio_id` | uuid (FK) | |
| `field` | text | status / level / action / source / reason / partnership |
| `value` | text | Display value |
| `bg` | text nullable | Notion-style CSS class |
| `text` | text nullable | Notion-style CSS class |
| `sort_order` | int nullable | |
| UNIQUE | (studio_id, field, value) | |

#### `lead_views`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `studio_id` | uuid (FK) | |
| `created_by` | uuid nullable (FK) | |
| `name` | text | |
| `columns` | jsonb | `text[]` of column keys |
| `created_at` | timestamptz | |

#### `activity_logs`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `studio_id` | uuid (FK) | |
| `message` | text | |
| `lead_name` | text nullable | |
| `actor_email` | text nullable | |
| `event_type` | text nullable | |
| `created_at` | timestamptz | |

#### `calls`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `studio_id` | uuid (FK) | |
| `retell_call_id` | text (UNIQUE) | |
| `lead_id` | uuid nullable (FK -> leads, ON DELETE SET NULL) | |
| `created_at` | timestamptz | |
| `duration_seconds` | int nullable | |
| `sentiment` | text nullable | positive / neutral / negative / unknown |
| `outcome` | text nullable | successful / unsuccessful |
| `disconnected_reason` | text nullable | agent_hangup / user_hangup / voicemail / etc. |
| `picked_up, transferred, voicemail` | boolean nullable | |
| `direction` | text nullable | inbound / outbound |
| `transcript_summary, transcript` | text nullable | |
| `quality_score` | numeric nullable | |
| `appointment_booked` | boolean nullable | |
| `recording_url` | text nullable | |

#### `appointments`
| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | GHL appointment ID |
| `studio_id` | uuid (FK) | |
| `title, calendar_id, calendar_name` | text nullable | |
| `contact_id, contact_name` | text nullable | |
| `assigned_user_id, assigned_user_name` | text nullable | |
| `notes, address, status` | text nullable | |
| `start_time, end_time` | timestamptz | |
| `created_at, updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |
| `appointment_id` | text nullable | |

#### `conversations`
| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | GHL conversation ID |
| `studio_id` | uuid (FK) | |
| `contact_id, contact_name` | text nullable | |
| `email, phone, type` | text nullable | |
| `last_message_body` | text nullable | |
| `last_message_date` | timestamptz nullable | |
| `unread_count` | int (default: 0) | |
| `updated_at` | timestamptz | |

#### `messages`
| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | GHL message ID |
| `conversation_id` | text (FK) | |
| `studio_id` | uuid (FK) | |
| `direction` | text | inbound / outbound |
| `body, message_type, status` | text nullable | |
| `subject, error` | text nullable | |
| `date_added` | timestamptz nullable | |
| `appointment_id` | text nullable | |
| `created_at` | timestamptz | |

#### `appointment_events`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `studio_id` | uuid (FK) | |
| `appointment_id` | text | |
| `contact_id` | text nullable | |
| `verb` | text | Created / Updated / Rescheduled / Deleted |
| `new_start_time` | timestamptz nullable | |
| `created_at` | timestamptz | |

---

## RLS Policies

### Helper Functions
- **`get_my_studio_ids()`** — Returns array of studio IDs the current user belongs to
- **`is_super_admin()`** — Checks if user is super_admin in any studio
- **`is_studio_owner(studio_id)`** — Checks if user is owner/super_admin of specific studio

### Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `studios` | Own studios | super_admin only | Owners/super_admin | super_admin only |
| `studio_users` | Own studio memberships | Owners can add | Owners can update | Owners can remove |
| `leads` | Own studio leads | Staff/owners | Staff/owners | Owners/super_admin |
| `user_preferences` | Own rows | Own rows | Own rows | — |
| `studio_field_options` | Studio members | Studio members | Studio members | Studio members |
| `lead_views` | Studio members | Studio members | — | Studio members |
| `activity_logs` | Studio members | Studio members | — | Owners/super_admin |
| `calls` | Studio members | Service role | — | Owners/super_admin |
| `conversations` | Studio members | Service role | — | — |
| `messages` | Studio members | Service role | — | — |
| `appointment_events` | Studio members | Service role | — | — |

---

## Migration History

28 sequential migrations in `supabase/migrations/`:

| # | File | Purpose |
|---|---|---|
| 001 | `initial_schema.sql` | Create studios, studio_users, leads tables + indexes |
| 002 | `rls_policies.sql` | Enable RLS, helper functions, policies |
| 003 | `lead_views.sql` | lead_views table + trigger for default view seeding |
| 004 | `user_preferences.sql` | user_preferences table + policies |
| 005 | `studio_field_options.sql` | studio_field_options table + RLS |
| 006 | `normalize_lead_enum_fields.sql` | Data migration |
| 007 | `reset_and_reseed.sql` | Data migration |
| 008 | `leads_realtime.sql` | ALTER leads REPLICA IDENTITY FULL |
| 009 | `leads_created_by_email.sql` | Add created_by_email column |
| 010 | `nav_collapsed.sql` | Add nav_collapsed to user_preferences |
| 011 | `notification_prefs.sql` | Add notify_* columns |
| 012 | `activity_logs.sql` | Create activity_logs table + RLS |
| 013 | `activity_logs_structured.sql` | Add lead_name, actor_email, event_type |
| 014 | `calls_table.sql` | Create calls table (Retell AI) + RLS |
| 015 | `studio_calendar_hours.sql` | Add calendar hours to studios |
| 016 | `appointments_table.sql` | Create appointments table (GHL) + RLS |
| 017 | `studio_slot_config.sql` | Add appointment slot config to studios |
| 018 | `field_options_colors_and_enum_updates.sql` | Add bg/text to field options |
| 019 | `field_options_sort_order.sql` | Add sort_order + seed |
| 020 | `field_options_unique_constraint.sql` | Enforce unique constraints |
| 021 | `conversations_messages.sql` | Create conversations + messages tables + Realtime |
| 022 | `appointment_events.sql` | Create appointment_events table + Realtime |
| 023 | `user_preferences_analytics_page_filters.sql` | Add analytics + page_filters JSONB |
| 024 | `calls_extended_fields.sql` | Add quality_score, appointment_booked, recording_url |
| 025 | `appointments_deleted_at.sql` | Add soft-delete to appointments |
| 026 | `messages_extended_fields.sql` | Add subject, error, appointment_id |
| 027 | `studios_extended_fields.sql` | Add address fields, calendar config, API keys, soft-delete |
| 028 | `studio_ghl_api_key.sql` | Add ghl_api_key to studios |

---

## Roles & Permissions

| Role | Who | What they can do |
|---|---|---|
| `super_admin` | Developers / Myrrh agency | Everything. Bypasses all RLS. Creates studios and accounts. |
| `studio_owner` | Dance studio owners | Full access to their studios. Invite/manage staff. All settings tabs. |
| `studio_staff` | Front desk, coaches | Edit leads, view analytics + calendar, use unibox. My Profile only in Settings. |

Role is stored in `studio_users.role` per studio — a user can have different roles in different studios.

---

## Authentication & Session Handling

- **Provider:** Supabase Auth — email + password only. No OAuth, no magic links, no public signup.
- **Accounts created by:** `super_admin` only (via invite)
- **Session:** Supabase SSR client (`lib/supabase/server.ts`) reads from cookies
- **Middleware:** `proxy.ts` protects all `(app)` routes, redirects unauthenticated users to `/login`
- **Invite flow:** Admin sends invite -> user clicks link -> `/accept-invite` -> sets password -> `onboarding_complete = true`
- **Authorization helper:** `getAuthorizedClient()` in `actions.ts` returns service client for super_admin, user's client (RLS-scoped) otherwise

---

## Real-Time Subscriptions

Active Supabase Realtime subscriptions via `postgres_changes`:

| Table | Component | Events | Notes |
|---|---|---|---|
| `leads` | `leads-table.tsx` | INSERT/UPDATE/DELETE | Updates local state, shows toast |
| `messages` | `conversations/page.tsx` | INSERT | New messages appear instantly |
| `conversations` | `conversations/page.tsx` | UPDATE | Last message, unread count |
| `appointments` | `calendar-shell.tsx` | INSERT/UPDATE/DELETE | Updates week + list view |
| `appointment_events` | `conversation-thread.tsx` | INSERT | Verb chips in conversation |

All subscriptions filter by `studio_id` and clean up on unmount.

---

## State Management

**No global state store** (no Redux, Zustand, Jotai).

| State Type | Where It Lives |
|---|---|
| UI state (open/close, selections, filters) | Component `useState` |
| Server data (leads, calls, conversations) | Server components fetch -> pass as props |
| Real-time updates | Supabase Realtime in client components |
| User preferences | `user_preferences` table, fetched server-side |
| Filter + sort state | `user_preferences.page_filters` JSONB (debounced 1s save) |
| Theme | `next-themes` ThemeProvider |

---

## External Integrations

### GoHighLevel (GHL)

| Feature | Direction | Implementation |
|---|---|---|
| Contacts | Bidirectional | Webhooks inbound; API calls outbound (create/update/delete) |
| Conversations | Bidirectional | Webhooks inbound; API calls for send/list/search |
| Calendar/Appointments | Bidirectional | Webhooks inbound; API calls for CRUD |

**Sync pattern:** Non-fatal by design — GHL API failures don't block Supabase writes (except appointment creation where slot consistency matters).

**API client:** `lib/ghl.ts` with `ghlFetch()` base helper, per-studio API keys.

### Retell AI

| Feature | Direction | Implementation |
|---|---|---|
| Call analytics | Inbound (cron sync) | `syncRetellCallsNow()` fetches from Retell API |
| Call recordings | Outbound | On-demand fetch via Retell API |

**Note:** Webhook endpoint archived — now uses cron-based sync.

### Supabase

| Feature | Usage |
|---|---|
| Database | PostgreSQL for all tables |
| Auth | Email/password, SSR cookies |
| Realtime | `postgres_changes` subscriptions |
| RLS | Row-level security on every table |

---

## Rate Limiting

Implemented via Upstash Redis (`lib/rate-limit.ts`) with sliding window algorithm.

| Endpoint | Limit | Key |
|---|---|---|
| Login | 10 attempts / 15 min | Per IP |
| Send message | 100 messages / hour | Per user |
| General routes | 100 req / min | Per user/IP |

---

## Security Architecture

### Non-Negotiable Requirements

1. **Supabase RLS on every table** — `studio_id` scoping; users only see data for their assigned studios
2. **No secrets in frontend** — all API keys in server-side env vars only
3. **Webhook validation** — shared secret header check before processing any payload
4. **Rate limits** enforced via Upstash Redis
5. **Browser NEVER calls GHL or Retell directly** — all external API calls in `app/api/` routes only

### Security Headers (next.config.ts)

| Header | Value |
|---|---|
| `X-Frame-Options` | DENY |
| `X-Content-Type-Options` | nosniff |
| `Referrer-Policy` | strict-origin-when-cross-origin |
| `Strict-Transport-Security` | max-age=31536000; includeSubDomains |
| `Permissions-Policy` | camera=(), microphone=(), geolocation=() |

---

## Design System

### Color Tokens (CSS Custom Properties in `globals.css`)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--color-accent` | `#2383E2` | `#2383E2` | Buttons, checkboxes, focus rings |
| `--color-accent-hover` | `#1a6ec7` | `#1a6ec7` | Hover states |
| `--color-accent-subtle` | `#EBF3FD` | `rgba(35,131,226,0.12)` | Tinted surfaces |
| `--color-bg` | `#ffffff` | `#111111` | Page background |
| `--color-surface` | `#f7f7f7` | `#1a1a1a` | Table rows, cards |
| `--color-surface-hover` | `#f0f0ef` | `#222222` | Hover states |
| `--color-border` | `#e5e5e3` | `#2a2a2a` | Dividers, inputs |
| `--color-border-strong` | `#d0d0ce` | `#3a3a3a` | Modal edges |
| `--color-text-primary` | `#111111` | `rgba(255,255,255,0.92)` | Headings, data |
| `--color-text-secondary` | `#6b7280` | `rgba(255,255,255,0.50)` | Labels, placeholders |
| `--color-text-muted` | `#9ca3af` | `rgba(255,255,255,0.30)` | Timestamps |

### Status Badge Colors (Notion Palette)

| Color | Background | Text |
|---|---|---|
| Green | `#EDF3EC` | `#448361` |
| Yellow | `#FBF3DB` | `#CB912F` |
| Red | `#FFE2DD` | `#C4554D` |
| Blue | `#D3E5EF` | `#337EA9` |
| Purple | `#EDE9F4` | `#9065B0` |
| Pink | `#F5E0E9` | `#C14C8A` |
| Gray | `#F1F1EF` | `#787774` |
| Orange | `#FAEBDD` | `#C97B48` |
| Brown | `#EEE0DA` | `#9F6B53` |

### Typography
- **Font:** Inter (Google Fonts)
- **Headings:** `text-xl font-semibold` or `text-lg font-semibold`
- **Table headers:** `text-xs font-medium uppercase` in muted color
- **Cell data:** `text-sm font-medium`
- **Secondary text:** `text-xs` in secondary color

### Animation Timings
- `--transition-fast`: `150ms ease` (hover states)
- `--transition-base`: `200ms ease` (checkbox, modal)

---

## Dark Mode

- **Implementation:** `next-themes` with `attribute="class"` on `<html>`
- **Token switching:** CSS custom properties auto-flip in `.dark` class
- **Accent color:** `#2383E2` unchanged in both modes
- **Logo handling:** `filter: brightness(0)` in light mode
- **Rule:** Never use `dark:` Tailwind variants — use CSS tokens instead

---

## MCP & Automation

### Supabase MCP
- Server: `@supabase/mcp-server-supabase@0.6.2`
- Project ref: `npcpkffnswzvzmqolort`
- Available for direct database operations

### n8n MCP
- Server: HTTP-based at `lunastra-ai-n8n.up.railway.app`
- Available for workflow automation (creating/managing n8n workflows)

### Configuration
Both configured in `.mcp.json` and enabled in `.claude/settings.local.json`.

---

## Dependencies

### Core
| Package | Version | Purpose |
|---|---|---|
| `next` | 16.2.2 | Framework |
| `react` / `react-dom` | 19.2.4 | UI library |
| `typescript` | 5.x | Type system |
| `@supabase/supabase-js` | 2.101.1 | Database client |
| `@supabase/ssr` | 0.10.0 | SSR auth helpers |

### UI & Visualization
| Package | Version | Purpose |
|---|---|---|
| `lucide-react` | 1.7.0 | Icons |
| `recharts` | 3.8.1 | Charts |
| `@tiptap/*` | 3.22.5 | Rich text editor (email) |
| `emoji-mart` | 5.6.0 | Emoji picker |
| `next-themes` | 0.4.6 | Dark mode |
| `dompurify` | 3.4.2 | HTML sanitization |

### Infrastructure
| Package | Version | Purpose |
|---|---|---|
| `@upstash/redis` | 1.38.0 | Redis client |
| `@upstash/ratelimit` | 2.0.8 | Rate limiting |
| `resend` | 6.10.0 | Email sending |
| `@netlify/plugin-nextjs` | 5.15.11 | Netlify deployment |

### Dev & Testing
| Package | Version | Purpose |
|---|---|---|
| `tailwindcss` | 4.x | Styling |
| `vitest` | 4.1.2 | Testing |
| `@testing-library/react` | 16.3.2 | Component testing |
| `eslint` | 9.x | Linting |

---

## Configuration Files

| File | Purpose |
|---|---|
| `next.config.ts` | Security headers, dev indicators |
| `tsconfig.json` | TypeScript config (ES2017, strict, `@/*` alias) |
| `netlify.toml` | Build command, publish dir, Next.js plugin |
| `.mcp.json` | MCP server configuration (Supabase + n8n) |
| `.env.example` | Environment variable template |
| `proxy.ts` | Auth middleware, rate limiting, route protection |
| `postcss.config.mjs` | Tailwind CSS v4 PostCSS plugin |

---

## Git History & Branches

**Repository:** `github.com/devunastra/cadence.git`

**Branches:**
- `main` — production branch
- `staging` — current development branch

**Recent Commits:**
| Hash | Message |
|---|---|
| `2904c2e` | fix: update .gitignore for Netlify + fix next-env.d.ts import |
| `64b38d8` | fix: update test cases for STATUS_OPTIONS and ACTION_OPTIONS |
| `8e3f7bf` | feat: integrate Upstash Redis for rate limiting |
| `0a3daac` | feat: add .claude/skills for migration, release, audit, spec |
| `ad9e170` | feat: Add specialized Claude Code agents |
| `1580403` | Migrate deployment from Vercel to Netlify |

---

## Known Limitations

1. **Appointment chip verb tracking** — timestamp-based matching (±5 min window) can produce duplicates in rapid successive actions
2. **Email thread row collapse** — occasional intermittent unresponsiveness on first click (low priority, mostly SMS usage)
3. **Display scaling** — designed for 100% DPI; 125% DPI requires 80% browser zoom
4. **GHL contacts without leads** — contacts in GHL not in the leads table won't appear in conversation search (workaround: manually create lead)
