# Architecture Rules — AMLS WebApp

## Framework

- **Next.js 14+ App Router** — all routes live under `app/`
- **React 19**, **TypeScript**, **Tailwind CSS v4** (zero-config, `@tailwindcss/postcss`)
- **Supabase** for DB, Auth, and Realtime
- **Hosted on Vercel**

---

## Folder Structure

```
app/
  (app)/              # Authenticated app routes (sidebar layout)
    leads/            # Leads table + lead detail (/leads/[id])
    calendar/         # Week view + list view
    call-analytics/   # KPI cards, charts, transcripts tab
    conversations/    # SMS + Email unibox
    settings/         # Business Profile, My Profile, My Staff, Studios, Appearance, Activity Log
    page.tsx          # Root redirect → /leads
    layout.tsx        # Sidebar + main content layout
  (auth)/             # Unauthenticated routes (login, accept-invite)
  api/                # API routes (server-side only)
    webhooks/
      ghl-contact/    # New/updated contact → upserts lead
      ghl-message/    # Inbound message → upserts conversation + message
      ghl-appointment/# Appointment create/update/delete → upserts appointment
      retell-call/    # Post-call → inserts call record
    conversations/    # GET list, GET messages, POST send, outbound-call, email/recording
    staff/            # invite, remove
    admin/            # backfill-lead-links (one-time admin utility)
  actions.ts          # All server actions (mutations + data fetching)
  globals.css         # Design tokens + global styles
  layout.tsx          # Root layout (ThemeProvider, Inter font)

components/
  sidebar/
  leads/
  calendar/
  call-analytics/
  conversations/
  settings/
  providers.tsx       # ThemeProvider wrapper

lib/
  supabase/           # Supabase browser + server clients
  constants.ts        # Enum values + color mappings (NOTION_COLORS, STATUS_COLORS)
  types.ts            # Shared TypeScript types
  ghl.ts              # GoHighLevel API helpers (server-side only)
  call-filters.ts     # Client-side transcript filter logic
  field-options.ts    # Lead field option helpers
  views.ts            # Lead view helpers + ALL_COLUMNS_VIEW
  date-utils.ts       # Date formatting, preset ranges, timezone helpers
  data-cache.ts       # Cached server-side data fetching (user, memberships, studio)
  appointment-slots.ts# Slot availability logic for appointment booking
  rate-limit.ts       # Rate limiting helpers

rules/              # Project rules for AI agents (read before touching code)
```

---

## Critical Security Rule

**The browser NEVER calls GHL or Retell directly.**
All external API calls (GoHighLevel, Retell AI) happen inside `app/api/` routes using server-side environment variables. This is a hard requirement — do not break this pattern.

---

## Server vs Client Components

- **Default to Server Components** — data fetching, DB queries, auth checks
- **Use `'use client'`** only when you need: browser APIs, event handlers, useState/useEffect, real-time subscriptions
- Heavy client components (leads-table, conversations): clearly marked `'use client'` at top

---

## Data Fetching

- Server components fetch directly via Supabase server client (`lib/supabase/server.ts`)
- Client components use Supabase browser client (`lib/supabase/client.ts`) for mutations + real-time
- Never expose Supabase service role key to the browser — use `SUPABASE_ANON_KEY` only in client code

---

## API Routes (`app/api/`)

- All external service calls go here
- Webhook endpoints validate a shared secret in the request headers before processing
- Rate limits enforced at this layer (see `lib/rate-limit.ts`)

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `studios` | Studio info — name, address, GHL/Retell IDs, calendar config, appointment slots |
| `studio_users` | User ↔ studio role mapping |
| `user_preferences` | Per-user per-studio prefs (col widths, theme, view, page filters, analytics prefs) |
| `leads` | Lead records |
| `studio_field_options` | Per-studio enum options for lead fields with custom colors + sort order |
| `lead_views` | Saved column-set views per studio |
| `activity_logs` | Lead create/update/delete audit log |
| `calls` | Retell post-call analytics |
| `appointments` | GHL appointments (upserted by webhook, PK is GHL appointment ID) |
| `conversations` | GHL conversation threads per contact |
| `messages` | Individual SMS/Email messages |
| `appointment_events` | Created/Updated/Rescheduled/Deleted events per appointment — drives real-time verb chips in conversation threads |

Every table has a `studio_id` column — **RLS enforced at DB level**.

Full schema with all columns → see `implementation_plan.md`.

---

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` — safe for browser
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — safe for browser
- `SUPABASE_SERVICE_ROLE_KEY` — server only, never expose
- `GHL_API_KEY` — server only
- `RETELL_WEBHOOK_SECRET` — server only
- `GHL_WEBHOOK_SECRET` — server only
