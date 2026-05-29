# Spec: Client Onboarding — AMLS / Cadence

A guided flow for onboarding a new client (studio owner) and their studio(s), replacing today's fully-manual setup (super admin configuring rows directly in Supabase). A super admin invites a new owner; the owner sets a password and completes a self-service wizard that creates their studio(s), seeds defaults, and configures calendar/schedule — then lands in the app.

| Aspect | Value |
|---|---|
| New route | `/onboarding` (own minimal layout — **not** the `(app)` layout) |
| Studio creation | Owner creates studio(s) on wizard submit |
| Scope of client form | Everything: business profile, GHL/Retell IDs, lead sources, calendar/schedule, timezone |
| Auth gate | `studio_setup_complete` user-metadata flag, enforced in `proxy.ts` |
| Status | **Planned** — blocked on prerequisites P1 + P2 below |

> Schema already supports **multiple owners per studio** and **multiple studios per owner** (`studio_users` is unique on `(studio_id, user_id)`). No migration needed for those.

---

## Prerequisites (blocking)

| ID | Item | Why |
|---|---|---|
| **P1** | Supabase Pro + environment branching | Separate Cadence (Netlify) auth config from AMLS-live; some redirect/site URLs still point at the Vercel live DB. |
| **P2** | Resend or SendGrid (custom SMTP) | Current SMTP is tied to AMLS-live. Needed to send the branded invite email with the Loom tutorial embed. Recommended: `auth.admin.generateLink({ type: 'invite' })` + a fully custom Resend email for template control. |

Do not begin implementation until P1 and P2 are in place.

---

## Target Flow (brand-new client)

1. Super admin sends a **studio-less invite** to the new owner (Settings → My Staff).
2. Owner receives a branded email (Loom tutorial + "Set up your studio" CTA).
3. Owner accepts and sets a password (reuses existing `/accept-invite`).
4. Owner is redirected to `/onboarding` and completes the wizard (business profile + integration IDs + lead sources + calendar/schedule + timezone; supports multiple locations).
5. On submit: studio(s) created, owner linked, defaults seeded → session refreshed → redirect to `/leads`.

---

## Invite Decision Matrix

Two independent axes determine the flow:

- **Password axis** — driven by whether the email already exists in auth.
- **Wizard axis** — driven by whether a studio is assigned at invite time.

| Email exists? | Studio assigned? | Password step | Wizard | Lands on |
|---|---|---|---|---|
| New | No (blank) | Yes | **Yes** | wizard → `/leads` |
| New | Yes (existing studio) | Yes | No | `/leads` (co-owner case) |
| Existing | Yes (another studio) | No — add membership + notify | No | `/leads` (new studio in switcher) |
| Existing | No (blank) | — | — | **Blocked** — "add via Settings" |

Goals satisfied: a co-owner never fills the wizard; a returning owner is never re-onboarded. Additional studios for existing owners are added via **Settings**, never the invite wizard.

---

## Locked Decisions

| Decision | Choice |
|---|---|
| Studio creation timing | Owner creates on wizard submit |
| Integration IDs (GHL/Retell) | Client fills everything (with help text + validation; never logged) |
| Timezone | New `timezone` column; **hybrid picker** — auto-suggest from state/address → browser TZ fallback → owner can override |
| Multi-studio | "Add another location" + "Duplicate to edit"; submit blocked if two studios share **name + address** |
| Lead source defaults | Website form, Facebook, Email, Walk-in (editable) |
| Additional studios (existing owner) | Reuse the full wizard in Settings (minus account/password step) |
| Existing email + blank studio | Blocked with guidance message |

---

## Build Breakdown

### Phase 1 — Database
- Add `timezone text not null default 'America/Chicago'` to `studios`; add to `Studio` type in `lib/types.ts`.
- Update default **source** set → Website form, Facebook, Email, Walk-in. Fix existing Guest/Guests and Event/Events singular-plural mismatch between the SQL seed and `lib/constants.ts`.
- Field-option seeding: call `seed_studio_field_options(studio_id)` via RPC inside the onboarding action (exists since migration 006, currently unwired). Lead views already auto-seed via the existing `AFTER INSERT ON studios` trigger. The five non-source enum fields (status/level/action/reason/partnership) seed silently so the Leads page works on day one.

### Phase 2 — Invite path (`app/api/staff/invite/route.ts` + My Staff)
- Make `studioId` **optional**. When blank: set metadata `{ role_intent: 'studio_owner', studio_setup_complete: false }`, create **no** `studio_users` row.
- **Existing-email branch:** `inviteUserByEmail` errors for already-registered emails (`route.ts:52`). Look up the auth user; if found, skip the invite and just upsert the `studio_users` row, then send a "you've been added to X" notice. Required for multi-studio owners.
- Block existing-email + blank-studio with a clear message.
- **My Staff UI** (`components/settings/my-staff-table.tsx`): add a "New studio (blank)" option to the studio dropdown (super admin only); add a **"Studio assigned"** column (widen the members fetch to all studios for super admin, currently scoped to one studio); relabel for super-admin context.

### Phase 3 — Onboarding wizard + server action
- New `/onboarding` route in its own minimal layout. Multi-step form **per location**:
  1. Business profile (name, address, state, country, postal)
  2. Integration IDs (GHL account/calendar/API key, Retell agent/inbound-agent/API key, phone number) — help text + format validation, never logged
  3. Lead sources (defaults editable)
  4. Calendar/schedule + timezone picker (reuse `calendar-settings-tab.tsx` logic: duration, advance weeks, calendar hours, per-day slots)
- "Add another location" / "Duplicate to edit" for multi-studio.
- New server action `completeStudioOnboarding` (do **not** overload `createStudio` — its guard rejects zero-membership users). It: verifies `role_intent === 'studio_owner'` + `studio_setup_complete === false`; loops entries (create studio → link owner as `studio_owner` → RPC seed → write calendar config + timezone); enforces name+address uniqueness; sets `studio_setup_complete: true` via `admin.updateUserById`.

### Phase 4 — Routing / gating
- `proxy.ts`: mirror the existing `onboarding_complete` gate (line ~53) with a `studio_setup_complete === false` → `/onboarding` redirect; add `/onboarding` to allowed paths.
- `app/(auth)/accept-invite/page.tsx`: route `role_intent === 'studio_owner'` (blank-studio) users to `/onboarding`; everyone else to `/leads`.
- **JWT refresh:** after the metadata flips, call `supabase.auth.refreshSession()` before `router.push('/leads')`, or the proxy bounces the user back to `/onboarding`.

### Phase 5 — Timezone threading (regression risk)
- Replace hardcoded `'America/Chicago'` in `lib/appointment-slots.ts:22`, `lib/ghl.ts:149,259`, `lib/date-utils.ts:4` with the studio's `timezone`. Thread the studio TZ through callers — touches calendar render + appointment/slot math. **Heaviest QA focus.**

### Phase 6 — Reuse wizard in Settings
- Settings → Studios → "Add studio" opens the same wizard (minus account/password) so existing owners get fully-configured additional studios.

### Phase 7 — QA
- Full invite matrix, RLS isolation across studios, no `(app)` layout dead-end, JWT-refresh gate release, calendar correctness post-timezone, multi-studio name+address uniqueness, dark mode on the wizard.

### Phase 8 — Internationalization (worldwide studios) — FUTURE, address before wrap-up
**Confirmed 2026-05-30: studios are worldwide, not US-only.** The current build bakes in a US-only assumption that must be revisited before client onboarding is considered done:
- **State/Region** is a fixed US-states `SimpleSelect` (`components/onboarding/step-business-profile.tsx` and `components/settings/studios-form.tsx`); **Country** is free text. The region list does NOT change with the selected country.
- The **state → timezone** auto-suggest map (`components/onboarding/onboarding-types.ts`) is US-only, and the timezone picker lists only common US IANA zones.
- `America/Chicago` is still hardcoded app-wide (see Phase 5).

Future work:
- Make **Country** a select that drives the region options (US states / Canadian provinces / generic free-text for other countries) — in both the wizard and the Settings studios form.
- Widen the **timezone** picker to the full IANA list (or country-filtered), not just US zones.
- Ensure Phase 5 timezone threading honors any per-studio IANA timezone, not just US ones.

---

## Out of Scope (manual for now)
- Retell agents + n8n workflows duplicated per studio. See the n8n findings below for what is/isn't config-driven today and the path to making it dynamic.

---

## n8n Workflow Audit (scanned 2026-05-29)

Goal: determine how much per-studio work n8n requires when onboarding a new studio. Finding: **one workflow already does multi-tenancy correctly; the voice/calendar workflows are hardcoded single-tenant and get cloned per studio.** "AM Schaumburg Inquiries Workflow" (created 2026-05-28, still inactive) is direct evidence — a manual duplicate for a second Arthur Murray location.

### Verdict by workflow

| Workflow | ID | Verdict | Studio-specific values hardcoded |
|---|---|---|---|
| AMLS Conversations Webhook | `R3jLXpQzFfYfn7nM` | **DYNAMIC** ✅ | None — looks up `studios` by inbound `ghl_account_id`, references `studio_id` downstream. **The template.** |
| Improved Make Workflow v2 | `nbVcDIn35E7z5AgB` | MIXED | Retell agent_id, from_number, GHL location hardcoded; studio_id derived implicitly. |
| Voice AI Functions copy (Joshua) | `LXlMa0Gy2Fq2xuUO` | MIXED→static | Agent IDs, phones, GHL calendar+location hardcoded. **Points at a different Supabase project.** |
| Voice AI Functions (main, 153 nodes) | `gcDhc61cSLTPXOKv` | STATIC | Retell agents, from-numbers, GHL calendar/location/user IDs, a hardcoded `studio_id` UUID, unfiltered `studio_field_options` query. |
| Get GHL Slots | `jXLk7zQtHpy2539x` | STATIC | GHL calendar ID, token, `America/Chicago`. |
| check/availability | `QVUgwY02pcp1gZML` | STATIC | Uses a dev Google Calendar (`dev@lunastra.ai`) — likely leftover test. |
| amls_call / ghl | `hgMf0TyCTgm2bGMo` / `uz8Iw4GtQ0HCPtuW` | STATIC (inactive) | Hardcoded Retell agent/phone / GHL location. |
| AM Schaumburg Inquiries | `rMbzNhw2XP7eBJQq` | unreadable | New-studio duplicate; MCP access disabled. |
| AMLS Scheduled Callbacks (Joshua) | `DrMdkkkCZBZTu3OS` | unreadable | MCP access disabled. |

### Per-studio duplication checklist (what changes today)
Retell **agent_id** (outbound + test + inbound) and override version · Retell **from_number** · GHL **calendar ID** (`TYARmrJ…`) · GHL **location ID** (`slTYdxI…`) · GHL **assigned user ID** · **API keys** (GHL PIT, Retell, Supabase) · **timezone** · hardcoded **studio_id UUID** · and in one copy, the **Supabase project**.

### Path to dynamic (not blocked by P1/P2)
Replace each hardcoded literal with a `studios` lookup keyed by `ghl_account_id` (inbound) or a `studio_id`/`ghl_account_id` carried on the trigger (outbound) — the pattern the Conversations Webhook already uses. The `studios` table already stores most of these (`ghl_account_id`, `ghl_calendar_id`, `retell_agent_id`, `retell_inbound_agent_id`, `retell_phone_number`, plus `timezone` once Phase 1 adds it). Caveats:
- **Outbound triggers must carry a studio identifier** so the workflow knows which config to load — verify the trigger payload includes it.
- Two values aren't stored yet: GHL **assigned user ID**, and a decision on whether Retell/GHL **keys** live in the DB vs n8n credentials.

### Security findings (act on soon — independent of this feature)
- 🔴 Keys stored as **plaintext literals** across many nodes — Retell tokens, GHL PIT tokens, Supabase **anon + service_role** JWTs. One sticky note prints the GHL webhook secret in cleartext. **Decision (2026-05-29): not migrating keys to n8n credentials for now.** Still recommended: **rotate the exposed service_role key** (independent of where keys are stored).
- 🟡 **Cross-project inconsistency:** the Voice AI copy points at Supabase project `ctzcd…` while others use `npcpk…` — contradicts the single-shared-DB assumption; overlaps with the P1 redirect-URL cleanup. Confirm which project is canonical.

### Follow-ups
- Enable `availableInMCP` on the Schaumburg + Scheduled Callbacks workflows to inspect them.

---

## Risks / Notes
- **API keys in a client form** — non-technical owners entering Retell/GHL secrets. Needs clear instructions, validation, and the keys must never be logged (server-side write via service role).
- **JWT staleness** after the metadata flip (Phase 4) — must refresh session client-side.
- **Timezone refactor** (Phase 5) is the highest regression risk; touches calendar/appointment logic.
- **Existing gotcha:** removing staff deletes the entire auth user (`app/api/staff/remove/route.ts:59`) — relevant once an owner belongs to multiple studios. Out of scope but flagged.
