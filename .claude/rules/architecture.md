# Architecture Rules — AMLS WebApp

## Framework

- **Next.js 16 App Router** — all routes live under `app/`
- **React 19**, **TypeScript**, **Tailwind CSS v4** (zero-config, `@tailwindcss/postcss`)
- **Supabase** for DB, Auth, and Realtime
- **Hosted on Netlify** (via `@netlify/plugin-nextjs`)

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
    staff/            # invite, remove, update-role  (see docs/specs/invite-scenarios.md for the invite matrix)
    admin/            # backfill-lead-links (one-time admin utility)
  actions.ts          # All server actions (mutations + data fetching)
  globals.css         # Design tokens + global styles
  layout.tsx          # Root layout (ThemeProvider, Inter font)

proxy.ts              # Request proxy (auth, rate limiting) — formerly middleware.ts

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

- **Layout (`app/(app)/layout.tsx`) is a Server Component** — resolves auth, memberships, studio, and preferences once. Passes data to `StudioProvider` context.
- **Page components are `'use client'`** — they read `studioId`, `userRole`, `isSuper` from `useCurrentStudio()` context and render shell components. No async work, so `loading.tsx` skeletons show instantly during navigation.
- **Shell components are `'use client'`** — they fetch their own data on mount using the Supabase browser client, then use server actions for user-initiated operations (pagination, filter changes, refresh).
- **Exception pages** that need server-side DB queries (e.g., `/leads/[id]`, `/settings/my-profile`, `/settings/my-staff`) remain async Server Components.

---

## Data Fetching

### Navigation pattern (skeleton-first)

1. User clicks a nav link → Next.js shows `loading.tsx` skeleton instantly (no server wait)
2. Page component mounts → reads `studioId` from `StudioProvider` context
3. Shell component mounts → fetches data from Supabase browser client in `useEffect`
4. Data arrives → shell renders content, replaces loading state

### Client vs server data access

- **Initial page data:** Supabase browser client (`lib/supabase/client.ts`) in shell `useEffect` — avoids blocking navigation via server action serialization
- **User-initiated operations** (pagination, filter changes, refresh, mutations): Server actions (`app/actions.ts`) — these are expected to be sequential
- **External API calls** (GHL conversations, recordings): API routes (`app/api/`) — the browser calls these via `fetch()`
- Never expose Supabase service role key to the browser — use `SUPABASE_ANON_KEY` only in client code

### Auth in the request pipeline

- **Proxy (`proxy.ts`):** Validates session via `getSession()` (reads JWT from cookie, no network call). Redirects unauthenticated users to `/login`.
- **Layout:** Calls `getUser()` + `getMemberships()` once per full page load. Cached via `React.cache()` within the same request.
- **Page components:** Do NOT re-fetch auth. Read from `StudioProvider` context.
- **API routes:** Use `getSession()` (not `getUser()`) for auth since the proxy already validated the session.

### StudioProvider context

`StudioProvider` (in `components/studio-context.tsx`) exposes:
- `currentStudio` — full `Studio` object (includes calendar config, slot config, etc.)
- `studioId` — shorthand for `currentStudio.id`
- `userRole` — derived from `memberships` for the current studio
- `isSuper` — whether user has `super_admin` role in any studio
- `memberships` — all user studio memberships

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
