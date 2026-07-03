# Notion ↔ Supabase Sync — Build Log

> Full record of the Notion 2-way sync build (sessions 2026-05-30 → 2026-05-31).
> Companion to `docs/notion-2way-sync-plan.md` (design) and `docs/notion-sync-build-plan.md` (phased plan).
> **Last updated:** 2026-05-31

---

## 0. Current status (TL;DR)

- **App → Notion (S1):** built, deployed (staging), wired into lead save actions. Validated in **log mode** (correct payload confirmed on a real edit — "Silver Mendoza" Action → produced `{Action:{select:{name:"NO SHOW"}}}`). Not yet exercised with a real live write, but live-capable.
- **Notion → App (S2):** built, deployed (staging). **One-time backlog applied live.** Automatic via **5-min polling cron** (timeout FIXED — see §4) + a **webhook receiver** (✅ PROVEN LIVE 2026-06-01 — real Notion edits sync within seconds; see §5). Signature verification not yet switched on.
- **Mode:** gated by env `NOTION_SYNC_MODE` = `off | log | live`. Staging is **live**.
- **HARD RULE:** Claude is **read-only on Notion** (never writes/PATCHes Notion); the *app's* 2-way functionality (incl. app→Notion writes) is intended and stays. See `memory/notion_claude_readonly.md`.

---

## 1. What was built

### Code
- **`lib/notion.ts`** — server-side Notion client (browser never calls Notion):
  - `notionSyncMode()` — reads `NOTION_SYNC_MODE` (`off`/`log`/`live`).
  - **App→Notion:** `syncLeadUpdateToNotion`, `syncLeadCreateToNotion`, `syncLeadArchiveToNotion` (PATCH / create / archive page). Enum UUIDs resolved to option labels before sending.
  - **Notion→App:** `syncNotionToSupabase` (bulk pull) + `syncOneNotionPageToSupabase` (single page, for webhook). Echo suppression = **value comparison** + writes go **direct to the leads table** (never re-trigger app→Notion). Batched sync-log inserts.
  - `buildNotionProperties` (app→Notion) + `buildLeadUpdateFromPage` (Notion→app) — the field mappers.
- **`app/actions.ts`** — hooked `updateLead`, `createLead`, `deleteLeads`, `bulkUpdateLeads` to push to the linked Notion page after the Supabase write. Added `resolveNotionFields` helper (enum UUID → label). Added `texted` to updatable field sets.
- **`app/api/notion-sync/route.ts`** — polling entrypoint, `POST`, protected by `CRON_SECRET`. Runs `syncNotionToSupabase` for every studio with a linked Notion DB.
- **`app/api/webhooks/notion/route.ts`** — webhook receiver: verification handshake (captures token), HMAC signature check (skipped until `NOTION_WEBHOOK_SECRET` set), then `syncOneNotionPageToSupabase`. Returns 200 to avoid Notion retries.
- **`proxy.ts`** — allowlisted `/api/notion-sync` + `/api/webhooks` for unauthenticated (secret-checked) access (else proxy 307-redirects them to /login).

### Field mapping (Notion property → Supabase)
| Notion | Supabase | Direction |
|---|---|---|
| Name (title) | name | app→notion only (excluded from notion→app pull) |
| Phone/Email/Comments/Available (rich_text) | phone/email/comments/available | app→notion only (excluded from pull — protects cleaned data) |
| Status/Action/Source/Reason/Partnership (select) | status/action/source/reason/partnership | both |
| `""` empty-name (select) | level | both |
| Last Contacted (date) | last_contacted | both (Notion-authoritative) |
| First Lesson (date) | first_lesson | app→notion only (Supabase-authoritative — excluded from pull) |
| Showed/Bought/OLD/Texted (checkbox) | showed/bought/old/texted | both |

### DB migrations applied (via MCP, files in `supabase/migrations/`)
- **034_notion_sync** — `leads.notion_page_id / notion_last_synced_at / notion_last_edited_time / notion_archived_at`; `studios.notion_leads_db_id`; `notion_sync_log` table (RLS). Wired AMLS studio to its Notion DB id.
- **035_calls_set_last_contacted** — trigger to set `last_contacted` from calls.
- **036_lastcontacted_notion_authoritative** — changed that trigger to **fill-only-when-empty** (calls are a fallback; never overwrite a Notion value).
- **037_leads_texted** — `leads.texted boolean default false`.
- **038_notion_webhook_verifications** — service-role-only table to capture the webhook verification token during setup.

### Scripts (`scripts/`)
- `notion-reconcile-audit.mjs`, `apply-reconcile.mjs`, `backup-leads-snapshot.mjs`, `restore-leads-snapshot.mjs` — the one-time reconciliation (status/level/action + contact cleanup).
- `notion-link-backfill.mjs` — L0 link (notion_page_id).
- `notion-action-reconcile.mjs` — Action → Notion-authoritative.
- `notion-dates-reconcile.mjs` — last_contacted → Notion-authoritative (else call).
- `dump-notion-schema.mjs`, `check-notion-date-format.mjs`, `check-notion-date-raw.mjs` — read-only diagnostics.
- `_apply-notion-pull.test.ts` — one-off runner that applied the Notion→Supabase backlog locally in live mode (vitest; **can be deleted**).

---

## 2. Data changes applied (Lincolnshire, studio_id 71274499-7c29-4621-990f-b60669ed1de3)

All Supabase-only; Notion never written. Backups taken first.
- **Reconciliation (2026-05-30):** contact cleanup (stripped `https://www.notion.so` prefix from 453 phones + 437 emails), action call-linked→call-result (10), then re-reconciled action→Notion-authoritative (29), status→Notion (23), level→Notion (30). Last Contacted → Notion-authoritative (257), date-only display fix in `leads-table.tsx`.
- **L0 link backfill:** 1,732 leads linked to their Notion page (`notion_page_id`); 63 unlinked (no-contact couples / junk / 31 duplicate-page conflicts).
- **Notion→Supabase backlog (2026-05-31, LIVE):** applied 1,182 changes — **1,171 = `texted` backfill** (Supabase defaulted false; Notion had them checked) + ~11 small field diffs. Converged: a re-pull now reports `changed: 0`.

### Backups / rollback
- `leads_bak_before_notion_pull` (table) — pre-backlog snapshot of syncable columns.
- `leads_lc_bak_before_notion_sync` (table) — pre-last_contacted-sync snapshot.
- `.notion-audit/*.json` (gitignored) — per-step plans + `backup-leads-20260530.json` (full snapshot).
- `scripts/restore-leads-snapshot.mjs --apply` restores from the JSON backup.

---

## 3. Deploy state (IMPORTANT)

- Repo branch = `staging` (git default). **Netlify treats `staging` as a BRANCH DEPLOY**, served at **`https://staging--cadence-amls.netlify.app`** — NOT the production URL.
- **`https://cadence-amls.netlify.app` (production) serves a DIFFERENT branch** (Netlify's "production branch" ≠ staging) and does **not** have the sync code.
- **Decision: build/test on the staging branch deploy for now.** To move to production later: merge `staging` → the production branch, or change Netlify's production branch to `staging`.
- Env on Netlify: `NOTION_SYNC_MODE=live`, `NOTION_API_KEY`, `CRON_SECRET` (confirm scope includes branch deploys).

---

## 4. Polling cron (Notion → Supabase, automatic)

- **Scheduled** in Supabase pg_cron: job `notion-sync-pull` (jobid 3), `*/5 * * * *`, active — POSTs to the staging `/api/notion-sync` with `Bearer CRON_SECRET`.
- **✅ FIXED 2026-05-31:** `pg_net`'s default HTTP timeout is **5s**, but the full-scan endpoint takes **~16s** → every cron call was timing out (`net._http_response` showed `status_code: null`, "Timeout of 5000 ms reached" on runs 237–248). Fixed via `cron.alter_job(3, command := ...)` adding **`timeout_milliseconds := 30000`** to the `net.http_post`. Verified: a manual fire (request 249) returned `status_code: 200` with body `{"ok":true,"mode":"live","results":{"Arthur Murray Lincolnshire":{"checked":1732,"changed":0,"skipped":1732,"unmatched_selects":[]}}}`. Scheduled runs now complete normally.
  - Future option (not needed now): make the pull **incremental** (query Notion sorted by last_edited, stop at last-synced → endpoint <2s) — only worth it if the full scan ever approaches the timeout.
- The full pull from the **Netlify function** completes in ~16s (under Netlify's ~26s limit) — so the endpoint itself is fine; only the cron's pg_net timeout is the blocker.
- The **one-time backlog could NOT be applied via the Netlify function** (would exceed the function timeout with 1,182 sequential writes) — it was applied via the local `_apply-notion-pull.test.ts` runner instead (took two runs; remote round-trips from a laptop are slow). Future ongoing pulls are tiny, so this was a one-time concern.

---

## 5. Webhook (Notion → Supabase, near-instant) — awaiting client

- **Receiver built + deployed:** `POST /api/webhooks/notion` returns 200; verification-token capture **tested** (a fake token landed in `notion_webhook_verifications`).
- **BLOCKER (permissions):** Joshua (workspace member) **cannot create webhook subscriptions** ("actor does not have permission"). **The client (workspace owner) will create the subscription himself.**
- **Setup flow:** client creates subscription (URL = `https://staging--cadence-amls.netlify.app/api/webhooks/notion`, events = **Page**) → Notion POSTs a `verification_token` to our endpoint → it's stored in `notion_webhook_verifications` → query newest row → relay to client → he pastes it in Notion to verify → set `NOTION_WEBHOOK_SECRET` = that token in Netlify + redeploy (enables signature verification).
  - Retrieve token: `SELECT token, created_at FROM notion_webhook_verifications ORDER BY created_at DESC LIMIT 1;` (ignore the `TEST_capture_check_123` row).
- **✅ FULLY PROVEN LIVE 2026-06-01** (instrumented via `notion_webhook_debug`, migration 039, cron disabled during test to isolate): a **real Notion `page.properties_updated` event arrived** for a linked lead (Silver Mendoza) with a valid `X-Notion-Signature` that **matched our HMAC computation** (`sig_match: true`). Confirms ALL previously-unproven assumptions are correct: event delivery works, the subscription sends property-edit events, `body.entity.id` parsing is right, and **the signature format is correct** (`'sha256=' + HMAC-SHA256(verification_token, rawBody)`, hex). Token = `secret_BV9...`, set as `NOTION_WEBHOOK_SECRET` in Netlify.
- **Root cause of the earlier "not updating in seconds" reports = Notion's own delivery latency**, NOT a code bug. **Measured 2026-06-01: ~65–75s** from Notion's event `timestamp` to our receipt (across several real events), so end-to-end edit→Supabase is **~1–1.5 min** (Notion also aggregates the edit into an event first). No SLA. Notion also **retries** (saw `attempt_number: 2`) — harmless, sync is idempotent. The 5-min cron is the eventual-consistency backstop. (Diagnosis was muddied because the fixed cron was masking/racing the webhook — isolating required disabling the cron.)
- Event payload shape (confirmed): `{ id, timestamp, workspace_id, subscription_id, integration_id, authors[], attempt_number, api_version, entity:{id,type:'page'}, type:'page.properties_updated', data:{ parent:{...}, updated_properties:[<encoded prop ids>] } }`. We re-fetch the full page so the encoded `updated_properties` ids don't matter.
- **Route hardened (2026-06-01):** signature now **enforced** (401 on mismatch — format proven), keeps lightweight per-event logging to `notion_webhook_debug`. **KEEP decision (Joshua, 2026-06-01): `notion_webhook_debug` is retained as a permanent webhook event log — NOT to be dropped.** Service-role-only (RLS, no policies); grows ~1 row per Notion edit; `raw_body` holds the Notion payload (lead PII) so it's an internal-only log.
- **Webhook + cron coexist safely** (both idempotent). Plan: webhook = instant primary, cron = backstop (reduce cron to 15–30 min once webhook proven).

---

## 6. Key decisions
- **Notion-authoritative fields** (pulled Notion→app): status, level, action, source, reason, partnership, checkboxes (showed/bought/old/texted), last_contacted.
- **Excluded from Notion→app pull:** name/phone/email/comments/available (app/GHL-owned, cleaned — Notion copies are messy) and **first_lesson** (Supabase-authoritative, per client).
- **`texted`:** new dedicated `leads.texted` boolean, mapped 1:1 to Notion "Texted" checkbox.
- **Last Contacted:** Notion-authoritative; calls only fill it when Notion is empty (trigger fill-only-if-empty). Displayed date-only in the Leads table.
- **Conflict / edit semantics:** explicit edit wins and propagates both ways (§3.4 of the plan).

---

## 7. Open items / next steps
1. ~~**Fix the cron timeout**~~ ✅ DONE 2026-05-31 — added `timeout_milliseconds := 30000` to cron job 3; verified 200 (see §4).
2. **Webhook:** ✅ subscription created + proven live (2026-06-01). REMAINING: set `NOTION_WEBHOOK_SECRET = secret_BV9...` in Netlify + redeploy to enable signature verification, then re-test one edit (if it 401s, tweak the HMAC format).
   - **New-lead linking gap — FIX BUILT 2026-06-01** (plan: `docs/notion-autolink-plan.md`). New GHL-sourced leads (e.g. Kelli) got a Supabase row but no `notion_page_id` (one-time backfill can't catch later leads; `/api/webhooks/ghl-contact` upserts directly, bypassing Notion-aware `createLead`). **Phase A** (one-time relink) applied: linked 3 (Kelli/Emma/Elise); 4 were duplicate leads → surfaced to Joshua, NOT linked. **Phase B** (`linkUnlinkedLeads` folded into the pull, conflict-safe) built + typechecks + tests pass — awaiting redeploy. Phase C (app creates Notion pages) = declined; **wait+link only** (no Notion duplicates). Still TODO: Joshua to dedupe the 4 duplicate-lead pairs (Mary Sharpe/Jill Murray/Christine Stryker/Cheryl Placner) — see autolink plan.
3. **Production:** decide whether to move from the staging branch deploy to the real production URL/branch.
4. **Cleanup:** ✅ deleted `scripts/_apply-notion-pull.test.ts`. **`notion_webhook_debug` (migration 039): KEEP permanently** (Joshua, 2026-06-01) as the webhook event log — do NOT drop. Optionally clear the `TEST_` row in `notion_webhook_verifications`.
5. **App→Notion (S1):** still only validated in log mode — do a real live-write test (edit a lead → confirm it changes in Notion).
6. **Security:** `NOTION_API_KEY` (and the integration token) appeared in chat during setup — rotate when convenient.

---

## 8. Env vars (server-side)
- `NOTION_API_KEY` — integration `leads/n8n-integrations` (Read+Update+Insert). In `.env` + Netlify.
- `NOTION_SYNC_MODE` — `off | log | live`. In `.env` (local) + Netlify (staging = live).
- `NOTION_WEBHOOK_SECRET` — set = the Notion verification token AFTER the client verifies the subscription (enables signature verification).
- `NOTION_DB_LINCOLNSHIRE` = `d7c79e10b0fc4553903cec554bc0a1f5`, `NOTION_DB_SCHAUMBURG` = `14a71c37573080dfab57eabb597f5775` (Schaumburg DB not yet shared with the integration).
- `CRON_SECRET` — protects `/api/notion-sync`.
