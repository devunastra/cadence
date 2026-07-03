# Notion ↔ Supabase — Ongoing Lead Auto-Linking — Plan

> **Status:** PLAN for review. No code/data changes yet. Companion to `docs/notion-sync-build-log.md` and `docs/notion-2way-sync-plan.md`.
> **Goal:** Every lead that exists in *both* Notion and Supabase gets linked (`notion_page_id`) automatically — not just during the one-time backfill — so new leads sync in both directions.
> **Scope studio:** Arthur Murray Lincolnshire (AMLS) — `studio_id = 71274499-7c29-4621-990f-b60669ed1de3`.
> **Last updated:** 2026-06-01

---

## 0. TL;DR

The 2-way sync keys on `leads.notion_page_id`. That link was set by a **one-time backfill** (May 30–31), so any lead created afterward — e.g. **Kelli Krueger** (arrived via the GHL webhook 2026-06-01) — has `notion_page_id = NULL` and **cannot sync in either direction**. Fix: make linking **ongoing** by folding the existing phone/email matcher into the pull, plus a one-time re-link of today's backlog. **Match-first, never create duplicates, backup-first, diff-reviewed.**

---

## 1. Root cause (confirmed)

1. **GHL contact webhook bypasses the Notion-aware path.** [`app/api/webhooks/ghl-contact/route.ts`](../app/api/webhooks/ghl-contact/route.ts) does a direct `supabase.from('leads').upsert(...)` — it does **not** call the `createLead` server action, so the app→Notion create/link hook never fires for GHL-sourced leads.
2. **The backfill was one-time.** [`scripts/notion-link-backfill.mjs`](../scripts/notion-link-backfill.mjs) linked 1,732 leads once; nothing re-runs it, so post-backfill leads stay unlinked.
3. Result: a lead can exist in **both** systems (GHL→Supabase *and* the client's Notion intake) yet never be linked. Kelli is exactly this.

---

## 2. Current state (read-only audit, 2026-06-01)

| Metric (AMLS) | Count |
|---|---|
| Linked (`notion_page_id` set) | 1,732 |
| **Unlinked total** | **66** |
| — unlinked with usable **phone** | 32 |
| — unlinked with usable **email** | 26 |
| — unlinked with **no usable contact** (can't phone/email match — couples/junk) | 34 |
| — unlinked with a GHL contact id | 23 |
| — unlinked created **since** the backfill | 3 (incl. Kelli) |
| junk URL-style names | 1 |

So ~**32 are realistically matchable** (have a phone and/or email *and* presumably a Notion page); ~**34 are not** (no contact data). Exact matchable count comes from a dry-run (§4 Phase A).

---

## 3. Design

### 3.1 Principle: match-first, create-never (for now)
- **If a Notion page exists for the lead** (matched by normalized phone/email) → set `notion_page_id` and let the normal sync take over. **No new Notion page is created** (avoids duplicating the client's own Notion intake).
- **If no Notion page exists** → leave unlinked for now. Whether the app should *create* a Notion page for such leads is an open client decision (§6, Phase C) because the client's intake may create it independently → duplicate risk.

### 3.2 Reuse the proven matcher
The backfill's matcher is correct and conservative — reuse its exact logic:
- Normalize phone (strip non-digits, drop US country code, last-10) and email (lowercase, strip Notion-URL artifacts).
- Match a Notion page to a Supabase lead by **phone first, then email**.
- **Conflict-safe:** skip (and flag) when one lead is matched by >1 Notion page, or a lead is already linked to a *different* page. Never guess.
- Writes **only** link columns: `notion_page_id`, `notion_last_edited_time`, `notion_last_synced_at`. No business data.

### 3.3 Where it runs (ongoing)
Fold a new `linkUnlinkedLeads(client, studioId)` into the **pull** (`syncNotionToSupabase` in `lib/notion.ts`), executed **before** the sync loop:
- The pull already fetches **every** Notion page each run — zero extra Notion API calls.
- Build a phone/email index of the **unlinked** Supabase leads (tiny — 66 rows).
- For each Notion page not already linked, try to match an unlinked lead → if unique match, set the link. Then the existing sync loop immediately pulls that page's values into the freshly-linked lead.
- Runs automatically every 5 min via the existing cron; also runs on the webhook path's bulk fallback if invoked. New leads link within ≤5 min of *both* records existing.

This keeps linking and syncing in one place, idempotent, and self-healing.

### 3.4 (Optional) lower-latency hook
Optionally also attempt a match inside the **GHL contact webhook** right after the upsert (one Notion query by phone/email) so brand-new GHL leads link in seconds rather than waiting for the next pull. Deferred unless the client wants instant linking — the 5-min pull is sufficient for correctness.

---

## 4. Phased rollout

### ✅ Phase A APPLIED 2026-06-01 (partial — and it surfaced duplicates)
Dry-run planned 7 links; applying linked **3 genuinely new** (Kelli Krueger, Emma Stump, Elise Glenn). The other **4 hit the `leads_notion_page_id_key` unique constraint** because each is a **duplicate Supabase lead** — the Notion page is already linked to its twin (same phone/usually email):
- Mary Sharpe: unlinked `075a5859` vs linked `a1165bf5`
- Jill Murray: unlinked `b470f835` (has GHL id) vs linked `785bec6a`
- Christine Stryker: unlinked `ccc230dc` vs linked `34a49466` (has GHL id)
- Cheryl **Placner** `fe3a2fdb` (has GHL id) vs linked Cheryl **Plencner** `210e2cc0`

These 4 are **NOT linked** (left null) and surfaced to Joshua for dedupe (no self-deletion). **Matcher gap found:** it checks lead-side conflicts but not *page-already-owned-by-another-lead* — Phase B (and the script) must **skip + flag** that case, never write. State is clean (3 committed, 4 untouched).

### (historical) Phase A — one-time re-link of the current backlog (immediate value)
1. Run the existing `notion-link-backfill.mjs` in **dry-run** → produces `.notion-audit/link-plan.json` with exact match count + per-lead (lead → page) pairs.
2. **Review the diff** (especially any conflict skips) and approve.
3. **Backup** `notion_page_id` for the affected leads (trivial — currently all NULL; rollback = set back to NULL).
4. Apply with `--apply`. Links Kelli + the other matchable unlinked leads. Idempotent.
- Risk: **low** — writes only a link id, no business data; conflict-safe; reversible.

### ✅ Phase B BUILT 2026-06-01 (awaiting redeploy)
- Added `linkUnlinkedLeads(client, studioId, pages, linkedPageIds)` to `lib/notion.ts` + helpers (`normMatchPhone/normMatchEmail/readNotionContact`). Called inside `syncNotionToSupabase` right after the Notion page fetch; freshly-linked leads are added to `leadByPage` so their values sync in the **same** run.
- **Page-conflict fix (the Phase A crash):** only pages NOT already linked (`linkedPageIds`) are considered → a page can never be double-assigned. Ambiguous keys (shared by >1 unlinked lead) skipped + counted. Write guarded by `.is('notion_page_id', null)` + `.select('id')` + unique index; conflicts caught/logged, never thrown.
- Logged to `notion_sync_log` as `action:'update', detail.op:'link'` (the table's CHECK constraint disallows a literal `'link'` action). Gated by `NOTION_SYNC_MODE` (`log` = dry-run, writes nothing).
- `syncNotionToSupabase` return now includes `linked / link_ambiguous / link_conflicts` (surfaced in the `/api/notion-sync` response for monitoring).
- **Verified:** `tsc --noEmit` exit 0; `lib/notion.test.ts` 2/2 pass. Writes ONLY Supabase `notion_page_id` — never Notion/GHL.
- **⚠️ INCIDENT + FIX (2026-06-01):** the first deployed version (match by phone OR email, ambiguity checked only within the *unlinked* set) linked **24 leads live** — all of which turned out to be **duplicates of already-linked leads** (Notion has dup pages too), incl. shared-phone/different-name pairs (mismatch risk). **Fully reverted**: links cleared + all synced values restored from `leads_bak_before_notion_pull` (verified 0 still-linked, 0 value mismatches); current-state backup kept in `leads_bak_autolink_20260601`. Cron disabled.
- **Hardened rule (dedup-aware):** a lead is now linked ONLY if it shares **neither phone NOR email** with any other lead (globally unique/isolated) AND the page is unlinked AND the page's phone/email don't resolve to two different leads. Read-only preview confirms the eligible set shrank from 24 dups → **3 isolated leads** (anca groce + 2 test records); all dups excluded. Typecheck + tests pass.
- **Careful go-live:** redeploy → keep cron OFF → fire ONE manual pull → verify `linked` count + that the specific leads are from the safe set (not dups) → only then re-enable cron.
- **Follow-up (optional):** apply the same guards to the one-off `scripts/notion-link-backfill.mjs`.
- **DEDUPE DECISION 2026-06-01 = NO DELETION.** Joshua: "we won't delete anything." The duplicate-lead pairs (Mary Sharpe/Jill Murray/Christine Stryker/Cheryl Placner + ~20 flagged) **stay as-is, unlinked & dormant** — NOT a bug. For each duplicated person the already-linked copy still syncs; the extra dup row just sits idle (won't reflect Notion edits). The dedup-aware linker correctly skips them forever. No merge/delete to be done.
- **✅ GO-LIVE VALIDATED 2026-06-01:** post-redeploy manual pull returned `linked:0, link_ambiguous:26, link_conflicts:0, changed:0` — hardened linker links nothing unsafe, skips all dups, zero DB writes. Cron re-enabled.

### Phase C — leads with NO Notion page (client decision — §6)
Decide whether the app should **create** a Notion page for a GHL lead that has no Notion match, or leave it to the client's intake. Not built until decided.

---

## 5. Safety (every phase)
- **Read-only until the diff is approved.** Dry-run first; Joshua reviews before any write.
- **Backup-first** for any write (here: the link columns; rollback documented).
- **Conflict-safe & 1:1** — ambiguous matches are skipped and surfaced, never guessed.
- **Idempotent** — re-running only links new matches; already-linked rows untouched.
- **Scope** strictly to AMLS `studio_id`.
- **Claude never writes to Notion** — linking writes only Supabase. Phase C's create-page path (if approved) is *app* functionality, validated in log mode; Claude does not execute Notion writes. (See `memory/notion_claude_readonly.md`.)
- **No record deletion** — surfaced, never auto-removed (`memory/feedback_no_record_deletion.md`).

---

## 6. Open questions for the client / Joshua
1. **Phase C:** for a GHL lead with no Notion page, should the app **create** one in Notion, or wait for the client's own Notion intake to create it (then we just link)? (Default recommendation: **wait + link**, to avoid duplicates — only create if the client confirms the app should own new-lead creation in Notion.)
2. **The 34 no-contact unlinked leads** (couples/junk): leave unlinked? (Recommended yes — they can't be safely matched and many are non-person rows.) Surface the list for a manual once-over if desired.
3. **Lower-latency GHL hook (§3.4):** worth adding, or is ≤5 min fine? (Recommended: ≤5 min is fine.)

---

## 7. What this plan does NOT do
- No code or data changes yet (this is the plan).
- No Notion writes.
- No deletion of any lead.
- Does not touch the 34 no-contact rows or any linked lead.
