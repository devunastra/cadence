# AMLS Dashboard

A unified web application for **Arthur Murray Lincolnshire (AMLS)** dance studio, built by [AxureLabs](https://axurelabs.com) for Myrrh.

Replaces Notion for lead management and eliminates context-switching between GoHighLevel and Retell AI.

---

## Features

- **Leads** — Notion-style table with inline editing, views, filters, sort, and real-time updates
- **Call Analytics** — KPI cards, charts, and transcript viewer powered by Retell AI
- **Conversations** — SMS + Email unibox with real-time message delivery
- **Calendar** — Week view + list view, create/reschedule/delete appointments synced to GHL
- **Settings** — Business profile, staff management, appearance, activity log

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + Backend | Next.js 16 (App Router), TypeScript, Tailwind CSS v4 |
| Database | Supabase (PostgreSQL + Realtime) |
| Auth | Supabase Auth (email/password, SSR cookies) |
| Hosting | Vercel |

---

## Integrations

| Service | Usage |
|---|---|
| **GoHighLevel** | Contacts, Conversations, Calendar, Appointments — webhooks inbound, API calls outbound |
| **Retell AI** | Post-call analytics and transcripts |
| **Supabase** | Database, auth, real-time subscriptions |

> The browser never calls GHL or Retell directly. All external API calls go through `app/api/` server routes.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project
- A GoHighLevel account with API access
- A Vercel account (for deployment)

### Local Setup

```bash
git clone https://github.com/Manifer/ALMS-WebApp.git
cd AMLS-WebApp
npm install
cp .env.example .env.local
# Fill in .env.local with your values
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server only) |
| `GHL_WEBHOOK_SECRET` | Yes | Shared secret for GHL webhook validation |
| `GHL_API_KEY` | Yes | GoHighLevel API key |
| `GHL_PHONE_NUMBER` | Yes | Studio phone number for outbound calls |
| `CRON_SECRET` | Yes | Secret for the admin backfill endpoint |
| `NEXT_PUBLIC_SITE_URL` | Yes | Full app URL (e.g. `https://your-app.vercel.app`) |
| `RETELL_API_KEY` | Optional | Global Retell API key (can also be set per-studio in DB) |

---

## Project Structure

```
app/
  (app)/          # Authenticated routes (leads, calendar, conversations, settings)
  (auth)/         # Login, accept-invite
  api/
    webhooks/     # GHL contact, message, appointment webhooks + Retell stub
    conversations/ # GHL Conversations API proxy
    staff/        # Invite and remove staff
    admin/        # One-time admin utilities
  actions.ts      # All server actions (mutations + data fetching)

components/
  leads/          # Leads table, filters, views, modals
  calendar/       # Week view, list view, appointment modal
  call-analytics/ # KPI cards, charts, transcripts panel
  conversations/  # Unibox, message thread, lead side panel
  settings/       # All settings tabs

lib/
  supabase/       # Browser + server Supabase clients
  ghl.ts          # GoHighLevel API helpers (server-side only)
  types.ts        # Shared TypeScript types
  rate-limit.ts   # In-memory rate limiting
  constants.ts    # Enum values + color mappings
```

---

## User Roles

| Role | Description |
|---|---|
| `super_admin` | Full access across all studios. Creates studios and user accounts. |
| `studio_owner` | Full access to their studio. Can invite and manage staff. |
| `studio_staff` | Can edit leads, view analytics, use conversations and calendar. My Profile only in Settings. |

Data isolation is enforced via Supabase Row-Level Security — users only see data for studios they belong to.

---

## Webhook Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/webhooks/ghl-contact` | GHL contact create/update/delete → upserts lead |
| `POST /api/webhooks/ghl-message` | GHL inbound/outbound message → upserts conversation + message |
| `POST /api/webhooks/ghl-appointment` | GHL appointment events → upserts appointment |
| `POST /api/webhooks/retell-call` | Stub (call sync handled by cron) |

All webhook endpoints validate a shared secret via the `x-ghl-webhook-secret` header.

---

## Known Limitations

See [`docs/known-limitations.md`](docs/known-limitations.md) for full details. Summary:

1. **Appointment chip verbs** — matched by timestamp proximity; edge case if two actions happen within 1 minute for the same contact
2. **Conversation message delay** — messages flow GHL → n8n → Supabase → dashboard; expect a few seconds to ~30s delay
3. **Email thread collapse** — intermittent first-click miss; click again or use the collapse-all toggle
4. **Display scaling** — designed for Windows 100% scale; use 80% browser zoom at 125% OS scale
5. **GHL contacts without a Leads profile** — contacts added directly in GHL won't appear in Leads or appointment search until a Lead record is manually created

---

## Security

- All external API calls (GHL, Retell) are server-side only — never exposed to the browser
- Supabase RLS enforced on every table with `studio_id` scoping
- Webhook endpoints validate a shared secret before processing any payload
- Rate limiting on login (10/15min), message send (100/hr), and general routes (100/min)

---

*Built by [AxureLabs](https://axurelabs.com) for Myrrh*
