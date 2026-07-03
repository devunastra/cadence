# Instant Call Reviews — Implementation Plan

**Status:** Decisions locked — ready to schedule implementation
**Author:** Joshua
**Last updated:** 2026-05-29 (decisions locked)
**Owner:** AMLS / Lunastra AI

---

## 1. Client goal

> The moment a call ends, the operator should see a complete record in the Call History UI — including the AI-generated **Result** label ("Booked", "Callback Requested", "Booking Attempted", etc.) — instead of waiting up to 24 hours for the overnight cron to run.

---

## 2. TL;DR — what's already done vs what needs to change

| Layer | Current latency | Target latency | Work needed |
|---|---|---|---|
| **`calls` table row** (call metadata, transcript, disconnect reason, etc.) | ~1–3 seconds — n8n webhook from Retell | ~1–3 seconds | ✅ **None.** Already instant. |
| **`call_reviews` row** (AI-derived booking_successful / callback_requested / grade) | Up to ~31 hours — daily cron at 07:00 UTC reviews *yesterday's* calls | < 60 seconds after `calls` row arrives | ⚠️ **This is the work.** |
| **Result label in the UI** | "Pending Review" until the review row exists, then auto-flips to correct label | "Pending Review" for ≤ 1 minute, then correct label | Falls out of the above |

In short: **the `calls` pipeline is already real-time. Only the AI review step is slow.** This plan addresses that step only.

> **Rolled in alongside the realtime fix** — a per-studio `review_enabled` flag (default `true`) so the second studio onboarding shortly can opt in or out without code changes. Phased rollout: backend in Phase A, UI in Phase B, operational verification in Phase C. See §11A.

---

## 3. Current architecture (verified 2026-05-29)

### 3.1 How a `calls` row arrives today

```
┌──────────────┐  call_ended    ┌──────────────────────┐  upsert  ┌─────────────────┐
│  Retell AI   │ ────────────▶ │  n8n webhook         │ ───────▶ │  Supabase       │
│  (agent      │   POST         │  /webhook/post-call  │          │  public.calls   │
│   c6c4...)   │                │  (Railway-hosted)    │          │                 │
└──────────────┘                └──────────────────────┘          └─────────────────┘
```

- **Production agent:** `agent_c6c4facfa0c12f9d7e1f1a8c83` (`NEW TEST MOJO JFF`)
- **Webhook URL configured on agent:** `https://lunastra-ai-n8n.up.railway.app/webhook/post-call`
- **Joshua's test copy** uses a separate path `/webhook/post-call-joshua` (verified clean isolation)

### 3.2 How a `call_reviews` row arrives today

Two paths, both lagging:

| Path | Schedule | Lag |
|---|---|---|
| `supabase/functions/daily-call-review/index.ts` | `pg_cron` at `0 7 * * *` (07:00 UTC daily); reviews **yesterday's** calls | up to ~31 h |
| `supabase/functions/analyze-call-quality/index.ts` | Manual — operator clicks "Analyze Unreviewed" on `/call-quality` | on-demand only |

Both filter to: `duration_seconds > 15 AND transcript IS NOT NULL AND voicemail != true`.

### 3.3 What `getCallResult` does with that data

[`components/call-history/call-history-shell.tsx`](../components/call-history/call-history-shell.tsx) (mirrored in [`call-detail-drawer.tsx`](../components/call-history/call-detail-drawer.tsx)) resolves the Result label with this precedence:

1. Voicemail / Did Not Pick Up / Busy → from `calls.disconnected_reason`
2. Transferred → from `calls.transferred`
3. **Booked** → `call_reviews.booking_successful === true`
4. **Callback Requested** → `call_reviews.callback_requested === true`
5. **Booking Attempted** → `call_reviews.booking_successful === false && booking_attempted === true`
6. **Pending Review** → no `call_reviews` row exists AND `calls.appointment_booked === true` (the fallback we added because n8n flips `appointment_booked = true` on attempts that didn't succeed)
7. IVR Reached / Inactivity → from `calls.disconnected_reason`
8. User/Agent Hung Up → from `calls.disconnected_reason`
9. `outcome === 'unsuccessful'` → "Did Not Pick Up" (fallback)

So **the only label that can show "Pending Review" is one waiting on `call_reviews`.** Once that row lands, the label flips instantly via Supabase Realtime / next data refresh.

### 3.4 Surfaced during Phase 0 — intentionally left as-is

- `app/api/webhooks/retell-call/route.ts` — a 200-OK stub. No Retell agent points at it. **Leave in place** per the "no code deletion" rule (another dev may be maintaining it). See §5 Step 5.
- Agent `agent_df433caaf504e24849f118588b` ("NEW TEST MOJO JFF (backup)") still has webhook `https://amls-dashboard.vercel.app/api/webhooks/retell-call` — the **retired Vercel deployment**. If reactivated, its post-call events would vanish into a dead URL. **Do not modify via MCP without explicit per-action approval** per the "no Retell mutations" rule. See §5 Step 5.
- The legacy `scripts/import-retell-calls.mjs` CSV importer is a one-off backfill tool, not a pipeline. Keep for emergencies, no change needed.

---

## 4. Target architecture

```
┌──────────────┐  call_ended    ┌──────────────────────┐  upsert  ┌─────────────────┐
│  Retell AI   │ ────────────▶ │  n8n webhook         │ ───────▶ │  Supabase       │
└──────────────┘                │  /webhook/post-call  │          │  public.calls   │
                                └──────────────────────┘          └────────┬────────┘
                                                                           │ AFTER INSERT
                                                                           │ OR UPDATE OF transcript
                                                                           ▼
                                                                  ┌────────────────────┐
                                                                  │  trigger fn (DB)   │
                                                                  │  fires only when:  │
                                                                  │  - transcript NN   │
                                                                  │  - duration > 15   │
                                                                  │  - voicemail=false │
                                                                  │  - no review yet   │
                                                                  └─────────┬──────────┘
                                                                            │ pg_net.http_post
                                                                            ▼
                                                                  ┌────────────────────┐  upsert  ┌──────────────────────┐
                                                                  │  edge fn:          │ ──────▶ │  public.call_reviews │
                                                                  │  analyze-single-   │          └──────────────────────┘
                                                                  │  call(call_id)     │
                                                                  └────────────────────┘
                                                                            ▲
                                                                            │ also reachable as
                                                                            │ same-shape RPC
                                                                            │
                                                            ┌──────────────────────────────┐
                                                            │  daily-call-review (kept     │
                                                            │  as safety-net for missed    │
                                                            │  events; can be disabled     │
                                                            │  later)                       │
                                                            └──────────────────────────────┘
```

### Why a Postgres trigger (not an inline call inside n8n)

| Approach | Pros | Cons |
|---|---|---|
| **DB trigger via `pg_net`** (chosen) | Writer-agnostic — fires for n8n, manual SQL, future webhook rewrites. Lives in Supabase, gitops-able via migration. Self-heals when writer changes. | Async (fire-and-forget); error visibility requires logging. |
| Inline HTTP call in n8n workflow | Simple to add | Couples logic to n8n; if writer ever changes, instant-review breaks silently. |
| Edge fn polls `calls` for unreviewed rows every minute | Decoupled | Slower (≤ 1 min lag), more invocations, not actually instant. |
| Synchronous call inside the n8n webhook handler | Lowest possible latency | n8n holds Retell's HTTP connection open for ~30 s while OpenAI runs → risk of timeout + Retell retries → duplicate calls rows. **Reject.** |

---

## 5. Implementation steps

### Step 1 — New edge function `analyze-single-call`

**File:** `supabase/functions/analyze-single-call/index.ts`

**Inputs:**
- HTTP POST
- Headers: `Authorization: Bearer <anon>`, `x-cron-secret: $CRON_SECRET`, `Content-Type: application/json`
- Body: `{ "call_id": "<uuid>" }`

**Behavior:**
1. Validate `x-cron-secret` (timing-safe compare) — same gate as `daily-call-review`
2. Fetch the single call row by `call_id`
3. Eligibility check (same as the daily function):
   - `transcript IS NOT NULL AND duration_seconds > 15 AND voicemail != true`
4. Skip if a `call_reviews` row already exists for this `call_id`
5. Call OpenAI (same prompt + model + `temperature: 1` as the existing functions — **do not regress to `temperature: 0.3`**, that's what broke the daily cron in May)
6. Upsert into `call_reviews` with `trigger_type: 'realtime'`
7. Return 200 with `{ analyzed: 0|1, skipped: 0|1, errors: [...] }`

**Reuse:** lift `analyzeCall` and `SYSTEM_PROMPT` constants from `daily-call-review/index.ts` — keep a single source of truth, or extract to a shared `_shared/analyze.ts` if Deno's local imports allow.

**Deploy with `verify_jwt: true`** (same as the existing two functions).

**Add a new `call_reviews.trigger_type` value** — `'realtime'` — to distinguish from `'cron'` and `'manual'` so we can audit/debug coverage.

### Step 2 — Postgres trigger migration

**File:** `supabase/migrations/0NN_realtime_call_review_trigger.sql`

```sql
-- Migration: realtime call review trigger
-- Fires analyze-single-call edge function when a calls row is inserted
-- (or updated to add a transcript) and is eligible for AI review.

-- 0. Per-studio opt-out flag (defaults true → no behavioral change for existing studios)
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS review_enabled boolean NOT NULL DEFAULT true;

-- 1. Wrapper function
CREATE OR REPLACE FUNCTION public.trigger_realtime_call_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url      text := current_setting('app.analyze_single_call_url', true);
  v_anon_key text := current_setting('app.supabase_anon_key', true);
  v_cron_sec text := current_setting('app.cron_secret', true);
BEGIN
  -- Skip if config not present (e.g., during preview branches)
  IF v_url IS NULL OR v_anon_key IS NULL OR v_cron_sec IS NULL THEN
    RETURN NEW;
  END IF;

  -- Per-studio opt-out: skip if this studio has reviews disabled
  IF NOT EXISTS (
    SELECT 1 FROM studios
    WHERE id = NEW.studio_id
      AND COALESCE(review_enabled, true) = true
  ) THEN
    RETURN NEW;
  END IF;

  -- Eligibility: same filters as daily-call-review
  IF NEW.transcript IS NOT NULL
     AND COALESCE(NEW.duration_seconds, 0) > 15
     AND COALESCE(NEW.voicemail, false) = false
     AND NOT EXISTS (SELECT 1 FROM call_reviews WHERE call_id = NEW.id)
  THEN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_anon_key,
        'x-cron-secret', v_cron_sec,
        'Content-Type', 'application/json'
      ),
      body    := jsonb_build_object('call_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Trigger: fire on INSERT, and on UPDATE when transcript transitions from NULL → non-NULL
DROP TRIGGER IF EXISTS calls_realtime_review_insert ON public.calls;
CREATE TRIGGER calls_realtime_review_insert
AFTER INSERT ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.trigger_realtime_call_review();

DROP TRIGGER IF EXISTS calls_realtime_review_update ON public.calls;
CREATE TRIGGER calls_realtime_review_update
AFTER UPDATE OF transcript ON public.calls
FOR EACH ROW
WHEN (OLD.transcript IS DISTINCT FROM NEW.transcript)
EXECUTE FUNCTION public.trigger_realtime_call_review();
```

> Why UPDATE too? If n8n upserts the `calls` row in two passes (first with metadata, later with transcript), the INSERT won't see a transcript. The UPDATE trigger catches the second write.

**Set the GUC config** (one-time, via the Supabase dashboard or migration):

```sql
ALTER DATABASE postgres SET app.analyze_single_call_url = 'https://npcpkffnswzvzmqolort.supabase.co/functions/v1/analyze-single-call';
ALTER DATABASE postgres SET app.supabase_anon_key = '<anon-jwt>';
ALTER DATABASE postgres SET app.cron_secret = '<cron-secret>';
```

> Storing the secrets in GUCs (not literally in the migration file) keeps them out of git and matches the existing `cron.job` pattern.

### Step 3 — Update `getCallResult` precedence (no change required)

Already in place — when a `call_reviews` row appears, the existing precedence in [`call-history-shell.tsx`](../components/call-history/call-history-shell.tsx) and [`call-detail-drawer.tsx`](../components/call-history/call-detail-drawer.tsx) automatically replaces "Pending Review" with the correct label on the next Realtime push or page refresh.

### Step 4 — Keep `daily-call-review` as a safety net (+ honor `review_enabled`)

Don't disable it. Reasons:
- Backstop for any call where the trigger silently fails (OpenAI 500s, `pg_net` queue backlog, etc.)
- Marginal cost — at current volume (5–10 calls/day) it'll find 0 unreviewed rows most days, so OpenAI cost is near zero.

Two small changes inside `daily-call-review/index.ts`:

1. **Honor the per-studio opt-out** — extend the eligibility query to skip studios where `review_enabled = false`:
   ```ts
   const { data: calls } = await serviceClient
     .from('calls')
     .select('id, transcript, transcript_summary, voicemail, direction, duration_seconds, studio_id, studios!inner(review_enabled)')
     .neq('voicemail', true)
     .not('transcript', 'is', null)
     .gt('duration_seconds', MIN_DURATION_SECONDS)
     .eq('studios.review_enabled', true)
     .gte('created_at', dateFrom)
     .lte('created_at', dateTo)
     ...
   ```
2. **Log coverage gap** — `console.log` how many rows the daily cron found unreviewed for the prior day. If the realtime trigger is healthy this should always be 0. Non-zero = something missed the trigger and we want to know about it.

### Step 5 — Things deliberately NOT touched (don't delete / don't modify)

These were surfaced during Phase 0 investigation but are intentionally left as-is:

- **`app/api/webhooks/retell-call/route.ts`** — orphaned 200-OK stub. **Do not delete.** Another developer may be maintaining it; keep per the "no code deletion" rule.
- **Retell agent `agent_df433caaf504e24849f118588b`** (`NEW TEST MOJO JFF (backup)`) — webhook still points at the retired Vercel deployment. **Do not modify via MCP without explicit per-action approval.** Read-only inspection only; flag for Joshua if reactivation becomes a concern.

---

## 6. Idempotency & race-condition analysis

| Scenario | Result |
|---|---|
| Retell sends `call_ended` twice → n8n upserts twice | First INSERT triggers review; second is an UPDATE, but `OLD.transcript IS DISTINCT FROM NEW.transcript` is false (same value) → trigger doesn't refire. ✅ |
| n8n inserts row with no transcript, then updates row with transcript | INSERT trigger: skipped (no transcript). UPDATE trigger: fires (transcript transitioned NULL → text). ✅ |
| Two writers race (shouldn't happen, but…) and both INSERT | Whoever wins the upsert; the loser is a no-op. ✅ |
| Edge function called twice for same `call_id` (e.g., trigger + manual button overlap) | Function checks for existing `call_reviews` row → second call returns `skipped: 1`. ✅ |
| OpenAI returns 500 / times out | Edge fn returns `{ errors: [...] }` with 200 (or 500). The daily cron picks it up the next morning as a fallback. ✅ |
| `pg_net` queue is backed up | Latency degrades from seconds to minutes; daily cron still catches anything missed. ⚠️ Acceptable. |

---

## 7. Cost analysis

| Item | Today | After change |
|---|---|---|
| OpenAI calls per day | ~1 batch of ≤ 10 calls | One call per eligible event (~5–10/day at current volume) |
| OpenAI $/day | ~$0.05 | ~$0.05 (same count, real-time scheduling) |
| Supabase edge fn invocations | 1/day + manual | ~5–10/day |

**No meaningful cost change.** Volume would need to grow 100× before this matters; if it does, introduce a queue (`pg-boss` or similar) — not in scope here.

---

## 8. Testing plan

### 8.1 Local / staging

1. Deploy `analyze-single-call` to a Supabase preview branch.
2. Apply the migration to that branch.
3. Manually invoke the trigger by running:
   ```sql
   INSERT INTO calls (id, studio_id, retell_call_id, created_at, duration_seconds, transcript, voicemail)
   VALUES (gen_random_uuid(), '<studio-id>', 'test-call-' || gen_random_uuid()::text, now(), 60, 'Agent: hi\nUser: hello\nAgent: ...', false);
   ```
4. Confirm a `call_reviews` row appears within ~30s with `trigger_type = 'realtime'`.

### 8.2 Production smoke test

1. Make one short real call through the production agent (`NEW TEST MOJO JFF`).
2. Watch `public.calls` for the new row (should appear within seconds).
3. Watch `public.call_reviews` for the matching row (should appear within ~60s).
4. Open the Call History tab — verify the Result label is *not* "Pending Review" by the time you scroll to that row.

### 8.3 Failure-mode tests

| Test | Expected behavior |
|---|---|
| Insert a call row with `transcript = NULL` | Trigger does not fire. |
| Insert a call row with `duration_seconds = 5` | Trigger does not fire (below threshold). |
| Insert a call row with `voicemail = true` | Trigger does not fire. |
| Re-update the same call row's transcript with the same value | Trigger does not refire (`IS DISTINCT FROM` blocks it). |
| Manually disable the edge function, then insert a call | Trigger fires `pg_net.http_post`, edge fn returns error, no `call_reviews` row created, daily cron picks it up next morning. |

---

## 9. Rollback plan

If anything goes sideways post-deploy:

1. **Disable the trigger** — fastest reversal:
   ```sql
   ALTER TABLE public.calls DISABLE TRIGGER calls_realtime_review_insert;
   ALTER TABLE public.calls DISABLE TRIGGER calls_realtime_review_update;
   ```
   The daily cron resumes being the sole review path. Zero data loss.

2. **Drop the trigger entirely** (if it caused a perf issue):
   ```sql
   DROP TRIGGER IF EXISTS calls_realtime_review_insert ON public.calls;
   DROP TRIGGER IF EXISTS calls_realtime_review_update ON public.calls;
   DROP FUNCTION IF EXISTS public.trigger_realtime_call_review();
   ```

3. **Keep `analyze-single-call` edge function deployed** — it's idempotent and harmless when not called. Useful for ad-hoc manual review of a specific call by ID.

4. **The "Pending Review" label remains functional** during rollback — calls already covered by the daily cron will flip from "Pending Review" → final label on the next morning's run, exactly as it works today.

---

## 10. Effort & sequencing

### Phase A — backend (this PR)

| Step | Effort | Owner | Can run in parallel? |
|---|---|---|---|
| 1. Build + deploy `analyze-single-call` edge function | 1.5 h | dev | — |
| 2. Write + apply migration (`review_enabled` column + trigger fn + triggers + GUC config) | 1.5 h | dev | needs Step 1 first |
| 3. Update `daily-call-review` to filter on `review_enabled` + log coverage gap | 30 min | dev | parallel with Step 1 |
| 4. Preview-branch verification matrix (§11A Phase A table) | 1 h | dev | needs Steps 1–3 |
| 5. Production smoke test | 30 min | dev | needs production deploy |
| **Phase A total** | **~5 h** | | |

### Phase B — UI toggle (separate PR, before new studio onboards)

| Step | Effort |
|---|---|
| Build toggle in `/settings/studios` | 1 h |
| Verify RLS / role gating | 30 min |
| Sandbox smoke test | 30 min |
| **Phase B total** | **~2 h** |

### Phase C — new studio onboarding (operational)

| Step | Effort |
|---|---|
| Set `review_enabled` correctly at studio creation | 5 min (1-line check during onboarding) |
| Live verification on first real call | 15 min |
| **Phase C total** | **~20 min** |

### Realistic calendar
- **Phase A: 1 dev-day** (including testing, PR review, prod smoke test)
- **Phase B: 0.5 dev-day**, runs in the gap between Phase A merge and new-studio onboarding
- **Phase C: same day as new-studio go-live**

---

## 11. Decisions (locked 2026-05-29)

| # | Decision | Why |
|---|---|---|
| 1 | **`call_reviews.trigger_type` value = `'realtime'`** | Natural pair to existing `'cron'` and `'manual'`. Enables coverage audits ("how often did realtime catch it vs the daily-cron fallback?"). Add `'realtime'` to any check constraint or enum guarding the column. |
| 2 | **Skip `voicemail = true` calls in the trigger** | The Result column for voicemail rows is derived from `calls.disconnected_reason` + the `voicemail_left` heuristic — no review data is consulted. Reviewing voicemail transcripts produces nothing useful. Wasted OpenAI spend, zero UX gain. |
| 3 | **GUC (not Vault) for the cron secret** | The cron secret is already in plaintext inside `cron.job.command` today — Vault doesn't materially improve security unless we also migrate cron, which is out of scope. GUC is one in-memory lookup per trigger fire vs Vault's per-call `vault.decrypted_secrets` query. Migration to Vault later is a 5-line change isolated to the trigger function. |
| 4 | **Add `studios.review_enabled boolean NOT NULL DEFAULT true` flag** — phased rollout (see §11A) | A second studio is onboarding in days. Default-true means zero behavioral change for existing studios; the column is dormant infrastructure until someone flips it. Migration is a one-liner; the trigger and daily cron each gain one `WHERE`/`EXISTS` check. |

### 11A. `review_enabled` phased rollout

Cautious, multi-check rollout — verify each phase before starting the next.

#### Phase A — backend only (this PR)
- Migration adds the column with `DEFAULT true` (no existing row changes value)
- `trigger_realtime_call_review()` checks `studios.review_enabled` and exits early if false
- `daily-call-review/index.ts` filters its eligibility query the same way
- **Verification matrix (all must pass before merge):**

| Test | Expected |
|---|---|
| Existing studio (`review_enabled = true`) — real call | `call_reviews` row appears ≤ 60s, `trigger_type = 'realtime'` |
| Existing studio (`review_enabled = true`) — daily cron run | Reviews yesterday's calls as it does today |
| Test studio with `review_enabled = false` — insert eligible call | NO `call_reviews` row created; no error in pg_net logs; edge fn not invoked |
| Flip test studio to `true`, re-UPDATE the transcript | `call_reviews` row created |
| Studios row missing the column (defensive — shouldn't happen) | Treated as enabled (NOT NULL + DEFAULT true blocks this state) |

#### Phase B — UI toggle (separate PR, before new studio onboards)
- Toggle in `/settings/studios` (super_admin only — RLS already enforces this for studios writes)
- Verify toggle persists to the column and round-trips
- Verify studio_owner / studio_staff cannot see or change the toggle
- Test on a sandbox studio before exposing to the new client

#### Phase C — new studio onboarding
- Confirm `review_enabled` is correctly set when the new studio's row is created (default-true unless explicitly disabled)
- Watch the first real call's review get created (or skipped, per setting)
- Have rollback playbook ready: SQL `UPDATE studios SET review_enabled = false WHERE id = ...` for instant disable

### 11B. Cross-phase safety measures
- Every change goes through a **Supabase preview branch first**, then prod
- **Production smoke test** with a real test call before declaring each phase done
- Monitor `call_reviews` daily count for ~48 h after deploy — should match prior-baseline rate, not drop or spike
- Cleanup tasks (see §5 Step 5) are **deliberately NOT bundled** with this work — keeps the blast radius small

---

## 12. Acceptance criteria

### Phase A (backend) is done when:
- [ ] An end-to-end test call from the production agent produces a `call_reviews` row within 60s of call end, with `trigger_type = 'realtime'`.
- [ ] The Call History UI shows the correct Result label (not "Pending Review") within ~60s of call end.
- [ ] The daily cron (`daily-call-review`) still runs and produces **zero** new reviews for the prior day (proves the realtime trigger covered them all).
- [ ] Re-running an insert on the same `calls` row does NOT create duplicate `call_reviews` rows.
- [ ] Rollback works — disabling the trigger reverts behavior to today's daily-cron-only flow with no data loss.
- [ ] `studios.review_enabled` exists with `NOT NULL DEFAULT true`. All existing studio rows have `review_enabled = true`.
- [ ] A test studio with `review_enabled = false` is correctly skipped by both the realtime trigger AND the daily cron (no `pg_net` invocation, no edge fn call).
- [ ] Flipping a studio's `review_enabled` from `false` → `true` and re-touching a transcript correctly produces a review.

### Phase B (UI) is done when:
- [ ] super_admin can toggle `review_enabled` from `/settings/studios` and see the change persist.
- [ ] studio_owner / studio_staff cannot see or modify the toggle (verified via RLS test).
- [ ] Toggling off then on for an existing studio behaves the same as direct SQL.

### Phase C (new studio onboarding) is done when:
- [ ] The new studio's `review_enabled` value matches what was specified during onboarding (default-true unless otherwise requested).
- [ ] The new studio's first real call produces — or correctly skips — a review per the flag.

### Items intentionally NOT in acceptance criteria (per §5 Step 5)
- The orphan stub `app/api/webhooks/retell-call/route.ts` — left as-is.
- The dead backup Retell agent — left as-is.

---

## 13. Reference — files touched

### Phase A (backend PR)
| File | Change |
|---|---|
| `supabase/functions/analyze-single-call/index.ts` | **new** — edge fn that reviews a single call by ID; writes `trigger_type = 'realtime'` |
| `supabase/migrations/0NN_realtime_call_review_trigger.sql` | **new** — adds `studios.review_enabled` column + trigger fn + insert/update triggers |
| `supabase/functions/daily-call-review/index.ts` | **edit** — eligibility query filters on `studios.review_enabled = true`; adds coverage-gap log |
| `supabase/functions/analyze-call-quality/index.ts` | **no change** — kept for manual backfill |
| `lib/types.ts` | **edit** — add `review_enabled: boolean` to the `Studio` type |
| `components/call-history/call-history-shell.tsx` | **no change** — existing precedence already handles realtime arrival |
| `components/call-history/call-detail-drawer.tsx` | **no change** |
| `lib/constants.ts` | **no change** — "Pending Review" badge already exists |

### Phase B (UI PR — separate)
| File | Change |
|---|---|
| `components/settings/studios/...` (or equivalent) | **edit** — add `review_enabled` toggle |
| `app/actions.ts` | **edit** — server action to update the flag (super_admin only) |

### Phase C (operational)
No code changes — operational only. May involve a one-line check in the studio onboarding/creation flow if it doesn't already pull from form input.

### Files deliberately NOT touched (per §5 Step 5)
- `app/api/webhooks/retell-call/route.ts` — orphan stub, left as-is per the "no code deletion" rule.
- Retell agent configurations — read-only inspection only per the "no Retell mutations without explicit approval" rule.
