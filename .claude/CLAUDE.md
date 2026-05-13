# AMLS Web App — CLAUDE.md

This file is the entry point for any developer (or AI assistant) picking up this project.
Read this first, then read `implementation_plan.md` for the full schema, API routes, and feature breakdown.

> **Status:** All three phases complete and live on Vercel.
> **Last updated:** 2026-05-08

---

## What This Project Is

A unified web app for **Arthur Murray Lincolnshire (AMLS)** dance studio, built by **Lunastra AI** for **Myrrh** (AI Automation Agency). It replaces Notion (lead management) and eliminates the need to switch between GoHighLevel (GHL) and Retell AI.

**The app gives studio owners:**
- A Notion-style leads table with inline editing, views, filters, and real-time updates
- A call analytics dashboard (KPI cards, charts, transcript viewer) from Retell AI data
- A messaging unibox (SMS + Email via GHL Conversations API) with real-time delivery
- A calendar (week view + list view) with create/reschedule/delete synced to GHL

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + Backend | Next.js 14 (App Router), TypeScript, Tailwind CSS v4 |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password, SSR cookies) |
| Realtime | Supabase Realtime (`postgres_changes`) |
| Hosting | Vercel |
| Accent color | `#2383E2` (blue) |
| Font | Inter (Google Fonts) |
| UI style | Clean, modern — Apple/Stripe/Linear-inspired |

---

## Roles

| Role | Who | What they can do |
|---|---|---|
| `super_admin` | Developers / Agency | Everything. Bypasses all RLS. Creates studios and accounts. |
| `studio_owner` | Dance studio owners | Full access to their studios. Invite staff. All settings tabs. |
| `studio_staff` | Front desk, coaches | Edit leads, view analytics + calendar, use unibox. My Profile only in Settings. |

**Data isolation is enforced via Supabase RLS at the database level** — every table has a `studio_id` column. Users only see data for their assigned studios.

---

## Pages (in sidebar order)

| Page | Route | Status | Description |
|---|---|---|---|
| **Leads** | `/leads` | ✅ Live | Notion-style table, inline editing, views, multi-select filters, sort, real-time |
| **Call Analytics** | `/call-analytics` | ✅ Live | KPI cards, charts, transcript viewer, date range filter |
| **Conversations** | `/conversations` | ✅ Live | SMS + Email unibox, real-time, inline reply, lead side panel |
| **Calendar** | `/calendar` | ✅ Live | Week view + list view, create/reschedule/delete synced to GHL |
| **Settings** | `/settings` | ✅ Live | Business Profile, My Profile, My Staff, Studios (super admin), Appearance, Activity Log |
| **Lead Detail** | `/leads/[id]` | ✅ Live | Full lead profile, activity log |

Login: email + password only. No public signup — accounts created by super admin.

---

## Key Integrations

| Service | How we use it | Direction |
|---|---|---|
| **GHL (GoHighLevel)** | Contacts, Conversations API, Calendar, Appointments | Webhooks inbound; API calls outbound (server-side only) |
| **Retell AI** | Post-call webhook for analytics + recordings | Webhook inbound |
| **Supabase** | DB, Auth, Realtime | Internal |

**Rule:** The browser NEVER calls GHL or Retell directly. All external API calls happen inside `app/api/` routes using server-side env vars. This is a hard security requirement — do not break this pattern.

---

## Database Tables Summary

Full schema with all columns → see `implementation_plan.md`.

| Table | Purpose |
|---|---|
| `studios` | Studio info — name, address, GHL IDs, Retell IDs, calendar config, appointment slots |
| `studio_users` | Maps users to studios with a role |
| `user_preferences` | Per-user per-studio prefs — col widths, theme, view, notifications, page filters, analytics prefs |
| `leads` | All lead data (mirrors Notion fields). Enum options live in `studio_field_options`. |
| `studio_field_options` | Per-studio enum options for lead fields (status, level, action, source, reason, partnership) with custom colors + sort order |
| `lead_views` | Saved column-set views per studio |
| `activity_logs` | Lead create/update/delete audit log |
| `calls` | Call records from Retell post-call webhook |
| `appointments` | Appointments from GHL webhook (upserted by GHL appointment webhook) |
| `conversations` | GHL conversation threads per contact |
| `messages` | Individual SMS/Email messages within conversations |
| `appointment_events` | Tracks Created/Updated/Rescheduled/Deleted verbs per appointment — written by server actions + GHL webhook, consumed via Realtime to update conversation thread chips |

---

## Security Requirements (non-negotiable)

1. **Supabase RLS on every table** — `studio_id` scoping. Users cannot see other studios' data.
2. **No secrets in the frontend** — all API keys in server-side env vars only.
3. **Webhook endpoints validate a shared secret** before processing any payload.
4. **Rate limits** (in `lib/rate-limit.ts`):
   - Login: 10 attempts / 15 min per IP
   - Send message: 100 messages / hour per user
   - General routes: 100 req / min per user

---

## Leads Schema — Notion Field Mapping

Enum options (Status, Level, Action, Source, Reason, Partnership) are stored in `studio_field_options` per studio — not hardcoded. Studios can add, rename, reorder, and recolor options via Settings.

| Notion Field | Supabase Column | Type |
|---|---|---|
| Created Time | `created_at` | timestamptz |
| Name | `name` | text |
| Status | `status` | text nullable |
| 🏆 Level | `level` | text nullable |
| Action | `action` | text nullable |
| Phone | `phone` | text nullable |
| Email | `email` | text nullable |
| Last Contacted | `last_contacted` | timestamptz nullable |
| First Lesson | `first_lesson` | timestamptz nullable |
| Comments | `comments` | text nullable |
| Source | `source` | text nullable |
| ✅ | `tick` | boolean |
| Reason | `reason` | text nullable |
| Available | `available` | text nullable |
| ✅ Showed | `showed` | boolean |
| ✅ Bought | `bought` | boolean |
| Partnership | `partnership` | text nullable |
| ✅ OLD | `old` | boolean |
| — | `ghl_contact_id` | text nullable (deduplication) |
| — | `created_by_email` | text nullable |

---

## Filter/Sort Persistence

User filter and sort state is saved to `user_preferences.page_filters` (JSONB) on every change (debounced 1s) and restored on next page load. This covers:

- **Leads:** Status, Level, Action, Source, Reason filters + sort field/direction
- **Call Analytics transcripts:** Direction, Sentiment, Outcome, Appointment Booked, Disconnect Reason, Quality Score
- **Calendar list view:** Status filters, date range, sort field/direction

---

## What's Out of Scope

- WhatsApp messaging
- Customizable/drag-and-drop dashboard cards
- Public signup / self-serve onboarding
- Billing or Opportunities pages

---

## Design System

The `rules/` folder contains modular rule files that agents must read before touching relevant areas:

| File | What it covers |
|---|---|
| `rules/ui-styling.md` | **Read before any UI change.** CSS tokens, color usage, typography, animation timings, component patterns |
| `rules/architecture.md` | Folder structure, server vs client, API routes, security rules |
| `rules/state-management.md` | Where state lives, real-time pattern, mutations, pagination |
| `rules/authentication.md` | Roles, RLS, session handling, rate limits |

### Design System Rule (non-negotiable)

> **Whenever a design change is made** — new color, spacing value, component pattern, or animation — **update `rules/ui-styling.md`** with the new token or pattern.
> This file is the single source of truth for all styling decisions.
> **Never hardcode hex values in components.** Always use CSS custom properties defined in `app/globals.css`.

---

## Files to Read

| File | What it contains |
|---|---|
| `implementation_plan.md` | Complete DB schema, API routes, server actions, feature breakdown — **read this for full detail** |
| `lib/types.ts` | All TypeScript types (Lead, Call, Appointment, Studio, etc.) |
| `app/actions.ts` | All server actions — mutations, data fetching, preference persistence |
| `lib/constants.ts` | Enum values, color mappings |
| `lib/ghl.ts` | GoHighLevel API helpers (server-side only) |
| `docs/known-limitations.md` | Known bugs, workarounds, and design constraints — read before reporting issues |
