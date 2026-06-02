# Spec: Client Onboarding — AMLS / Cadence

A guided flow for onboarding a new client (studio owner) and their studio(s), replacing today's fully-manual setup (super admin configuring rows directly in Supabase). A super admin invites a new owner; the owner sets a password and completes a self-service wizard that creates their studio(s), seeds defaults, and configures calendar/schedule — then lands in the app.

| Aspect | Value |
|---|---|
| New route | `/onboarding` (own minimal layout — **not** the `(app)` layout) |
| Studio creation | Owner creates studio(s) on wizard submit |
| Scope of client form | Everything: business profile, GHL/Retell IDs, lead sources, calendar/schedule, timezone |
| Auth gate | `studio_setup_complete` user-metadata flag, enforced in `proxy.ts` |
| Status | **Built & deployed on `staging`** — Phases 1–5 + 8 complete (2026-05-31). Remaining: manual QA pass (non-Chicago studio), Notion date sync fix, P3 (Resend domain), merge `staging` → `main`. |

> Schema already supports **multiple owners per studio** and **multiple studios per owner** (`studio_users` is unique on `(studio_id, user_id)`). No migration needed for those.

---

## Prerequisites

| ID | Item | Status / Why |
|---|---|---|
| **P1** | ~~Supabase Pro + environment branching~~ | **Dropped — no longer needed.** The original plan required a Pro plan to branch Supabase auth config away from Vercel-live. Bypassed by: (a) adding `https://cadence-amls.netlify.app/auth/callback` + `https://staging--cadence-amls.netlify.app/auth/callback` to the Supabase redirect allowlist, and (b) deriving the invite `redirectTo` base URL from the incoming request `Origin` header so links stay on whichever deploy triggered the invite. Supabase Auth **Site URL** (`amls-dashboard.vercel.app`) is intentionally left unchanged — Vercel-live is unaffected. |
| **P2** | Custom invite email via Resend | **✅ Built.** `lib/email.ts` + the invite route use `auth.admin.generateLink({ type: 'invite' })` (creates user + token, no Supabase email) and send a branded Resend email; link = `{SITE_URL}/auth/callback?token_hash=…&type=invite`. No Supabase SMTP / Site URL touched, so Vercel-live is unaffected. From-address via `RESEND_FROM` env. |
| **P3** | Verified Resend sending domain | **Blocked.** Required to send invites to *arbitrary* recipients. Resend free plan allows only **1 domain, already used by another project.** Until resolved (paid Resend plan, or a dedicated domain / Resend account for Cadence), invites can only deliver to the Resend-account's own email via the `onboarding@resend.dev` test sender. |

Note: P1 dropped. P2 built. Only P3 (verified sending domain) blocks inviting arbitrary recipients. Both `RESEND_API_KEY` and `RESEND_FROM` must be set in **Netlify** env vars (not just `.env.local`) for the Netlify-hosted invite to send.

---

## Pending / To-do

Core invite → onboarding flow is **built and validated end-to-end** on `staging--cadence-amls.netlify.app` (2026-05-30). Remaining:

- [x] **Phase 5 — timezone threading:** ✅ DONE (2026-05-31, commit `95eae66` + edge-fn redeploys) — replaced hardcoded `America/Chicago` in `lib/date-utils.ts`, `lib/appointment-slots.ts`, `lib/ghl.ts`, and threaded studio tz through every consumer: calendar (week boundaries, grid, modals, date picker), call analytics (charts, presets, custom range), call history / quality / follow-ups, conversations (thread separators, chips, email card, message thread), leads, activity log, server actions (`rescheduleAppointment`, `createAppointment`, `fetchCallsAnalytics`), and the conversations API route. `studioMidnightFromStr` rewritten with offset-based math + DST self-correction (fixes east-of-UTC zones). Settings UI: tz pickers in Studios (create form + inline edit per row) and Business Profile. `updateStudio` role check fixed so super_admin is treated as global. Supabase Edge Functions redeployed via local MCP: `daily-call-review` v5 (per-studio yesterday-in-tz windows), `analyze-call-quality` v5 (same super_admin global auth fix).
- [x] **Existing-email invite branch:** ✅ DONE — `app/api/staff/invite/route.ts` now looks up existing users via `findUserByEmail` and skips Supabase's invite path: studio-less invite re-arms `role_intent`/`studio_setup_complete` + sends a "Sign in & set up studio" email; into-existing-studio just upserts the membership + sends a branded "you've been added" email. `lib/email.ts` gained `sendExistingOwnerNewStudioInvite` and `sendStudioMembershipNotification`.
- [x] **Settings → My Staff — multi-studio display:** ✅ DONE — `components/settings/my-staff-table.tsx` now groups rows by user (one expandable row per person, "N studios" badge, role summary like "Owner / Staff", expand to see + edit + remove per-studio memberships).
- [x] **Email template redesign:** ✅ DONE (2026-05-31) — UI/UX pass on `lib/email.ts` kept the original simple visual language (no header band, no eyebrow labels, no role pills, inline `▶ Watch this short walkthrough first` link, 480px card, 20px heading, 14px body, left-aligned CTA) and layered under-the-hood improvements: HTML-escaped all user-supplied strings (`esc()`), preheader snippet for inbox previews, plain-text alt body for deliverability + accessibility, explicit `font-family` on every text element (fixes default browser serif), `@media (max-width: 480px)` mobile breakpoint, `@media (prefers-color-scheme: dark)` overrides with `.cd-primary`/`.cd-secondary`/`.cd-muted` classes on every text element so dark-mode actually inverts (the previous templates only inverted the footer). Subject lines unchanged. All 5 templates (`sendStudioOwnerInvite`, `sendCoStaffInvite`, `sendExistingOwnerNewStudioInvite`, `sendStudioMembershipNotification`, `sendRoleChangedNotification`) rewritten through the shared shell. Loom URL placeholder retained per user decision. CTA hardened against an HTML-attribute quoting bug: font stack switched from `"Segoe UI"` to `'Segoe UI'` to avoid closing the inline `style=""` attribute prematurely (was silently stripping `color:#ffffff` and `text-decoration:none`, rendering buttons as underlined link-blue text).
- [x] **Phase 8 — internationalization:** ✅ DONE (2026-05-31, commit `5b9fd99`) — country/region/tz pickers + searchable `SimpleSelect`. New `lib/locale-data.ts` carries the full ISO 3166-1 alpha-2 country list (names via `Intl.DisplayNames`), curated subdivisions for the top 15 expected studio countries (US, CA, GB, AU, NZ, IE, PH, IN, MX, AE, JP, DE, FR, ES) with free-text fallback elsewhere, country→IANA tz mapping, and the full IANA list (~418 zones via `Intl.supportedValuesOf('timeZone')`) as fallback. `defaultTimezoneForCountryRegion` only auto-fills for single-tz countries to avoid wrong defaults. Wired into all three forms (onboarding step-business-profile, Settings → Studios, Settings → Business Profile) with identical UX: searchable country picker, country-aware region dropdown/free-text, country-filtered tz picker. Layout: country/region row above city/postal. Onboarding `*` markers added for the 5 server-required fields + country, Next button disabled on Business Profile step when country is blank.
- [ ] **P3 — verified Resend sending domain:** required to invite *any* address (not just the Resend-account email); blocked by the free-plan 1-domain limit.
- [ ] **Manual QA pass — non-Chicago studio:** end-to-end exercise of calendar, appointments, analytics presets, conversations, and follow-ups under a non-US tz to validate Phase 5 + 8 before merge. Highest regression risk; deferred from earlier in the build.
- [ ] **Notion ↔ Supabase date sync — tz boundary fix:** the date picker and `formatDateOnly` were made tz-aware (2026-06-01), but `lib/notion.ts` pre-dates Phase 5 and still uses `iso.slice(0, 10)` (which reads the UTC calendar date, not studio-tz). Day-boundary writes (e.g. "June 2 12 AM Manila" stored as `2026-06-01T16:00:00Z`) push to Notion as "June 1" and pull back as `2026-06-01T00:00:00Z` — silent off-by-one for any studio whose tz is not UTC. Senior-engineer audit (2026-06-01): only 2 critical sites in `lib/notion.ts` (`notionDateStart` at L42, `buildLeadUpdateFromPage` at L197-199) + 1 medium (the `to_char(... AT TIME ZONE 'UTC')` trigger in migrations 035/036 which writes UTC instants instead of `timestamptz`). No edge functions, no analytics queries, no other backend code groups by these fields. Recommended fix (per architect, 2026-06-01):
  1. Thread `studios.timezone` into `buildNotionProperties`, `syncOneNotionPageToSupabase`, and `syncNotionToSupabase` (`studios` is already fetched at L221/L257 — just widen the select).
  2. Push `last_contacted` as `YYYY-MM-DD` derived via `tzCalendarParts(iso, tz)` (replaces `iso.slice(0, 10)`).
  3. Push `first_lesson` as `{ start: iso, time_zone: tz }` so Notion preserves wall-clock display (Notion-pull is excluded for this field per existing client decision — Supabase-authoritative).
  4. Pull `last_contacted` via `studioMidnightFromStr(day, tz)` instead of constructing `day + 'T00:00:00.000Z'` (which is UTC midnight, off by hours).
  5. New migration **037** that replaces the trigger bodies in 035 + 036 — drop the `to_char(... AT TIME ZONE 'UTC')` and assign `NEW.created_at` directly as `timestamptz`. Forward-only; legacy rows unchanged.
  6. Update `lib/notion.test.ts:13-14` to parametrize on `tz` and assert studio-tz calendar day.
  7. Out-of-scope until requested: opt-in `/api/admin/normalize-lead-dates?studio_id=X` for ad-hoc backfill if any studio reports legacy drift. Architect estimates <5% of rows touched, day-boundary writes only.
  
  Storage contract (codified by architect, 2026-06-01): both columns stay `timestamptz`; `last_contacted` represents "studio-local midnight as UTC", `first_lesson` represents "studio-local wall-clock as UTC". `studios.timezone` is the single lens for read + write. No per-row tz column. No `date` migration.
- [ ] **Deploy — merge `staging` → `main`** on completion (production `cadence-amls.netlify.app` builds from `main`).
- [x] **Invite scenario matrix locked** — see "Invite Decision Matrix" below; covers a/b/c/d/e/f/g/h/i/j with the guardrails enforced in `app/api/staff/invite/route.ts`.
- [x] **Onboarding dedupe fix:** ✅ DONE (2026-05-31, commit `770324e`) — `onboardingDupeKey` no longer includes name; dedupes by `street_address + city + state + postal_code + country`. Without this, the wizard's "Duplicate location" button (which appends " (copy)" to the name) let unedited dupes slip through. Verified in prod by two `test meryel` rows that bypassed the check; cleaned up post-fix.

---

## Target Flow (brand-new client)

1. Super admin sends a **studio-less invite** to the new owner (Settings → My Staff).
2. Owner receives a branded email (Loom tutorial + "Set up your studio" CTA).
3. Owner accepts and sets a password (reuses existing `/accept-invite`).
4. Owner is redirected to `/onboarding` and completes the wizard (business profile + integration IDs + lead sources + calendar/schedule + timezone; supports multiple locations).
5. On submit: studio(s) created, owner linked, defaults seeded → session refreshed → redirect to `/leads`.

---

## Invite Decision Matrix

Locked behavior in `app/api/staff/invite/route.ts`. Labels (a–j) match the scenario log used during build. Full reference (request/response shapes, DB writes, email per scenario, decision tree): [`invite-scenarios.md`](./invite-scenarios.md).

| # | Email exists? | Studio target | Pre-existing membership | Result |
|---|---|---|---|---|
| a | New | Blank | — | Branded Resend invite → /accept-invite → /onboarding wizard → studio created |
| b | New | Existing studio | n/a | Supabase invite email → /accept-invite → studio_users row inserted → /leads |
| c | Existing | Blank | n/a | Metadata re-armed (`role_intent=studio_owner`, `studio_setup_complete=false`) → "Sign in & set up studio" email → /login → proxy redirects to /onboarding → studio created |
| d | Existing | Existing studio | Same role already | **No-op success.** Returns `{ ok:true, already:true }`. No email. UI shows "Already a member." |
| e/f | Existing | Existing studio | None | Membership upserted + branded "You've been added to {studio}" email. |
| i | Existing | Existing studio | Different role | **Requires confirmation.** Route returns 409 `{ requires_role_change_confirmation, current_role, new_role, studio_name }`. UI shows a modal; on confirm the client re-POSTs with `confirmRoleChange:true`, route updates `studio_users.role`, sends "Your role at {studio} changed" email. |

### Guardrails (also enforced)

| # | Case | Result |
|---|---|---|
| g | Inviter's own email | 400 — "You can't invite yourself." |
| h | Target studio is soft-deleted / non-existent | 400 — "Studio not found." |
| j | Race — two inviters hit the same brand-new email | Loser falls through to the existing-user path (c for blank, d/e/f/i for assigned) instead of erroring. |
| 1.6 | Non-super_admin attempting a blank-studio invite | 403 — "Only a super admin can invite a new studio owner." |
| 2.6/2.7 | Owner-of-A inviting into studio B / staff inviting at all | 403 — "Forbidden." |

Goals satisfied: a co-owner never fills the wizard; a returning owner is never re-onboarded; role changes via re-invite are explicit, not silent.

---

## Locked Decisions

| Decision | Choice |
|---|---|
| Studio creation timing | Owner creates on wizard submit |
| Integration IDs (GHL/Retell) | Client fills everything (with help text + validation; never logged) |
| Timezone | New `timezone` column; **hybrid picker** — auto-suggest from state/address → browser TZ fallback → owner can override |
| Multi-studio | "Add another location" + "Duplicate to edit"; submit blocked if two studios share **name + address** |
| Lead source defaults | Website form, Facebook, Email, Walk-in (editable) |
| Additional studios (existing owner) | Covered by scenario c (super_admin re-invites existing email with blank studio → owner lands on `/onboarding` wizard). Settings → Studios stays as the super_admin quick-create form. Full wizard in Settings de-scoped — see Phase 6. |
| Existing email + blank studio | Blocked with guidance message |

---

## Build Breakdown

### Phase 1 — Database ✅ DONE
- Migration 033 added `timezone text not null default 'America/Chicago'` on `studios` + the corresponding `lib/types.ts` Studio type field.
- Default source set refreshed (Website Form, Facebook, Email, Walk-in) and the Guest/Guests + Event/Events singular-plural mismatch resolved.
- `seed_studio_field_options(studio_id)` RPC is now called by `completeStudioOnboarding` (wizard path) and `createStudio` (Settings path — added 2026-06-01, commit `a1f54e8`). Lead views auto-seed via the existing `AFTER INSERT ON studios` trigger.

### Phase 2 — Invite path (`app/api/staff/invite/route.ts` + My Staff) ✅ DONE
- `studioId` is optional; blank-studio invites set `{ role_intent: 'studio_owner', studio_setup_complete: false }` metadata and create no `studio_users` row.
- Existing-email branch implemented via `findUserByEmail` — short-circuits Supabase's `inviteUserByEmail`, upserts membership directly, sends the appropriate branded email per scenario.
- Full a/b/c/d/e/f/g/h/i/j scenario matrix locked — see Invite Decision Matrix below.
- My Staff UI groups members by user (one row per person + expandable per-studio rows), shows "N studios" badge + role summary, and adds the "New studio (blank)" option in the studio dropdown for super_admin. Inline role-change dropdown now sends `sendRoleChangedNotification` (commit `192d94c`). Studio filter added 2026-06-01 (commit `033f044`).
- **Destructive-action rules tightened 2026-06-01 (commit `cf8c2f0`):** `deleteStudio` is super_admin-only (the trash icon in `Settings → Studios` is hidden for studio_owner). Removing a staff member's last membership no longer auto-deletes the auth account — orphans land on `/no-access` instead. Removing a `studio_owner` shows a "Remove a co-owner?" warning modal (UX speed-bump; server-side still allowed for studio_owner-on-studio_owner). Full matrix in `rules/authentication.md` § "Destructive Actions".

### Phase 3 — Onboarding wizard + server action ✅ DONE
- `/onboarding` route live in its own minimal layout — 4 steps per location: Business Profile, Integrations, Lead Sources, Schedule.
- Multi-location support via "+ Add another location" + "Duplicate location" (the latter appends `(copy)` to the name; address-only dedupe key catches dupes regardless — commit `770324e`).
- `completeStudioOnboarding` server action verifies `role_intent === 'studio_owner'` + `studio_setup_complete === false` (or super_admin), validates required fields + address uniqueness (within submission + against existing studios), inserts each studio, links owner as `studio_owner`, calls `seed_studio_field_options` + `seed_studio_sources`, writes calendar config + timezone, and flips `studio_setup_complete: true` via `admin.updateUserById`. Returns `{ error }` for validation failures (instead of throwing) so Next.js doesn't mask the message in production (commit `192d94c`).

### Phase 4 — Routing / gating ✅ DONE
- `proxy.ts:61-65` redirects users with `studio_setup_complete === false` to `/onboarding` and allows the `/onboarding` path itself.
- `app/(auth)/accept-invite/page.tsx:49-50` routes `role_intent === 'studio_owner'` invitees (blank-studio path) to `/onboarding`; all other accepted invites land on `/leads`.
- `app/(auth)/onboarding/page.tsx:149-150` calls `supabase.auth.refreshSession()` after the metadata flips so the proxy doesn't bounce the user back to `/onboarding` with a stale JWT.

### Phase 5 — Timezone threading (regression risk) ✅ DONE 2026-05-31
- Replaced hardcoded `'America/Chicago'` across `lib/date-utils.ts`, `lib/appointment-slots.ts`, `lib/ghl.ts` and threaded studio tz through every consumer (calendar, analytics, conversations, server actions, conversations API route). `studioMidnightFromStr` rewritten with offset-based math + DST self-correction.
- Settings UI: tz pickers added to **Settings → Studios** (create form + inline edit-tz dropdown per row) and **Settings → Business Profile**.
- Server actions: `createStudio` + `updateStudio` accept `timezone`. `updateStudio` role check fixed so super_admin is treated as global (per-studio query was rejecting super_admins on studios where they had no `studio_users` row).
- Supabase Edge Functions redeployed via local MCP — `daily-call-review` v5 (per-studio yesterday-in-tz window + wide-UTC fetch + per-call filter), `analyze-call-quality` v5 (same super_admin global auth fix).
- Commits: `95eae66` (tz threading) + `770324e` (onboarding dedupe fix).
- **Manual QA pass deferred** — see Pending / To-do list at the top.

### Phase 6 — Reuse wizard in Settings ⏭ DE-SCOPED 2026-06-01
- **Original intent:** Settings → Studios → "Add studio" opens the same multi-step wizard (minus account/password) so existing owners get fully-configured additional studios.
- **Why de-scoped:** the existing-owner-adds-studio case is already covered end-to-end by **scenario c** of the invite matrix — super_admin invites an existing email with blank-studio → owner gets the "Set up another studio" email → lands on `/onboarding` → walks the full wizard. The Settings → Studios form remains for **super_admin quick-create** (single page, basic fields, lead sources + calendar config can be filled in afterward).
- **Re-open trigger:** if super_admins start consistently needing the full rich-creation experience for direct provisioning (not via invite), wire the wizard as an "Open setup wizard" inline modal from Settings → Studios. Estimated 1-2 days.

### Phase 7 — QA 🟡 IN PROGRESS
- ✅ Invite scenario matrix verified end-to-end (a/b/c/d/e/f/g/h/i/j locked in `app/api/staff/invite/route.ts`).
- ✅ RLS isolation across studios — fixed three pattern-repeating gaps (`updateStudio`, `update-role`, `analyze-call-quality`) + the studio_field_options client fetch (commit `a1f54e8`) so super_admin gets the service client for cross-studio reads.
- ✅ No `(app)` layout dead-end after onboarding submit — JWT-refresh + redirect to `/leads` is wired.
- ✅ Multi-studio name+address uniqueness — dedupe key is now address-only (commit `770324e`); the wizard's "Duplicate location" path catches identical addresses.
- ✅ Post-fix re-verification (see `docs/qa/client-onboarding-qa.md` — 5 bugs from QA pass all retested green on commit `192d94c`).
- 🟡 **Manual QA pass under a non-Chicago studio** — calendar / appointments / analytics presets / conversations / follow-ups exercised end-to-end against a studio with `timezone != 'America/Chicago'`. Highest regression risk; the rest of the §1–§6 checklist in `docs/qa/client-onboarding-qa.md` is the merge gate.
- ✅ Dark mode pass on the wizard — verified 2026-06-01. Wizard renders correctly in dark mode (inherits the same tokens / `next-themes` provider as the rest of the app).

### Phase 8 — Internationalization (worldwide studios) ✅ DONE 2026-05-31
- **Country**: full ISO 3166-1 alpha-2 list, names via `Intl.DisplayNames`, searchable `SimpleSelect` (new `searchable` prop).
- **Region**: country-aware dropdown for top 15 expected studio countries (US, CA, GB, AU, NZ, IE, PH, IN, MX, AE, JP, DE, FR, ES); free-text input for everywhere else. Label adapts ("State", "Province", "Prefecture", "Emirate", …).
- **Timezone**: country-filtered IANA list when a curated mapping exists; otherwise the full IANA list (~418 zones) via `Intl.supportedValuesOf('timeZone')`. `defaultTimezoneForCountryRegion` only auto-fills for single-tz countries to avoid wrong defaults.
- Data shipped via hand-built `lib/locale-data.ts` (~5 KB) — no npm dependency.
- Wired into all three forms with identical UX: onboarding `step-business-profile`, Settings → Studios, Settings → Business Profile. Layout: country/region row above city/postal.
- Onboarding `*` markers added for the 5 server-required fields + country; Next button disabled on the Business Profile step when country is blank.
- Storage convention unchanged: we still write display labels (`"United States"`, `"Illinois"`, `"America/Chicago"`) so existing rows render in the new dropdowns with no migration.
- Commit: `5b9fd99`.

**Open follow-ups** (not blocking client onboarding):
- Subdivisions beyond the top 15 countries — free-text covers them for now; extend `lib/locale-data.ts` when a studio in a long-tail country needs the dropdown.
- Per-row tz formatting in Settings → Activity Log for super_admin viewing rows from multiple studios (cosmetic; defensible UX).
- Country-specific postal-code validation (none today).

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
