# Notion 2-Way Sync — Build Plan

> **Status:** PLAN for review. No sync code written yet. Companion to `docs/notion-2way-sync-plan.md` (design).
> **Goal:** Edit a lead in the app → reflects in Notion (instant). Edit in Notion → reflects in app (seconds). Scope: Lincolnshire (AMLS) first.
> **Last updated:** 2026-05-30

---

## 0. Already done (foundations)
- ✅ Migration 034 — `notion_page_id`, `notion_last_synced_at`, `notion_last_edited_time`, `notion_archived_at` on `leads`; `notion_leads_db_id` on `studios`; `notion_sync_log` table.
- ✅ Token `NOTION_API_KEY` with Read + Update + Insert; Lincolnshire DB connected.
- ✅ One-time reconciliation (status/level/action + contact cleanup).

**Still missing = the live sync engine.** That's what this plan builds, in safe phases. Each phase is independently shippable, reviewed before it runs, and reversible.

---

## Phase L0 — Link backfill (`notion_page_id`)  ⟵ prerequisite for everything
The app needs to know which Notion page each lead maps to.
- Reuse the audit matcher (phone/email) to pair each lead with its Notion page.
- **Write** `notion_page_id` + `notion_last_edited_time` onto the ~1,763 matched leads.
- Backup-first; review the match list; unmatched leads stay `null` (handled later).
- Risk: low (writes only a link id, no business data).

## Phase L0.5 — Last Contacted backfill (small, optional)
- 161 leads missing `last_contacted`. Set each to **max(Notion Last Contacted, latest call timestamp)**.
- Reviewed diff, backup-first. Read-only audit shown before any write.

## Phase S1 — App → Notion (the direction tested today)
- New `lib/notion.ts` (server-only): create / update / archive a Notion page; rate-limited to ≤3 req/s.
- Hook into `updateLead`, `createLead`, `deleteLeads`, `bulkUpdateLeads`: after the Supabase write succeeds, push to Notion (PATCH if `notion_page_id` exists, else create).
- Map FK UUID → option value → Notion select name. Missing Notion option → log + skip that field, never crash.
- **Echo guard:** stamp the write as app-originated so the inbound side ignores it.
- Ship behind a **feature flag**, **dry-run logging** to `notion_sync_log` first, then enable writes.

## Phase S2 — Notion → App (polling)
- Scheduled job (Supabase cron / edge function): every N minutes, query Notion by `last_edited_time desc`, stop at the last-seen timestamp.
- Resolve `notion_page_id` → lead, map properties → columns, write via the normal update path (keeps GHL in sync), update `notion_last_edited_time`.
- **Echo suppression:** compare inbound values/timestamp to what we last pushed; drop our own echoes.
- New Notion page with no match → create lead (dedup: `notion_page_id` + phone + email + unique index).

## Phase S3 — Webhooks (after deploy — gets it to "seconds")
- API route `/api/webhooks/notion-lead` + `NOTION_WEBHOOK_SECRET` (same pattern as GHL/Retell webhooks).
- **You/owner** create a webhook subscription in the Notion integration settings pointing at the deployed URL; we verify the token.
- Near-instant Notion→app; polling (S2) stays on as the safety net.

## Phase S4 — Delete handling + multi-studio
- App delete → archive Notion page (`archived:true`). Notion archive/delete → set `leads.notion_archived_at` (flag, **never** hard-delete), surface for review.
- Schaumburg: connect its DB to the integration, set `studios.notion_leads_db_id`, repeat L0→S3.

---

## Safety rules (every phase)
- Backup-first for any data write; reviewed diff before applying; scoped to AMLS `studio_id`.
- Feature flag + kill-switch on the sync; all actions logged to `notion_sync_log`.
- Rate-limited (Notion ≈3 req/s); echo-suppressed; idempotent; no hard deletes.
- Browser never calls Notion — server-side only.

## What the client / Joshua does
1. **Approve this plan.**
2. **Answer §13 Q4** (the `Texted` column — add `leads.texted`, ignore, or map?). Everything else is decided.
3. **Approve the data-write diffs** for L0 (link backfill) and L0.5 (Last Contacted).
4. **Post-deploy:** create the Notion webhook subscription (S3) — I'll give exact steps + URL.

## Suggested order
L0 → L0.5 → **S1 (the direction you just tested)** → S2 → deploy → S3 → S4.
S1 alone makes app→Notion edits work. S2/S3 add the reverse direction.

## Risks
Echo loops (mitigated by S1/S2 suppression + kill-switch), Notion rate limits (queue/throttle), option drift (log + skip), PII (server-side, token in env). See `docs/notion-2way-sync-plan.md` §15.
