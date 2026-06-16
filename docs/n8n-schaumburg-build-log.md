# AM Schaumburg Inquiries — n8n Build Log / Handoff

> Session capture so context survives compaction. Companion to [n8n-schaumburg-migration-plan.md](./n8n-schaumburg-migration-plan.md).
> **Last updated:** 2026-06-11

---

## 0. CURRENT STATE — read first (2026-05-30; cutover re-checked 2026-06-11)

**2026-06-11 cutover-readiness check (read-only Supabase verify):** Production cutover is **still parked** — and confirmed blocked on studio provisioning. A read-only scan of `studios` found **17 studios, NONE named Schaumburg** (closest AM-branded: Lincolnshire `71274499…`, Joshua Test `de8bcd75…`, QC `4673909d…`, BGC `b129…`, two dup "Alabang" rows). So the `studio_id` swap (Test→Schaumburg) cannot happen in either workflow yet. The Test target `ff81ad9c…` is fully seeded (52 field options, same as Lincolnshire); 3 studios have 0 options — whatever Schaumburg row gets created must be seeded the same way (clone Lincolnshire's options, à la migration 032) or `status`/`level`/`source` labels won't resolve to UUIDs.
> **Decision (Joshua, 2026-06-11 AM):** **Stay on Test for now** — do NOT cut over. Real-studio onboarding deferred; from-address still not captured. No live `studio_id` / trigger-filter changes made in that AM session.
> **⚠ SUPERSEDED twice on 2026-06-11 PM (see §18 + §19):** (a) Mid-session the inquiry wf's `studio_id` was moved `ff81ad9c…` → `b1290908…` (BGC) to align with the voice wf; then (b) **the REAL studio_id was applied** — `b1290908…` → **`aeefb977-5d03-4e40-994a-327cb51b7918` ("Arthur Murray Schaumburg")** across ALL THREE workflows (inquiry, voice, reports), with the real seeded option UUIDs. This IS the real studio target now. It is NOT yet a full cutover: inquiry+voice kept active but **still gated** (Gmail filter still `jdrsalve@gmail.com`; Retell not wired to the voice webhooks), so no real traffic flows. Real option UUIDs: status Active `3c7fbab5-f320-4e6c-8602-5239871bfcbc`, level Inquiry `cbfa2360-16f8-451f-9a82-7ede45aaaf51`, source Website Form `d1d05bcf-ea4e-4ebf-bd18-353a3c33e7ca`.
> **⚠ Reports wf is ACTUALLY ACTIVE (build-log earlier claim of INACTIVE was wrong):** `8XJjkiw7lT3s9hTM` live state = `active: true`. As of the §19 swap it now counts the REAL Schaumburg studio and will post real lead counts to the Discord channel on its daily (8am CT) / weekly (Mon 8am CT) schedule. **Decision pending from Joshua: deactivate until cutover, or let it post.** Not deactivated (activation toggles need explicit approval).
> **Two gating items remain before any cutover:** (1) a real Schaumburg studio created **and** field-option-seeded in Cadence; (2) the confirmed real Schaumburg inquiry "from" address as it lands in `dev@lunastra.ai` (Lincolnshire's is `info@onbeatmarketing.com`, so Schaumburg's may differ).

Main workflow **`rMbzNhw2XP7eBJQq`** ("AM Schaumburg Inquiries Workflow") is **ACTIVE/published**, but still in **TEST config** (trigger sender filter = `jdrsalve@gmail.com`; Supabase writes to the **Test** studio). Real inquiries don't fire it yet (filter), so being active is currently safe.

**Built & validated end-to-end** (real trigger run exec 68472, 2026-05-30):
```
Gmail Trigger → Parse Inquiry (loops ALL emails §17) → Email Present? →true→ Loop Over Items
  →(each lead)→ Find Existing Lead (Supabase, email OR phone) → Check Notion Duplicate (Notion, email)
  → Is New Lead? (BOTH empty) →true→ Create Notion Page → Create Lead → Create GHL Contact → Send Welcome Email →back to Loop
                              →false→ back to Loop
```
- Dedup checks BOTH systems (§14); writes Notion→Supabase→GHL→email, **fail-fast** on Notion+Supabase (§14); multi-email-per-poll safe (§17).
- Notion dual-write (§13) on DB `14a71c37…` via shared cred "AMLS Notion Acc"; GHL contact (§11); welcome email via GHL Conversations API (§12).

**Companion workflows:**
- **Error alerts** → "Error Handler – Discord" (`861CSg61GFDrgOwI`), wired as main wf's `errorWorkflow` (§15).
- **ROI reports** → "AM Schaumburg – Discord Reports" (`8XJjkiw7lT3s9hTM`), daily+weekly — **INACTIVE, needs activating** (§16).
- Main wf `settings.timeSavedPerExecution = 10` (§16 tail).

**▶ IN-FLIGHT (where we left off):** Joshua is now a **full Notion member** and is creating his **own Notion internal integration key** (capabilities: Read + Insert; must be connected to Schaumburg DB `14a71c37…`). When he pastes the token: (1) store as a new n8n `notionApi` credential, (2) **decision pending** — swap the 2 Notion nodes (`Check Notion Duplicate`, `Create Notion Page`) off the shared "AMLS Notion Acc" (`5dxEdAM3DEtksJXI`) onto it, or keep the existing one (it already works). Not required — purely for dedicated ownership.

**Pending — production cutover** (only thing left after the Notion-key choice):
1. Confirm a REAL Schaumburg inquiry's "from" as it lands in `dev@lunastra.ai` (Lincolnshire's = `info@onbeatmarketing.com`; Schaumburg's may differ) → set Gmail Trigger sender filter.
2. Onboard real Schaumburg studio in Cadence + its own `studio_field_options` + runtime label→UUID resolution → swap `studio_id` Test→real in **both** the inquiry wf AND the reports wf.
3. Notion DB, GHL location, welcome email already point at the real Schaumburg systems.

**Test-data cleanup:** Joshua deletes leftover test leads/contacts/Notion pages manually (NEVER auto-delete — [[no-record-deletion]]); needed between test runs or dedup skips.

**Hard rules:** duplicate-Make-exactly (custom formats → new fields); Supabase changes → migration files; only touch this workflow + clones (never production wf/studios); never auto-delete records; local Supabase MCP only (`npcpkffnswzvzmqolort`).

**Full ID reference → §9.**

---

## 1. Goal & context

Rebuild the Make.com scenario **"SCHAUMBURG Email to Notion (Mailhook)"** as an n8n workflow. It captures website dance-lesson inquiries: parse the email → dedup → create a lead → (later) send a welcome email + create a GHL contact.

**Access / relationship chain:** Joshua → his client/boss (Myrrh) → end client (the studio, which owns the Make.com account + Microsoft mailbox + Notion + GHL). Joshua has no direct access to those systems; all access requests route through the boss. Client-facing messages are drafted for the boss.

---

## 2. What the original Make scenario does (11 modules)

1. **Mailhook trigger** — receives the inquiry email (forwarded from `info@amschaumburg.com`).
2–5. **Regex parsers** — Full Name, First Name, Email (required; halts if missing), Phone.
6. **OpenAI (o4-mini)** — extract the reason/message text.
7. **OpenAI (gpt-4o-mini)** — normalize phone to digits only (strip country code).
8. **Notion search** — dedup by Email OR Phone.
9. **Notion create page** — only if no match. Sets Name, Email, Phone, Comments=message, **Status=Active**, stage select **"Inquiry"**, **Source=Online**, Texted=true. (Did NOT set action/reason/partnership/dance-level.)
10. **Outlook send** — welcome email to the lead.
11. **GHL create contact** — with the reason in a custom field.

Core logic: welcome email + GHL contact only fire for **new** leads (gated behind the dedup).

---

## 3. Key decisions

- **Email = Option B:** inquiries forward `info@amschaumburg.com` → `dev@lunastra.ai`; n8n reads `dev@lunastra.ai`. For **testing**, Joshua sends to `jdrsalve@gmail.com` then forwards into `dev@lunastra.ai` (same forwarded shape as prod).
- **Notion dropped** → write leads to the app's **Supabase** `leads` table instead.
- **Test studio** (`ff81ad9c-048d-4d79-944f-44d7df101b8b`, name "Test") used as a placeholder `studio_id` — the real Arthur Murray **Schaumburg** is NOT onboarded as a studio in the Cadence app (app currently only has Lincolnshire + test studios).
- **OpenAI dropped** — both AI steps (reason extract, phone format) replaced by deterministic code in the parser. No AI cost.
- **Build method:** Joshua creates the workflow shell; Claude builds it out via the n8n MCP.

## Hard rules (from Joshua)
- **Duplicate Make exactly.** Any custom format our app needs goes in a **new field**, never by modifying the Make-equivalent node output (e.g. phone: keep Make's digits-only `phone`, add `phoneE164` for Supabase).
- **Every Supabase change → a migration file** in `supabase/migrations/` (idempotent), not ad-hoc MCP SQL.
- **Scope:** only touch the new workflow + the Test studio. Never modify production workflows/studios.

---

## 4. Current n8n workflow state

- **Instance:** `lunastra-ai-n8n.up.railway.app` (n8n MCP connected, healthy)
- **Workflow:** "AM Schaumburg Inquiries Workflow", id **`rMbzNhw2XP7eBJQq`** (project "Mojo M <mojo@lunastra.ai>"), **ACTIVE/published** (still TEST config — see §0)
- **Credentials:** Gmail "AM Schaumburg" (`2MXtTwthsQN10kh9`), Supabase "AMLS WebApp Temp" (`yHLLUsK6GjoakeTT`), GHL PIT "GHL AM Schaumburg PIT" (`bT1Mmjy5NLfMUU5G`), Notion "AMLS Notion Acc" (`5dxEdAM3DEtksJXI`), Discord "Discord AMLS Alerts" (`rAeaueyQWyCXWc1v`) — full list in §9.

**Node graph (all built & wired):**
```
Gmail Trigger → Parse Inquiry (parses ALL emails in the poll) → Email Present? ─true→ Loop Over Items
                                                                                          │ (each lead, one at a time)
                                                                                          ▼
   Find Existing Lead → Check Notion Duplicate → Is New Lead? ─true→ Create Notion Page → Create Lead → Create GHL Contact → Send Welcome Email ──┐
                                                       └false──────────────────────────────────────────────────────────────────────────────────┤
                                                                                                                          (loop back to Loop Over Items) ◀┘
```
(Dedup checks BOTH Supabase + Notion — see §14. Writes ordered Notion→Supabase→GHL→email, fail-fast on the two lead writes. Wrapped in **Loop Over Items** so every email in a poll is processed — see §17.)

| Node | Type | Notes |
|---|---|---|
| Gmail Trigger - Inquiries | gmailTrigger v1.4 | **Simplify OFF**, sender filter `jdrsalve@gmail.com` (→ swap to `info@amschaumburg.com` for prod), polls every minute |
| Parse Inquiry | code v2 | decodes body, extracts fields (see §5) |
| Email Present? | if v2.3 | passes when `hasEmail` true (mirrors Make's required-email parser) |
| Find Existing Lead | supabase getAll | string filter `studio_id=eq.<Test>&or=(email.eq.{{email}},phone.like.*{{digits}})` — matches **email OR phone**, **Always Output Data ON** |
| Check Notion Duplicate | notion getAll | dedup the Schaumburg DB by **Email equals**, **Always Output Data ON** |
| Is New Lead? | if v2.3 | true only when **both** the Supabase result `id` AND the Notion result `id` are empty (AND) |
| Create Lead | supabase create | inserts into `leads` (see §6) |
| Create GHL Contact | httpRequest v4.4 | POST GHL v2 `/contacts/`, PIT bearer auth, continue-on-error (see §11) |
| Send Welcome Email | httpRequest v4.4 | POST GHL v2 `/conversations/messages` type=Email, uses contactId from prior node (see §12) |

---

## 5. Parse Inquiry — what it outputs

Reads the raw Gmail message (Simplify off → body is base64 in `payload.parts`; the parser decodes `text/plain`, falls back to html/snippet), collapses whitespace (the inquiry is one run-on line that email transport hard-wraps), then regex-extracts:
- `fullName`, `firstName`, `lastName`
- `email`
- `phone` — **Make-faithful**: digits only, leading `1` country code stripped (e.g. `8473160389`)
- `phoneE164` — **custom field for Supabase**: `+1XXXXXXXXXX` (matches app's stored E.164 format)
- `message` — everything after "Message:" (Make-faithful; keeps trailing boilerplate)
- `hasEmail`

**Confirmed real inquiry body format:** `Yay! You got a new website inquiry for Arthur Murray Schaumburg! Name: <name> Email: <email> Phone: <phone> Message: <msg> Reach out to them to get them scheduled!`

---

## 6. Supabase / leads schema findings (important)

- **`leads` enum columns `status`/`level`/`action`/`source`/`reason`/`partnership` are uuid FKs to `studio_field_options`** (per-studio), NOT text — `lib/types.ts` shows them as `string` (misleading; that's the resolved value). Inserting a text label fails: `invalid input syntax for type uuid`.
- `name`/`email`/`phone`/`comments`/`ghl_contact_id` are text. Phone stored as **E.164** (from GHL).
- `studio_field_options` are **per-studio and NOT auto-seeded**. Only Lincolnshire had them; Test studio had none → we cloned Lincolnshire's full set into Test (migration 032).

**Create Lead field mapping** (Make-faithful values via Test-studio option UUIDs):
| column | value |
|---|---|
| studio_id | `ff81ad9c-048d-4d79-944f-44d7df101b8b` (Test) |
| name | `={{ $('Parse Inquiry').first().json.fullName }}` |
| email | `={{ …json.email }}` |
| phone | `={{ …json.phoneE164 }}` (E.164) |
| comments | `={{ …json.message }}` |
| status | `144a7790-25c0-4eb3-ae43-68f7bed6bcfe` (Active) |
| level | `ef085d92-6613-487d-a4e0-327bb281e237` (Inquiry) |
| source | `4481e81e-3e95-469d-a053-62f5cab296cb` (Online) |

(`action`/`reason`/`partnership` left null — Make didn't set them on new inquiries.)

Lincolnshire studio_id = `71274499-7c29-4621-990f-b60669ed1de3` (source data for the clone).

---

## 7. Migrations

- **`supabase/migrations/032_seed_test_studio_field_options.sql`** — idempotent seed cloning Lincolnshire's field options into the Test studio. (The clone was also applied live during the session.)

---

## 8. Status

**Done:** trigger, parser, email gate, dedup query, new-lead gate, insert — all built & wired; Test-studio field options seeded; migration written. Parser verified clean against a real test email; dedup chain verified working.

**✅ Full pipeline validated end-to-end (2026-05-29, exec 68465):** parse → dedup → Create Lead → Create GHL Contact → Send Welcome Email all green.
- **Create Lead** — Supabase lead correct (phone `+18473160389`, status/level/source = Test UUIDs, comments = message).
- **Create GHL Contact** — all fields correct; custom-field write key `field_value` confirmed; GHL normalizes digits-only phone → `+18473160389`.
- **Send Welcome Email** — GHL returned `"Email queued successfully."`; `html`/`subject`/`emailTo` field names confirmed working.
- All test artifacts cleaned up (Supabase test lead + both GHL test contacts deleted).
- **Scope lesson:** sending email needs `conversations/message.write` — distinct from `conversations.write`. Editing PIT scopes propagates to the existing token (no regeneration needed).

---

## 13. Notion sync (added 2026-05-29) — dual-write Notion + Supabase

Client instructed leads sync to **both** Notion and Supabase (reverses the earlier "drop Notion"). Added a **"Create Notion Page"** node — wired `Create Lead → Create Notion Page → Create GHL Contact` (Notion before GHL, mirrors Make's module order). Dedup stays on **Supabase** (single gate); Notion is just a second write destination.

**Database IDs (don't confuse them):**
- **Schaumburg leads DB = `14a71c37-5730-80df-ab57-eabb597f5775`** — confirmed by Joshua's link + Make blueprint module 25. This is our target.
- Lincolnshire leads DB = `d7c79e10-b0fc-4553-903c-ec554bc0a1f5` ("INQUIRY MASTER LIST") — different DB.

**Credential — reusing existing `AMLS Notion Acc`** (n8n cred id `5dxEdAM3DEtksJXI`, type `notionApi`). Confirmed working on Lincolnshire's DB (used by live workflow **`nbVcDIn35E7z5AgB` "Improved Make Workflow v2"** — which is essentially the Lincolnshire twin of this whole flow; great reference). ✅ **Access to the Schaumburg DB (`14a71c37`) CONFIRMED (exec 68469, 2026-05-29):** Notion page created successfully with all fields correct, incl. the empty-name stage select = "Inquiry". The integration already had access — **no new token, no client message needed.**

**Create Notion Page mapping (Make module 25 faithful):**
| Notion property | value |
|---|---|
| Name (title) | fullName |
| Email (rich_text) | email |
| Phone (rich_text) | `phone` (digits-only, Make-faithful — NOT phoneE164) |
| Comments (rich_text) | message |
| Status (select) | Active |
| Source (select) | Online |
| (empty-name select = stage) | Inquiry |
| Texted (checkbox) | true |

`onError: continueRegularOutput` (mirrors Make's Ignore). Node key for the stage select is `"|select"` (empty property name) — the most fragile mapping; if it errors on test, that's the first thing to check. `databaseId` cachedResultName omitted → cosmetic n8n warning only, runs fine.

---

---

## 14. Notion↔Supabase alignment & atomicity (2026-05-29)

Client requirement: the two systems must stay aligned, and **if one write fails, neither should insert**. True cross-system atomicity is impossible (Notion + Supabase + GHL are separate APIs, no shared transaction), so we approximate it:

**Dedup against BOTH systems, up front** (so we don't write one without the other due to a dedup mismatch):
- **Find Existing Lead** (Supabase) — broadened to **email OR phone** (`or=(email.eq.<email>,phone.like.*<digits>)`), matching Make's original email-or-phone key. Phone uses `like.*<digits>` (digits-only) to dodge the `+` URL-encoding issue with stored E.164.
- **Check Notion Duplicate** (Notion getAll) — matches **Email equals** (email is always present + the reliable key; kept single-condition to avoid Notion filter combinator quirks).
- **Is New Lead?** — fires only when **both** results are empty (AND). Found in *either* system ⇒ skip everything (no dupes).

**Writes ordered Notion → Supabase → GHL → email, fail-fast on the two lead writes:**
- **Create Notion Page** `onError: stopWorkflow` (riskiest write — fragile empty-name stage field — goes first; if it fails, nothing else runs).
- **Create Lead** (Supabase) default `stopWorkflow` (if it fails, GHL/email don't run).
- **Create GHL Contact** + **Send Welcome Email** stay `continueRegularOutput` (best-effort side-effects, mirrors Make's "Ignore").

**Residual gap (accepted):** Notion succeeds → Supabase blips → a Notion orphan with no Supabase row. Can't auto-rollback (would need a delete, which Joshua handles manually — see [[no-record-deletion]]). Surface/flag it; don't auto-delete. For genuinely new inquiries (absent from both) this path is effectively airtight.

**Drift handling = option (a):** if a lead exists in only one system, we treat it as existing and skip (no dupes); we do NOT backfill the missing side. Revisit at production cutover if they want old drift healed.

---

---

## 15. Error notifications — Discord (2026-05-29)

- **Error workflow:** "Error Handler – Discord" (id `861CSg61GFDrgOwI`) — `Error Trigger → Discord` node (webhook mode, operation `sendLegacy`). Posts workflow name, failed node, error message, execution URL.
- **Credential:** "Discord AMLS Alerts" (`rAeaueyQWyCXWc1v`, type `discordWebhookApi`) — webhook URL stored in the credential, NOT in any workflow JSON. Reusable for other workflows.
- **Wired** via the Schaumburg workflow's `settings.errorWorkflow`. Fires on **hard failures only** (parse / Notion / Supabase — the stop-on-error writes). GHL + email are continue-on-error, so they won't trigger an alert (best-effort, by design — can change to `continueErrorOutput`+notify if full coverage wanted).
- **Test:** open "Error Handler – Discord" in n8n → Execute Workflow → a sample alert posts to Discord.

---

## 16. Discord time-saved reports (2026-05-29)

Separate scheduled workflow **"AM Schaumburg – Discord Reports"** (id `8XJjkiw7lT3s9hTM`), posts ROI summaries to the same Discord channel:
- **Daily** (Schedule Trigger, 8am America/Chicago) and **Weekly** (Mon 8am America/Chicago) branches.
- Each: count new `leads` in Supabase for the period (`studio_id=<Test>&created_at=gte.<period>` via `$now.minus({days:1|7}).toUTC().toISO()`) → Code builds message → Discord post.
- **Time saved = count × 10 min** (Joshua's estimate); formatted min/hrs.
- Reuses cred "Discord AMLS Alerts" (`rAeaueyQWyCXWc1v`). Its own errors route to the error handler (`861CSg61GFDrgOwI`).
- ⚠ **Created INACTIVE — must be activated** for the schedules to fire. First daily post next 8am CT; first weekly next Monday 8am CT.
- Counts come from the **Test** studio while in test config; reflects real Schaumburg numbers after cutover.

## 17. Multi-email-per-poll fix — Loop Over Items (2026-05-30)

**Bug:** Parse Inquiry used `$input.first()` and every downstream node referenced `$('Parse Inquiry').first()`. If two inquiries landed in the **same 1-minute Gmail poll**, the trigger delivered both but only the FIRST was processed — the rest silently dropped (lost leads).

**Fix (matches the Lincolnshire reference pattern):**
- **Parse Inquiry** now loops `$input.all()` → one parsed item per email.
- Added **"Loop Over Items"** (`splitInBatches` v3, batch size 1) after `Email Present?`. Each lead runs the dedup+writes one at a time.
- Wiring: `Email Present?`(true) → Loop Over Items; loop output(main[1]) → Find Existing Lead → … → Send Welcome Email → **back to Loop Over Items**; `Is New Lead?` false → **back to Loop Over Items**; done output(main[0]) ends.
- Parsed-data refs repointed `$('Parse Inquiry').first()` → `$('Loop Over Items').first()`. Dedup/contact refs (`Find Existing Lead`/`Check Notion Duplicate`/`Create GHL Contact` `.first()`) unchanged — they resolve per-iteration inside the loop.
- Validates clean. ⚠ Validator warns "main[1] missing continueErrorOutput" on `Is New Lead?` + `Loop Over Items` — **false positives** (main[1] = IF false-branch / splitInBatches loop output, not error outputs); the production Lincolnshire workflow is identical.

---

**n8n built-in "time saved":** separately, the main workflow's `settings.timeSavedPerExecution = 10` (min) is set — this satisfies n8n's "Track time saved" checklist item and feeds n8n's own Insights dashboard (distinct from the Discord reports above; Insights may be limited on self-hosted).

---

**Remaining = production cutover** (workflow is now PUBLISHED/active, but still in TEST config — trigger sender filter `jdrsalve@gmail.com` means real inquiries don't fire it yet; Supabase writes to the Test studio):
- Confirm a REAL Schaumburg inquiry's "from" address as it lands in `dev@lunastra.ai` (Lincolnshire's is `info@onbeatmarketing.com`, so Schaumburg's may NOT be `info@amschaumburg.com`), then set the Gmail Trigger sender filter to it.
- Onboard the real Schaumburg studio + its own `studio_field_options`; resolve label→option-UUID at runtime instead of hardcoded Test UUIDs; swap `studio_id` Test → real Schaumburg.
- Notion DB, GHL location, and the welcome email already point at the real Schaumburg systems — only the Supabase studio_id + trigger filter are test-bound.

*(Historical "in progress / blocked" notes removed — the GHL contact node and welcome email are built & validated, see §11–§12. Live status + remaining cutover steps are in §0.)*

---

## 9. Quick reference

| Thing | Value |
|---|---|
| Main inquiry workflow | `rMbzNhw2XP7eBJQq` "AM Schaumburg Inquiries Workflow" (ACTIVE) |
| Error handler workflow | `861CSg61GFDrgOwI` "Error Handler – Discord" |
| Reports workflow | `8XJjkiw7lT3s9hTM` "AM Schaumburg – Discord Reports" (INACTIVE — activate to enable) |
| Reference (Lincolnshire twin) | `nbVcDIn35E7z5AgB` "Improved Make Workflow v2" (read-only reference) |
| n8n instance | lunastra-ai-n8n.up.railway.app |
| Gmail cred | "AM Schaumburg" (`2MXtTwthsQN10kh9`) — reads dev@lunastra.ai |
| Supabase cred | "AMLS WebApp Temp" (`yHLLUsK6GjoakeTT`), project `npcpkffnswzvzmqolort` |
| GHL PIT cred | "GHL AM Schaumburg PIT" (`bT1Mmjy5NLfMUU5G`, httpHeaderAuth) |
| Notion cred (shared, in use) | "AMLS Notion Acc" (`5dxEdAM3DEtksJXI`, notionApi) |
| Discord cred | "Discord AMLS Alerts" (`rAeaueyQWyCXWc1v`, discordWebhookApi) |
| Schaumburg Notion leads DB | `14a71c37-5730-80df-ab57-eabb597f5775` (active target) |
| Lincolnshire Notion DB | `d7c79e10-b0fc-4553-903c-ec554bc0a1f5` "INQUIRY MASTER LIST" |
| GHL Schaumburg location | `upQmnNZT3QeZXbNOA34D` (live CRM) |
| GHL "Reason" custom field | `KMpbP5JuOzb1zvoXNdIe` |
| Test studio_id | `ff81ad9c-048d-4d79-944f-44d7df101b8b` |
| Lincolnshire studio_id | `71274499-7c29-4621-990f-b60669ed1de3` |
| Test option UUIDs | status Active `144a7790…`, level Inquiry `ef085d92…`, source Online `4481e81e…` |

---

## 10. Appendix — Parse Inquiry node full code (source of truth is the live node)

> ⚠ Pre-loop version shown below (single email). The **live node now wraps this in `const __out = []; for (const __e of $input.all()) { const item = __e.json; … __out.push(...); } return __out;`** to process every email in a poll — see §17.

```javascript
const item = $input.first().json;

function decodeB64url(data) {
  if (!data) return '';
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) return decodeB64url(payload.body.data);
  if (Array.isArray(payload.parts)) { for (const p of payload.parts) { const t = extractBody(p); if (t) return t; } }
  if (payload.mimeType === 'text/html' && payload.body && payload.body.data) return decodeB64url(payload.body.data).replace(/<[^>]+>/g, ' ');
  return '';
}

let body = extractBody(item.payload) || item.text || item.snippet || '';
// Inquiry is run-on text that email transport hard-wraps; collapse whitespace to single spaces.
body = String(body).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const grab = (re) => { const m = body.match(re); return m ? m[1].trim() : ''; };
const fullName = grab(/Name:\s*(.*?)\s*(?:Email:|Phone:|Message:|$)/i);
const parts = fullName.split(/\s+/).filter(Boolean);
const firstName = parts[0] || '';
const lastName = parts.slice(1).join(' ');
const email = (grab(/Email:\s*(.*?)\s*(?:Name:|Phone:|Message:|$)/i).match(/[^\s<>]+@[^\s<>]+\.[A-Za-z]{2,}/) || [''])[0];

// Phone: Make-faithful digits only, country code stripped (mirrors Make phone-format module)
const phoneRaw = grab(/Phone:\s*(.*?)\s*(?:Name:|Email:|Message:|$)/i);
let phoneDigits = phoneRaw.replace(/\D/g, '');
if (phoneDigits.length === 11 && phoneDigits.startsWith('1')) phoneDigits = phoneDigits.slice(1);
const phone = phoneDigits;
// Custom field for Supabase E.164 (matches app stored format), NOT part of Make output
const phoneE164 = phoneDigits.length === 10 ? '+1' + phoneDigits : (phoneDigits ? '+' + phoneDigits : '');

// Message: Make-faithful, everything after the Message label (Make kept trailing boilerplate)
const message = grab(/Message:\s*(.+)$/i);

return [{ json: { fullName, firstName, lastName, email, phone, phoneRaw, phoneE164, message, hasEmail: Boolean(email) } }];
```

---

## 11. GHL create-contact node (module 11) — credential, scope, mapping

**Access obtained 2026-05-29.** Credential = a GHL **Private Integration Token (PIT)** named "n8n-integrations", scoped to the Schaumburg sub-account. Long-lived — no auto-expiry, manual rotation only (if rotated, update the n8n credential; use "rotate later" for a 7-day grace). **The token value is NOT stored in this repo** — it lives only in n8n's credential store.

- **Location ID:** `upQmnNZT3QeZXbNOA34D` (Schaumburg sub-account — this is a **LIVE CRM**: 712 real contacts as of 2026-05-29, so test creates pollute production).
- **API:** GHL v2 — base `https://services.leadconnectorhq.com`, headers `Authorization: Bearer <PIT>` + `Version: 2021-07-28`.
- **PIT scopes:** Contacts **read** ✓ verified. Custom-fields **read** ✗ (401) — but not needed (field ID confirmed from a real record). **Contacts write (Edit Contacts) must be enabled** to create — confirm on the integration.

**Make GHL mapping — reverse-engineered from a real Make-created contact (`3IHx5vu9shSsgC8rkwEN`, "frank baffa"):**
| GHL field | value | fed from |
|---|---|---|
| firstName | parsed first name | `firstName` |
| lastName | parsed last name | `lastName` |
| email | parsed email | `email` |
| phone | digits-only; GHL normalizes to E.164 (`+1…`) | `phone` (Make-faithful, NOT `phoneE164`) |
| source | `"Online Inquiry"` | literal |
| tags | `["email", "notion"]` | literal — matches Make. (Was briefly `["email"]` when Notion was out of scope; `"notion"` restored 2026-05-29 once Notion sync was added back.) |
| custom field `KMpbP5JuOzb1zvoXNdIe` ("Reason") | inquiry message | `message` |

`locationId: upQmnNZT3QeZXbNOA34D` goes in the create payload. Set "Continue On Fail" (mirrors Make's "Ignore" error handler).

**Built 2026-05-29** — node **"Create GHL Contact"** (`n8n-nodes-base.httpRequest` v4.4), wired `Create Lead → Create GHL Contact`. Config:
- `POST https://services.leadconnectorhq.com/contacts/`, headers `Version: 2021-07-28` + `Accept: application/json`.
- Auth: n8n credential **"GHL Schaumburg PIT"** (id `bT1Mmjy5NLfMUU5G`, type `httpHeaderAuth`, header `Authorization: Bearer <PIT>`, domain-locked to `services.leadconnectorhq.com`). Token value only in n8n.
- `onError: continueRegularOutput`. Workflow validates clean (0 errors).
- JSON body (expression off Parse Inquiry): firstName, lastName, email, `phone` (digits-only), locationId, `source:"Online Inquiry"`, `tags:["email"]`, `customFields:[{id:"KMpbP5JuOzb1zvoXNdIe", field_value: message}]`.
- ⚠ **Custom-field write key unverified:** GHL read returns `value`; docs say write uses `field_value`. Used `field_value` — confirm on first test; switch to `value` if it 400s.

**To test (still pending):** (1) confirm PIT has **Edit Contacts** (`contacts.write`) scope; (2) test approach — throwaway contact (delete after) vs sandbox sub-account.

---

## 12. Welcome email node (module 39) — sent via GHL (Option A)

Make sent the welcome email via the **native Microsoft 365 (Outlook/Graph)** module from the studio mailbox ("AMSB 2"). **Client (2026-05-29) directed us to send via GHL instead** (they use GHL for other clients' welcome emails) — an approved substitution, like Notion→Supabase. Chosen approach **A**: n8n sends it through the **GHL Conversations API**.

**Built 2026-05-29** — node **"Send Welcome Email"** (`httpRequest` v4.4), wired `Create GHL Contact → Send Welcome Email`.
- `POST https://services.leadconnectorhq.com/conversations/messages`, same PIT credential + headers as §11.
- Body: `type:"Email"`, `contactId` = `$('Create GHL Contact').first().json.contact.id`, `emailTo` = parsed email, `subject` + `html` = the exact Make copy (below).
- `onError: continueRegularOutput`. Workflow validates clean.
- ⚠ **Order deviates from Make on purpose:** Make sent email (mod 39) *before* the GHL contact (mod 32), independently via Outlook. Option A needs the GHL `contactId` to send, so the email node runs **after** Create GHL Contact. Edge case: lead new in Supabase but already in GHL → contact create 400s → no contactId → email skipped (continue-on-error). Acceptable.
- ⚠ **Unverified GHL field names** (`html`/`subject`/`emailTo` on the messages endpoint) — confirm on first test; adjust if it 400s.
- **Scope needed:** PIT must have **Conversation Messages → Edit** (`conversations/message.write`) in addition to the contacts scopes.

**Make email — module 39 (`microsoft-email:createAndSendAMessage`), source of truth:**
- **Subject:** `We Received Your Dance Inquiry!`
- **Content type:** HTML · **Importance:** Normal · **To:** parsed lead email · **Greeting:** first name (`{{27.$1}}`)
- **From:** the studio's M365 mailbox (Make connection "AMSB 2"); no explicit from/replyTo set. Via GHL, sends from the location's configured email instead.
- **Body** (the `Â` chars in the blueprint were non-breaking-space mojibake; normalized to plain spaces):

```html
Hi {{firstName}}! <br><br>
We received your inquiry about dance lessons and would love to help you get started! Please give us a call at (847) 882-3700 so I can share more information.<br><br>
In the meantime, here's a bit of info on how your first dance lesson would go:<br>
The best way to get started is with our New Student Introductory Lesson.<br>
This is a 45-minute session that costs $80.00 per person.<br>
You will meet our team leader and learn a few moves with one of our many patient and very talented instructors!<br><br>
Afterwards, our team leader will provide you with a couple of options on how to move forward with your new dance journey!<br><br>
We're open Tuesday through Saturday; when would you like to try your first lesson? I recommend Tuesdays and Fridays at 6:00PM starting next week! We look forward to speaking with you!<br><br>
Feel free to call us at (847) 882-3700 or reply to this email to schedule your first visit.<br><br>
- Team Arthur Murray Schaumburg<br><br>
Arthur Murray Franchised Dance Studio<br>
608 E Golf Rd, Schaumburg, IL 60173<br>
(847) 882-3700<br>
Normal Business Hours are: <br>
Tuesday - Friday 1pm - 10pm <br>
Sat 10 am - 3 pm <br>
Sun & Mon CLOSED
```

---

## 18. Session 2026-06-11 (PM) — Schaumburg config swaps + Voice AI Functions wiring

Goal: configure **both** Schaumburg n8n workflows so they process **only** Schaumburg, using a TEST `studio_id` (Schaumburg not yet onboarded as a real Cadence studio). Brought the **Voice AI Functions** workflow into setup for the first time alongside the inquiry pipeline. All edits via n8n MCP partial-update; both workflows left ACTIVE.

**Two workflows in scope this session:**
- **`rMbzNhw2XP7eBJQq`** — AM Schaumburg Inquiries (this doc's main subject)
- **`Wgg5bQTPJYFsDSn8`** — **Voice AI Functions (AM Schaumburg)** — Retell tool webhooks (availability/booking/get-studio-details/post-call analytics). NEW to this log.

### Confirmed canonical values (from Joshua, 2026-06-11 PM)
| Thing | Value |
|---|---|
| Canonical TEST studio_id (both wf) | `b1290908-73af-4813-b643-a28f9ce703dd` ("Arthur Murray BGC", a test studio) |
| Real Schaumburg GHL location | `upQmnNZT3QeZXbNOA34D` (already correct in inquiry wf) |
| Schaumburg Retell agent | `agent_9bd7f902d7e62f788986e85d69` / from_number `+17623713782` |
| Correct Notion leads DB | `14a71c37-5730-8184-8c81-000c6f7c7c89` (dashed form of `14a71c37573081848c81000c6f7c7c89`) |
| GHL assigned user | `pSffQn8bFaJIvBSBiP0l` ("Admin Schaumburg") |
| GHL calendar (UNVERIFIED — "let's try") | `Wsb5f6Fjf1zYf8a0ZuzX` |

### Inquiry wf `rMbzNhw2XP7eBJQq` — changes
- `studio_id` `ff81ad9c…` → `b1290908…` in **Find Existing Lead** + **Create Lead**.
- Field-option UUIDs re-mapped (old ones belonged to `ff81ad9c`, verified via Supabase):
  - status `Active` `144a7790…` → `f555a337-6cbe-4cd8-8f8c-7e30988d160a`
  - level `Inquiry` `ef085d92…` → `421b04b1-1791-466c-b896-ce97f8d19296`
  - source `Online` `4481e81e…` → **`Website Form` `9e6c5897-265a-48ef-8925-99b9855a2f79`** (b1290908 has NO "Online" source; Joshua chose Website Form. Available sources on b1290908: Email, Walk-In, Website Form.)
- Notion DB `14a71c37-5730-80df-ab57-eabb597f5775` → `14a71c37-5730-8184-8c81-000c6f7c7c89` in **Create Notion Page** + **Check Notion Duplicate**.
- Gmail sender filter UNCHANGED (`jdrsalve@gmail.com`, still test).
- ⚠ Notion select literals in `Create Notion Page` (`Source="Online"`, `Status="Active"`) are Notion's own option names, NOT Supabase UUIDs — left as-is; verify against the new Notion DB's option names.

### Voice AI Functions wf `Wgg5bQTPJYFsDSn8` — changes
- **studio_id:** `Transform API Response` (stamps every `calls` row) `f05f82bd…` → `b1290908…`. (`Fetch Studio` already queried `b1290908`.)
- **Field-option bleed fix:** `Get Field Option IDs` + `Get Field Option IDs1` queried `studio_field_options` with NO studio filter (picked `options[0]`, any studio). Appended `&studio_id=eq.b1290908…` to both URLs.
- **Retell outbound:** `Trigger Retell Outbound Call` `override_agent_id` `agent_cd8a872b64a03338e6c54a41a0` (Lincolnshire) → `agent_9bd7f902d7e62f788986e85d69`. `from_number` (+17623713782) and `override_agent_version` (13) UNCHANGED.
- **GHL location** `slTYdxI6vskx4r28zsIo` → `upQmnNZT3QeZXbNOA34D` in: Search Contact, Create New Event, Update Dashboard, HTTP Request, HTTP Request1 (incl. app-webhook body locationId).
- **GHL calendar** `TYARmrJpYZlj4lGbA9iS` → `Wsb5f6Fjf1zYf8a0ZuzX` in: Get Free Slots on GHL, Get Free Slots on GHL1, Get Free Slots (Earliest), Create New Event, Update Dashboard.  ⚠ calendar id UNVERIFIED.
- **GHL assigned user** `S9hw1iaCvrOo4fhJknxH` → `pSffQn8bFaJIvBSBiP0l` (Create New Event).
- **GHL PIT → credential:** 7 HTTP nodes (Search Contact, Delete Event, Create New Event, Update Appointment, Get Free Slots on GHL/GHL1/Earliest) had the **Lincolnshire PIT hardcoded inline** (`Bearer pit-738a26d4-…`). Converted all to use credential **"GHL AM Schaumburg PIT"** (`bT1Mmjy5NLfMUU5G`, httpHeaderAuth) — plaintext token removed entirely.

### Voice wf — Get Studio Details tool: FIXED (was fully broken)
Verification found 3 defects; fixed the 2 mechanical ones, now returns real data (`studio_found:"true"`):
1. **Webhook accepted GET only** (no `httpMethod` set) → Retell calls via POST returned 404. Set `httpMethod: POST`.
2. **Row-parse bug** in `Format Studio Details`: `const row = $input.first().json?.[0] ?? null;` treated the single-object input as an array → `row` always null → `studio_found:false`. Fixed to handle both shapes: `const input = $input.first().json; const row = Array.isArray(input) ? (input[0] ?? null) : (input ?? null);`
3. **NOT FIXED (pending real values):** `studio_phone`, `intro_offer_blurb`, `dance_styles` are hardcoded `REPLACE_ME …`, and `intro_offer_price` hardcoded `$80 per person`. These are spoken to callers — must be filled at cutover.
- The original `Fetch Studio` Supabase credential (`AMLS WebApp Temp` `yHLLUsK6GjoakeTT`) works; a brief test-swap to `Supabase account` `vQIzYJhUTNwuSy98` 401'd and was reverted.
- Webhook path: `…/webhook/b8e2d4a6-3f51-47c9-a0d7-6e9c1f2b5a83` (Retell **Write** auth, token `wr_…`).

### Voice wf — post-call analytics credential: FIXED (was 401, never logged a Schaumburg call)
- The **`Supabase account` credential `vQIzYJhUTNwuSy98`** returns **401 "Invalid API key"** (dead key). Confirmed by real prod exec `69753` + an empty `calls` table for `b1290908…` (zero rows ever).
- **9 nodes** were on that dead credential — repointed all to the working **`AMLS WebApp Temp` `yHLLUsK6GjoakeTT`**:
  - post-call: `Get Lead (ended)`, `Get Field Option IDs1`, `Update a row2`, `Upsert Call (ended)`
  - AI callback: `Get Field Option IDs`, `Get a row`, `Update a row`
  - dance-interest: `Get a row2`, `Update a row1`
- Verified end-to-end: a test POST to `…/webhook/post-call-schaumburg` wrote a real `calls` row (read via `Get Lead (ended)` + write via `Upsert Call (ended)`).
- **⚠ Test row to delete manually** ([[no-record-deletion]]): `calls.id = ae13ab95-a8c3-4b5a-9d0b-2fb82af4e4e2`, `retell_call_id = call_CREDFIXTEST_20260611_aa11bb22` (backdated created_at 2026-05-10).
- `vQIzYJhUTNwuSy98` itself left dead (not re-keyed); nodes simply moved off it. If it's re-keyed later, it's the proper service-role cred to standardize on.

### Voice wf webhook paths (Retell agent must target these)
Base `https://lunastra-ai-n8n.up.railway.app/webhook/`. All Schaumburg tool paths carry `-schaumburg`: `availability-check-schaumburg`, `day-slot-check-schaumburg`, `get-earliest-slot-schaumburg`, `get-current-datetime-schaumburg` (Read auth `ro_…`); `create/reschedule/delete-appointment-schaumburg`, `set-variable-rescheduling-schaumburg`, `schedule-ai-callback-schaumburg`, `update-dance-interest-new-schaumburg`, `update-reason-new-schaumburg`, `escalate-message-schaumburg` (Write auth `wr_…`); `post-call-schaumburg` (no auth); Get Studio Details `b8e2d4a6-…` (Write).

### Still PENDING before a real Schaumburg cutover
- **Both wf:** real Schaumburg `studio_id` (replace test `b1290908…`) once the studio is onboarded + field-option-seeded in Cadence.
- **Voice wf:** fill `Format Studio Details` REPLACE_ME (phone, intro_offer_blurb, dance_styles) + verify `$80` price.
- **Voice wf:** confirm the Schaumburg Retell agent's **post-call webhook actually targets `…/webhook/post-call-schaumburg`** — NO post-call executions exist in history, suggesting Retell isn't pointed here yet (so calls won't log even though n8n now works).
- **Voice wf:** verify calendar `Wsb5f6Fjf1zYf8a0ZuzX` is a real bookable Schaumburg calendar; confirm Retell `override_agent_version: 13` matches the published agent + the phone's `outbound_agents.agent_version`; confirm the inline Retell API key in `Trigger Retell Outbound Call` is valid for the new agent.
- **Inquiry wf:** real Schaumburg inquiry "from" address → set Gmail sender filter.
- **Both wf:** `AMLS WebApp Temp` is a "temp" credential — when a permanent Schaumburg Supabase cred is made, re-point (inquiry: 2 nodes; voice: `Fetch Studio` + the 9 repointed nodes).

### Voice wf quick-reference (new)
| Thing | Value |
|---|---|
| Voice AI Functions wf | `Wgg5bQTPJYFsDSn8` "Voice AI Functions (AM Schaumburg)" (ACTIVE) |
| Retell agent (Schaumburg) | `agent_9bd7f902d7e62f788986e85d69` / `+17623713782` / version 13 (confirm) |
| GHL location | `upQmnNZT3QeZXbNOA34D` |
| GHL calendar | `Wsb5f6Fjf1zYf8a0ZuzX` (UNVERIFIED) |
| GHL assigned user | `pSffQn8bFaJIvBSBiP0l` (Admin Schaumburg) |
| GHL PIT cred | "GHL AM Schaumburg PIT" (`bT1Mmjy5NLfMUU5G`) |
| Working Supabase cred | "AMLS WebApp Temp" (`yHLLUsK6GjoakeTT`) |
| Dead Supabase cred (avoid) | "Supabase account" (`vQIzYJhUTNwuSy98`) — 401 |
| studio_id (test) | `b1290908-73af-4813-b643-a28f9ce703dd` (BGC) — **superseded by real `aeefb977…`, see §19** |
| Pre-existing validator error | `Get Alternates` "{{...}} not valid in Code nodes" — known false-positive, unrelated |

---

## 19. Session 2026-06-11 (PM, later) — REAL Schaumburg studio_id applied (staged, not full cutover)

Joshua provided the **real** studio_id and confirmed (read-only Supabase verify) that the studio exists and is fully field-option-seeded. Decision: **swap now, keep inquiry+voice ACTIVE (staged)** — real traffic still blocked by the test Gmail filter + un-wired Retell, so swapping is effectively staging.

**Real studio:** `aeefb977-5d03-4e40-994a-327cb51b7918` = **"Arthur Murray Schaumburg"**, tz `America/Chicago`, `ghl_account_id` = `upQmnNZT3QeZXbNOA34D` ✓, created 2026-06-15, **47 field options** (fully seeded). Note on that row: `retell_agent_id` empty, `ghl_calendar_id` null (not used by these workflows, but relevant for the voice-agent side later).

**Swap map applied (old → new):**
| Item | Old (BGC `b1290908`) | New (real Schaumburg) |
|---|---|---|
| studio_id | `b1290908-73af-4813-b643-a28f9ce703dd` | `aeefb977-5d03-4e40-994a-327cb51b7918` |
| status Active | `f555a337-6cbe-4cd8-8f8c-7e30988d160a` | `3c7fbab5-f320-4e6c-8602-5239871bfcbc` |
| level Inquiry | `421b04b1-1791-466c-b896-ce97f8d19296` | `cbfa2360-16f8-451f-9a82-7ede45aaaf51` |
| source Website Form | `9e6c5897-265a-48ef-8925-99b9855a2f79` | `d1d05bcf-ea4e-4ebf-bd18-353a3c33e7ca` |

**Nodes changed (11 total, 0 new errors, active states untouched):**
- **Inquiry `rMbzNhw2XP7eBJQq`** (ACTIVE): `Find Existing Lead` (studio_id) + `Create Lead` (studio_id + status + level + source) — 5.
- **Voice `Wgg5bQTPJYFsDSn8`** (ACTIVE): `Transform API Response`, `Fetch Studio`, `Get Field Option IDs`, `Get Field Option IDs1` (studio_id only; voice wf resolves option UUIDs dynamically, no hardcoded ones) — 4.
- **Reports `8XJjkiw7lT3s9hTM`** (ACTIVE — see §0 flag): `Count Leads (24h)` + `Count Leads (7d)` — these had referenced the OTHER test id `ff81ad9c…`, now → `aeefb977…` — 2.

Verified zero occurrences of `b1290908`, `ff81ad9c`, or the 3 old option UUIDs remain in any of the three workflows.

**studio_id is NOT in Retell** — the Retell agent doesn't carry it; this was purely an n8n change. No Retell edits made (and the Schaumburg Retell agent has not yet been confirmed in-scope/clone to modify).

**Still pending for full cutover (unchanged from §18):** Gmail real-sender filter (inquiry); confirm Retell post-call webhook → `post-call-schaumburg` + tool webhooks wired; fill voice `Format Studio Details` REPLACE_ME + verify $80; verify calendar `Wsb5f6Fjf1zYf8a0ZuzX`; confirm Retell agent version/key; **decide Reports wf active-vs-inactive** (currently active, now posting real counts). And the temp Supabase cred re-point whenever a permanent one is made.

---

## 20. Session 2026-06-16 — Notion historical lead import + GHL PIT + Notion DB-id correction

### 🔴 Notion DB-id correction (supersedes §18/§19)
The real Schaumburg Notion **leads database_id** is **`14a71c37-5730-80df-ab57-eabb597f5775`** ("SCHAUMBURG INQUIRY MASTER LIST", HTTP 200, 739 pages). The `14a71c37-5730-8184-8c81-000c6f7c7c89` value used in §18/§19 is **NOT a database id** — it's a data-source/view id that **404s** on the Notion API. Proven via `/v1/search` once the integration had access. Reverted everywhere:
- `.env` `NOTION_DB_SCHAUMBURG` → `…80df…`.
- n8n inquiry wf `rMbzNhw2XP7eBJQq` `Create Notion Page` + `Check Notion Duplicate` → `…80df…` (with `cachedResultName` "SCHAUMBURG INQUIRY MASTER LIST"). **The `…8184…` value had been silently breaking those nodes** (404 → fail-fast → Discord error on every real inquiry); revert fixed it.

### GHL PIT
- `studios.ghl_api_key` for Schaumburg set to `pit-57baf592-6705-4137-8bc3-5eb5d522bccb` (runtime UPDATE — secret deliberately NOT in a committed migration). Also `.env` `GHL_SCHAUMBURG_PIT`.

### Notion integration access + webhook
- Joshua added the app integration **`leads/n8n-integrations`** to the Schaumburg DB's Connections (same "AMLS's Notion" workspace) → app token can now read/write it. (n8n uses a separate cred "AMLS Notion Acc".)
- Notion webhook subscription is **integration-scoped and alive** (158 events in `notion_webhook_debug`, latest 2026-06-14) → automatically covers Schaumburg now; the 5-min cron is the backstop. **No new Notion webhook setup needed.**

### ✅ Historical lead import — DONE (739 leads)
- Script: **`scripts/import-notion-leads-schaumburg.mjs`** (one-time, dry-run-default, `--apply`). Imported **739 leads** into Supabase under studio `aeefb977…`, each **linked via `notion_page_id`** (enables future 2-way sync). `created_by_email='import'`, `created_at` preserved from Notion.
- **INSERT-ONLY** (hard rule [[feedback_leads_insert_only]]): plain `.insert()` — NOT upsert (the `notion_page_id` unique index is partial, can't be an ON CONFLICT target); re-run-safe via a pre-flight skip-set of existing `notion_page_id`s. Dry-run writes only `.notion-audit/schaumburg-import-plan.json`; `--apply` does backup + pre/post-count assert.
- Adversarial verify caught + we fixed a **date off-by-one bug** (ICU renders studio-midnight as "24:00"; inlined `tzOffsetMsAt` now normalizes it like `tzCalendarParts`). ⚠ **The same latent bug exists in `lib/date-utils.ts:9-18`** — app dodges it on newer ICU; flagged for a separate fix, NOT changed (app code).
- **Migration `045_seed_schaumburg_online_promising_options.sql`** seeds `source "Online"` (730 leads) + `action "Promising"` (17 leads) for Schaumburg (Joshua approved seeding vs remap/null, to preserve Notion values + keep 2-way sync clean). Applied via REST (local Supabase MCP unavailable this session); option ids: source Online `0e16066d-df15-4238-a8a1-9a497ea20883`, action Promising `9ec71baf-92e5-45a5-9f41-be8ac99ed526`.
- **1 phone collision** (2 Notion pages share a number — a "Gloria Lopez" duplicate) imported as **distinct** leads; manual dedupe if wanted ([[no-record-deletion]]). 9 phones normalized to null (confirmed un-dialable junk).

### Pending (Notion/leads side)
- **2-way sync direction decision:** leads are now linked, so the sync *could* be enabled by setting `studios.notion_leads_db_id = 14a71c37-5730-80df-ab57-eabb597f5775`. BUT the Notion→App pull **UPDATEs the leads table** — conflicts with the insert-only rule. app→Notion (push-only) is fine. Decide direction before flipping it on.
- **GHL conversations sync:** configure the Schaumburg GHL sub-account to fire Inbound/Outbound message webhooks at `/api/webhooks/ghl-message` (resolves studio by `ghl_account_id`, already set). History backfill (optional) would use the new `ghl_api_key`.

**Note on the GHL contact mapping (verified against blueprint module 32):** matches what we built in §11 — `firstName`={{27.$1}}, `lastName`={{8.$2}}, `email`={{10.$1}}, `phone`={{31...}} (digits-only), `source`="Online Inquiry", `tags`=["email","notion"] (we dropped "notion"), `customField KMpbP5JuOzb1zvoXNdIe`={{40.result}} (the message). Make also set `dnd:false` (GHL default — omitted, same result).

