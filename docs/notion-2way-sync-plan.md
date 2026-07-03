# Notion ↔ Supabase 2-Way Lead Sync — Plan & Draft Design

> **Status:** DRAFT / planning only. No code written, no data migrated. For review before any implementation.
> **Author:** Claude (with Joshua)
> **Last updated:** 2026-05-30
> **Scope studio (phase 1):** Arthur Murray Lincolnshire (AMLS) — `studio_id = 71274499-7c29-4621-990f-b60669ed1de3`
> **Notion leads DB (Lincolnshire):** `d7c79e10b0fc4553903cec554bc0a1f5`

---

## 0. TL;DR

Keep the **app (Supabase) as the system of record**. Build a server-side sync service that:
1. Mirrors app edits → Notion (create/update/archive).
2. Mirrors Notion edits → app (via webhook if available, else polling).
3. Prevents echo loops, resolves conflicts by last-write-wins (timestamp), and never lets the browser touch Notion directly.

Prerequisite work (separate, already discussed): **(a) align dropdown option values** between app and Notion, **(b) one-time import** of Notion's correct values into Supabase. The import IS the sync's initial backfill.

⚠️ This entire effort runs on **real client lead PII**. Every data write is diff-reviewed and approved before it runs. No record deletions by the implementer. (See `memory/notion_sync_safety.md`.)

---

## 1. Goals & non-goals

### Goals
- A lead edited in the app reflects in Notion, and vice-versa, within a small delay.
- The app remains authoritative; Notion is a synced mirror that staff may also edit.
- Multi-studio ready (Lincolnshire first; Schaumburg + future studios reuse the same engine, one DB per studio).
- Safe: no data loss, no infinite loops, no PII leakage, reversible.

### Non-goals (for now)
- Real-time (<1s) sync. Near-real-time (seconds–minutes) is fine.
- Syncing computed/analytics fields, calls, conversations, or appointments to Notion.
- Letting Notion become the source of truth.
- Two-way sync for studios without an aligned Notion DB.

---

## 2. Current constraints (from the codebase)

- **Browser never calls Notion.** All Notion API calls live in `app/api/` routes / server actions using server-side env vars (same hard rule as GHL/Retell). See `rules/architecture.md`.
- Leads already sync **app → GHL** on create/update/delete (`app/actions.ts`: `createLead`, `updateLead`, `deleteLeads`). Notion becomes a *second* downstream of the app, not a peer of GHL.
- Enum fields (`status`, `level`, `action`, `source`, `reason`, `partnership`) are stored as **FK UUIDs** into `studio_field_options`; the value must exist there before a sync write can set it. → **option alignment is a hard prerequisite.**
- Supabase Realtime already drives the leads table UI; sync-originated DB writes will surface in the UI automatically (good), which is also why **loop/echo suppression** matters.

---

## 3. Field mapping (Notion ↔ Supabase)

Derived from the Lincolnshire CSV export header:
`Created time, Name, Status, Property, Action, Phone, Last Contacted, First Lesson, Comments, Source, Texted, Email, Reason, Available, Showed, Bought, Partnership, OLD`

| Notion property | Notion type (to confirm via API) | Supabase column | Type | Sync? | Notes |
|---|---|---|---|---|---|
| Created time | created_time | `created_at` | timestamptz | ⬅️ read-only | Notion auto-managed; never write. |
| Name | title | `name` | text | ↔ | Also GHL-synced. |
| Status | select/status | `status` | FK→option | ↔ | Must align options first. |
| **Property** | select | `level` | FK→option | ↔ | ⚠️ Notion column is named **"Property"**, app calls it **Level**. |
| Action | select | `action` | FK→option | ↔ | Align options. |
| Phone | phone_number | `phone` | text | ↔ | Also GHL-synced. Normalize E.164. |
| Last Contacted | date | `last_contacted` | timestamptz | ↔ | GHL cannot set this; Notion can. |
| First Lesson | date | `first_lesson` | timestamptz | ↔ | |
| Comments | rich_text | `comments` | text | ↔ | |
| Source | select | `source` | FK→option | ↔ | Align options. |
| **Texted** | checkbox/select (Yes/No) | *(none yet)* | — | ❓ decision | App has no `texted` field. Options: (a) add `leads.texted boolean`, (b) ignore, (c) map to an existing field. **Client decision.** |
| Email | email | `email` | text | ↔ | Also GHL-synced. |
| Reason | select | `reason` | FK→option | ↔ | Align options. |
| Available | select / rich_text | `available` | text | ↔ | ⚠️ Messy in Notion (free-text + combined values like `justForFun, Daytime` in old rows). Treat as text; do not enum-ify without cleanup. |
| Showed | checkbox | `showed` | boolean | ↔ | |
| Bought | checkbox | `bought` | boolean | ↔ | |
| Partnership | select | `partnership` | FK→option | ↔ | Couple/Single. |
| OLD | checkbox | `old` | boolean | ↔ | |
| — | (page id) | `notion_page_id` | text | internal | NEW column, the link key. |

**Open mapping questions:**
- `Texted` — add a column or drop it? (see decision list §13)
- `Available` — keep as free text both ways, or normalize? Recommend: free text, no enum.
- Which side wins on `created_at`? Notion's `Created time` is authoritative-display only; app keeps its own `created_at`. They will differ for historical rows — acceptable, don't sync.

---

## 3.1 ⚠️ Per-field source of truth — Notion is NOT authoritative for everything

**Discovered 2026-05-30 (Katie McBain):** Notion `Action = "Scheduled"`, Supabase `Action = "Did Not Answer"`, but the `calls` record shows the single outbound call only **reached voicemail** (`disconnected_reason = voicemail_reached`, `voicemail = true`, 3s, no appointment). Notion was **wrong**; Supabase was closer. This breaks the assumption that "Notion has the correct values" — it's only true for *some* fields.

Fields do not share one source of truth:

| Field group | Authoritative source | Why |
|---|---|---|
| **Call-derived**: `action` (esp.), arguably `last_contacted`, some `status` transitions | the **`calls` table** (Retell outcomes), surfaced via app automation | These reflect what objectively happened on AI calls. Notion is hand-edited and drifts; even Supabase can lag, but it's fed from call outcomes so it's usually closer. |
| **Human-owned**: `comments`, `reason`, `available`, `first_lesson`, `partnership`, name corrections | whoever edited last (app or Notion) | Genuine human judgment; last-write-wins is fine. |
| **GHL-owned/shared**: `name`, `phone`, `email` | app ↔ GHL | Already synced; Notion joins as a mirror. |

**Implications for the import (phase B) and sync:**
- The one-time import must **NOT blindly overwrite Supabase with Notion** for call-derived fields. For `action`, the reconciliation is **3-way** (Notion vs Supabase vs `calls`), and **call-derived truth wins** — or, where ambiguous, the row is surfaced for review, not auto-written.
- Going forward, treat call-derived fields as **system-owned**: a Notion edit to `Action` should be synced into the app cautiously (or flagged), because the automation may legitimately overwrite it after the next call. Otherwise a stale Notion "Scheduled" would clobber the call-accurate value.
- Net: **source-of-truth is per-field, not per-system.** The plan's "app is the system of record" still holds for the *app↔Notion mirror*, but the *origin of truth* for call-derived fields is the call log feeding the app.

This likely means a pre-import **audit query**: for every lead with call records, compare stored `action` against the call outcome and against Notion, and produce a 3-way conflict report before deciding any write.

---

## 3.2 ~~Call Result → `action` mapping~~ — ⛔ SUPERSEDED 2026-05-30

> **RETIRED by client direction (2026-05-30):** The client **manually maintains `Action` in Notion** and treats Notion's value as truth. `Action` is therefore **Notion-authoritative for ALL leads** (like `status`/`level`) — **not** call-derived. The call-result mapping below is kept for history only and is no longer used. The 10 call-derived values previously applied were re-reconciled to Notion's value (see §3.5). The `last_contacted`-from-calls trigger (migration 035) is unaffected and remains active.

### (historical) Call Result → `action` mapping (APPROVED 2026-05-30, later retired)

The Call History **Result** column is computed by `getCallResult()` in `components/call-history/call-history-shell.tsx` (priority-ordered: connection-level outcomes → booking outcome → hangup labels). `voicemail_left` is NOT stored — it's derived at fetch time (`app/actions.ts` ~line 1573) by a transcript heuristic: agent speech ≥ 100 chars **AND** call duration ≥ 10s.

Approved mapping from Result → Lincolnshire `action` option (studio_field_options, `studio_id 71274499-7c29-4621-990f-b60669ed1de3`):

| Call Result | → `action` | option id |
|---|---|---|
| Booked / booked on any call (`ever_booked`) | **Scheduled** | `45ae1854-5c9c-4870-958b-43b747eb3344` |
| Callback Requested | **Call Back** | `6448eb05-2248-4c2f-98a7-764a8fa1d26c` |
| Voicemail Reached (no message left) | **Did Not Answer** | `6db17249-ac95-4aa2-a0d3-5cf9a2a36fad` |
| Left Voicemail (message left) | **AI Called** | `16b9148a-d605-4be9-a460-2c11b770f26e` |
| Did Not Pick Up / Busy | **Did Not Answer** | `6db17249-…` |
| Booking Attempted | **AI Called** | `16b9148a-…` |
| User Hung Up / Agent Hung Up / Inactivity / Transferred | **AI Called** | `16b9148a-…` |
| IVR Reached | **Other** | `ea59aaea-95e1-4ae3-a201-b23396f60550` |
| Pending Review | **Other** | `ea59aaea-…` |

Notes:
- `Left Message` (`c6364acc-…`) and `NO VOICEMAIL` (`9d73dd9c-…`) are intentionally **unused** by the auto-mapping (client preference: a left voicemail counts as "AI Called"; reaching voicemail with no message counts as "Did Not Answer").
- Mapping is applied off the **latest** call per lead, except booking which uses `ever_booked` (any call that booked → Scheduled).
- **Scope:** only the **29 Lincolnshire leads that have linked calls** (`calls.lead_id`). The other ~1,766 leads have **no AI call** to derive from — they are entirely out of scope for this call-based reconciliation (their `action` is Notion/manual-owned and only touched, if at all, by the separate phase-B Notion import).

**Audit result (read-only, 2026-05-30):** of the 29, **18 already match**, **10 would change**, and **1 (`John Test`) is excluded** as a test record. The 10 changes break down: 4 → AI Called (Andrew, Heather, Isabel [empty], Sofia), 3 → Other (Christopher, Silver Mendoza, Vladyslav), 2 → Call Back (Cristobal, Tatiana), 1 → Did Not Answer (James Potempa). The 11 voicemail leads were already `Did Not Answer`, so they don't change. **Katie McBain** stays **Did Not Answer** (latest call reached voicemail, no substantive message) — still confirms call log > Notion's "Scheduled".

**Not yet applied.** Any write will be a backup-first, diff-approved, idempotent update scoped to these lead ids only — never a blind bulk overwrite.

---

## 3.3 Status & Level reconciliation — Notion-authoritative (decided 2026-05-30)

Unlike `action`, the **`status`** and **`level`** fields are **NOT call-derived**. Decision: **Notion is the source of truth** for these two — where Notion and Supabase disagree, **Notion wins** and Supabase is updated to the Notion value.

- Comparison is **Notion vs Supabase only** (the `calls` table is irrelevant here).
- Notion's **Level** column is the unnamed select (property title is empty string `""`) — map by property **id**, not name.
- **Prerequisite (Phase A):** every Notion option value must already exist in `studio_field_options` for that field, else the FK write fails. So an **option-set alignment check** runs first; any Notion value missing in Supabase is reported (add the option, or map it) before any lead write.
- Same safety envelope as §3.2: read-only audit → reviewed diff → backup-first → idempotent, scoped write. Not applied yet.

## 3.4 2-way sync edit semantics — explicit edit wins & propagates (decided 2026-05-30)

An explicit admin edit to a synced field **propagates to the other system and overwrites whatever was there**, regardless of prior divergence.

Example (resolves §13 Q2): Notion `Action = Scheduled`, Supabase `Action = Call Back`. Admin edits it to **Other** (in either app or Notion) → **both** Notion and Supabase become **Other**. The edit is the new truth; the pre-existing mismatch is discarded.

- This is **last-write-wins keyed on the explicit human edit**, applied per-field.
- Caveat for **call-derived fields** (§3.1/§3.2): a *human* edit still wins and propagates, but the call automation may legitimately re-set `action` after the *next* call. The automation only overwrites when the stored value is still a call-derived default — never a value a human just set (tracked via edit source/timestamp). Human edit > stale automation; new call outcome > stale human default — resolved by recency + source.
- One-time reconciliation (§3.2/§3.3) is the *initial* alignment; §3.4 governs *ongoing* edits after sync is live.

---

## 3.5 ✅ Action — Notion-authoritative reconciliation APPLIED (2026-05-30)

Client treats Notion `Action` as the source of truth (they hand-edit it). So `Action` joins `status`/`level` as **Notion-authoritative for all leads**; call history no longer influences it.

- Re-reconciled `Action` = Notion's value for all linked leads (keyed on `notion_page_id`): **29 leads changed**, including reverting the 10 earlier call-derived values to Notion's value. Verified: **0 remaining differences**.
- Script: `scripts/notion-action-reconcile.mjs` (dry-run default, `--apply`). Rollback: `.notion-audit/action-reconcile-plan.json` holds each lead's prior `action` UUID.
- **Ongoing rule (for sync S1/S2):** an explicit edit in the Leads page writes the new value to **both** Supabase and Notion (§3.4). The Leads page displays Notion's value because Supabase is kept in lockstep with Notion. No app UI code referenced call history for Action — nothing to remove there.

---

## 4. Data-quality findings from the export (affect import, not sync mechanics)

These are flagged now so they're handled during the one-time import, not silently synced:
- **Corrupted phone/email cells**: many rows have `https://app.notion.com` prepended to phone numbers and emails (export artifact). Must strip before matching/import.
- **Non-person "Name" values**: some names are `http://amls.floatingrain.com/public/customer/enquiry/...` URLs — these are malformed leads. Flag, don't auto-create.
- **Spam/solicitation rows** (SEO spam, "Jason Taken" buyer solicitation, etc.) exist in the data — out of scope to clean, but note for the client.
- **Phone formats vary wildly** (international, `(847) ...`, leading `1`, UK `07...`, `0000000000`, `5555555555`). Normalize to E.164 where possible; leave un-parseable as-is.
- **Empty/blank rows** exist (e.g. `May 2, 2025 4:59 AM` with no name). Skip on import.

→ The import (phase B) produces a **review report** listing every such anomaly; nothing is created/updated until approved.

---

## 5. Architecture

```
                ┌─────────────────────────────┐
   App UI ──────▶  Server Actions / API routes  │
 (browser)      │  (app/actions.ts, app/api/)   │
                │                               │
                │   writes Supabase  ──────────────▶  Supabase (source of truth)
                │   then enqueues Notion write  │            │
                │                               │            │ Realtime
                │   Notion API (server-side) ◀──┘            ▼
                │        ▲   │                            App UI updates
                │        │   ▼
                │   ┌────────────────┐
 Notion  ───────────▶  Notion webhook │  /api/webhooks/notion-lead
 (staff edits)  │   │  OR poller      │  → resolve link → write Supabase
                └───┴────────────────┘
```

- **App is the hub.** App → GHL and App → Notion are independent downstreams. Notion → App writes go through the app's normal lead-update path so GHL stays in sync transitively.
- All Notion calls are **server-side only**.

---

## 6. Schema changes (new migration, not yet applied)

```sql
-- supabase/migrations/NNN_notion_sync.sql  (DRAFT — do not apply yet)

-- Per-studio Notion DB id (token stays in env NOTION_API_KEY)
alter table studios add column if not exists notion_leads_db_id text;

-- Link + sync bookkeeping on leads
alter table leads add column if not exists notion_page_id text;
alter table leads add column if not exists notion_last_synced_at timestamptz;
alter table leads add column if not exists notion_last_edited_time timestamptz; -- mirror of Notion's last_edited_time for conflict checks

create unique index if not exists leads_notion_page_id_key
  on leads (notion_page_id) where notion_page_id is not null;

-- (optional) sync audit/outbox for retries + observability
create table if not exists notion_sync_log (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id),
  lead_id uuid references leads(id),
  notion_page_id text,
  direction text not null check (direction in ('app_to_notion','notion_to_app')),
  action text not null check (action in ('create','update','archive','skip','error')),
  detail jsonb,
  created_at timestamptz not null default now()
);
```

RLS: `notion_sync_log` scoped by `studio_id` like every other table. `studios.notion_leads_db_id` readable only server-side / by super_admin + owner.

---

## 7. Linking & initial backfill (phase B)

1. **Pull** all Notion pages for the Lincolnshire DB (paginate, 100/page).
2. **Match** each Notion page to a Supabase lead, in priority order:
   - existing `ghl_contact_id`/known id (none from Notion) → fall through
   - normalized **phone** exact match
   - **email** exact match (case-insensitive)
   - fuzzy **name + (phone OR email)** as a last resort, flagged for manual confirm
3. **Write** `notion_page_id` (+ `notion_last_edited_time`) onto the matched lead.
4. **Unmatched Notion pages** → report (candidate new leads, or junk URLs/spam → skip).
5. **Unmatched Supabase leads** → report (exist in app, missing from Notion → optionally create in Notion later).
6. Reconcile drifted enum values (Status/Property→Level/Action/…) Notion→Supabase **as a reviewed diff** (this is the "fix the misalignment" task).

Everything in phase B is **report-first, apply-after-approval**, in small batches, with a pre-write backup of affected columns.

---

## 8. Sync directions & triggers

### 8.1 App → Notion
- Hook into existing server actions (`updateLead`, `createLead`, `deleteLeads`, `bulkUpdateLeads`).
- After the Supabase write succeeds, enqueue a Notion write (create page if no `notion_page_id`, else PATCH page; archive on delete).
- Map enum UUID → option value → Notion select option name. If the Notion select option doesn't exist yet, that's an alignment gap → log + skip that field (don't crash).
- Mark the write as app-originated for echo suppression (see §9).

### 8.2 Notion → App
- **Preferred: Notion webhooks** (if the workspace/integration supports them). Subscribe to page property/content change + page deleted/restored events for the DB. Verify the webhook signature/secret (same pattern as GHL/Retell webhook secret validation).
- **Fallback: polling.** Every N minutes, query the DB sorted by `last_edited_time desc`, page until `last_edited_time <= max(notion_last_edited_time we've seen)`. Cheap, robust, no webhook dependency.
- On change: resolve `notion_page_id` → lead, map properties → columns, write via the normal app update path (so GHL stays in sync), update `notion_last_edited_time`.
- New Notion page with no matching lead → create lead in app (configurable; default ON so new Notion inquiries flow in).

**Recommendation:** ship polling first (deterministic, no external dependency), add webhooks later if low latency is needed. To confirm at design time: whether this Notion workspace exposes webhooks at all.

---

## 9. Loop / echo prevention

The classic failure: app writes Notion → Notion fires change → app writes Notion again → ∞.

Strategy (mirrors the leads-table Realtime echo suppression already in the codebase):
- Track the **last value we wrote** + **timestamp** per `(lead, source)`.
- On an inbound Notion change, compare Notion's `last_edited_time` and the field values to what we last pushed. If they match what we just wrote (within a small window), **drop it** (it's our own echo).
- Symmetrically, when applying a Notion→app change, set a short-lived "suppress app→Notion for this lead" guard so the resulting Supabase write doesn't bounce back.
- `notion_sync_log` records every decision (`skip` with reason) for debugging.

This is the single highest-risk area; it gets dedicated tests and a kill-switch.

---

## 10. Conflict resolution

- Default: **last-write-wins by timestamp** — compare app `updated_at` vs Notion `last_edited_time`; newer wins per-field where possible, else per-record.
- Edge: simultaneous edits within the sync window → the later-arriving writer wins; log the overwrite to `notion_sync_log` so it's auditable.
- **Client must confirm** last-write-wins is acceptable (vs. app-always-wins). See §13.

---

## 11. Delete handling

- **App delete** → archive the Notion page (`archived: true`), not hard-delete. Logged.
- **Notion archive/delete** → per our no-silent-deletion rule, **do NOT hard-delete the app lead**. Options: (a) flag the lead (e.g. a `notion_archived_at`), (b) surface for manual review. Default: flag + surface, never auto-remove. **Client decision** on whether a Notion delete should remove from app.

---

## 12. Rate limits, batching, reliability

- Notion API ≈ **3 requests/sec** per integration. A bulk update of 100 leads must **queue + throttle**, not fire 100 parallel calls.
- Use a small server-side queue/outbox (`notion_sync_log` or a dedicated table) with retry + backoff on 429/5xx.
- Idempotency: writes keyed by `notion_page_id`; re-running a failed batch is safe.
- Observability: every sync action logged; a simple admin view can show recent failures.

---

## 13. Open questions for the client (gate implementation) — ANSWERED 2026-05-30

1. **System of record** — ✅ app/Supabase.
2. **Conflict rule** — ✅ explicit edit wins & propagates both ways (last-write-wins on the human edit). See §3.4.
3. **Notion delete → app** — ✅ flag as archived (`leads.notion_archived_at`), never hard-delete.
4. **`Texted` column** — ⏳ still open (add `leads.texted`, ignore, or map). Not needed for reconciliation; revisit at sync build.
5. **`Available`** — ✅ keep as free text (data mixes time + reason + notes; un-normalizable without a cleanup project).
6. **New Notion inquiry → auto-create app lead?** — ✅ yes, with dedup (notion_page_id + phone + email + unique index).
7. **Webhooks vs polling** — ✅ webhooks for Notion→app (set up post-deploy against the live URL), polling as safety net.
8. **Sync latency target** — ✅ near-real-time (few seconds): app→Notion instant on save; Notion→app via webhooks.
9. **Per-field source of truth (§3.1)** — ✅ call log wins for call-derived `action` (call-linked leads); Notion-authoritative for `status`/`level`/`action` on call-less leads.

---

## 13.1 ✅ One-time reconciliation APPLIED (2026-05-30)

The full one-time alignment was applied to Supabase (Notion unchanged — read-only). Backup taken first to `.notion-audit/backup-leads-20260530.json` (1,795 leads). Rollback: `node scripts/restore-leads-snapshot.mjs --apply`.

| Step | Change | Rows |
|---|---|---|
| 1 | Contact cleanup — stripped `https://www.notion.so` prefix from phone/email | 453 phones + 437 emails (466 leads) |
| 2 | Action (call-linked) → call-result mapping | 10 |
| 3 | Action (call-less) → Notion value | 30 |
| 4 | Status → Notion value | 23 |
| 5 | Level → Notion value | 30 |

Scripts: `scripts/notion-reconcile-audit.mjs` (read-only audit), `scripts/apply-reconcile.mjs` (steps 1/3/4/5), step 2 via SQL. 549 rows logged to `notion_sync_log`. Verified: 0 corrupted contacts remain; spot-checks pass. **NOT done:** 95 unmatched Notion pages (new-lead candidates) + 63 unmatched Supabase leads — deferred to the sync-engine phase.

---

## 14. Phased rollout

| Phase | What | Data risk | Gate |
|---|---|---|---|
| **0** | Confirm Notion API access (owner token), read DB schema (property types), confirm webhook availability | none (read-only) | token from owner |
| **A** | Align `studio_field_options` to Notion options (migration) | low (option rows) | diff review |
| **B** | One-time Notion→Supabase value import (+ link `notion_page_id`) | **high** (lead PII) | backup + diff approval, small batches |
| **C** | App→Notion sync (one direction), behind a feature flag, dry-run logging first | medium | staging/flagged |
| **D** | Notion→App sync (polling), echo suppression, conflict rules | medium | staging/flagged |
| **E** | Webhooks (optional), delete handling, multi-studio rollout | medium | per studio |

Each phase ships independently; B is the one that fixes the immediate misalignment.

---

## 15. Risks

- **Echo loops** — mitigated by suppression + kill-switch + logging (§9).
- **Option drift** — a Notion option missing in Supabase (or vice-versa) silently drops a field. Mitigation: alignment first + log skips, never crash.
- **Notion API limits** — bulk ops throttled/queued (§12).
- **Data-quality noise** (§4) — handled in import report, not auto-synced.
- **Token scope** — owner-created integration only sees DBs explicitly shared; if a studio's DB isn't connected, that studio silently no-ops (logged).
- **PII** — server-side only, token in env, `.env` gitignored, no logs of full PII bodies.

---

## 16. What this plan does NOT do yet

- No migration applied, no `notion_page_id` written, no Supabase values changed.
- No Notion calls made.
- No feature flag/route created.

Next step after review: get the owner's Notion integration token (phase 0), then start phase A (option alignment) with a reviewed migration.
