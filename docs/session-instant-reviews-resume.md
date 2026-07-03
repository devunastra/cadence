# Resume Note — Instant Call Reviews

**Last touched:** 2026-06-01
**Status:** Backend LIVE in production. Frontend edits done but uncommitted, pending local test before ship.

---

## Bottom line

The realtime trigger → edge function → call_reviews → Realtime publication pipeline is **fully wired and validated in prod**. Any call coming in right now will be analyzed within ~15–30s. Users still need to refresh to see the result update because the Realtime UI subscription is in an uncommitted file. After local test + commit + push, the Result label will flip live without refresh.

---

## What's live in prod (do NOT re-apply or redeploy)

| Layer | State |
|---|---|
| Migration **040** (column + initial trigger w/ GUCs) | Applied |
| Migration **041** (function reads from Vault) | Applied |
| Migration **042** (function adds Authorization header) | Applied |
| Postgres trigger `calls_realtime_review_on_insert` | Attached, active |
| Postgres trigger `calls_realtime_review_on_transcript_update` | Attached, active |
| Function `trigger_realtime_call_review()` | Uses Vault, reads 3 secrets, defensive |
| Edge function `analyze-single-call` | v1, verify_jwt=true |
| Edge function `daily-call-review` | v6 (added review_enabled filter + realtime_coverage log) |
| `studios.review_enabled boolean NOT NULL DEFAULT true` | All 12 studios = true |
| `call_reviews` in `supabase_realtime` publication | Yes |
| Vault secret `analyze_single_call_url` | id `ee1df4ee-18a0-4c70-8990-95a0cd3f75a2` |
| Vault secret `cron_secret` | id `11fc72c7-4d33-4a7d-b1f8-8a9e7a7ca2d3` (set to `c96f10b9...9c3dc558`) |
| Vault secret `supabase_anon_jwt` | id `b1d1a63d-4bf5-4d32-8a32-9ebbca8ad1f2` |

Validation: pg_net request 547 returned 200 + `{skipped: "already_reviewed"}` against call `a27e29bd-be94-4d10-a5fc-8265572467dd` — proves Vault → pg_net → gateway-auth → function-auth → response chain works.

---

## What's NOT shipped (uncommitted working tree)

```
M  components/call-history/call-history-shell.tsx  (+33 — Realtime subscription on call_reviews)
M  lib/types.ts                                     (+1/-1 — Studio.review_enabled + CallReview.trigger_type 'realtime')
M  supabase/functions/daily-call-review/index.ts    (already deployed, file just needs commit)
?? supabase/functions/analyze-single-call/index.ts  (already deployed, file just needs commit)
?? supabase/migrations/040_realtime_call_review_trigger.sql        (applied, file just needs commit)
?? supabase/migrations/041_realtime_call_review_use_vault.sql      (applied, file just needs commit)
?? supabase/migrations/042_realtime_call_review_add_auth_header.sql (applied, file just needs commit)
```

TypeScript check: `tsc --noEmit` passes (exit 0).

---

## Local test plan (do this FIRST tomorrow)

1. `npm run dev`
2. Open the Call History page in your local browser (login as a user with access to a real or test studio)
3. Make a test call to **Joshua's test agent** (NOT prod): `agent_1605a239e08d6100f7422d194e`
4. Watch the Call History page. Within ~15–30s after the call ends, the new call's Result column should flip from "Pending Review" to the final label (Booked / Callback Requested / etc.) **without you refreshing**.
5. If it works → commit + push (next section).
6. If it doesn't → check edge function logs via MCP: the function should show `[analyze-single-call] processing call_id=... SUCCESS grade=...`. If those appear, the backend works and the issue is the frontend subscription. If they don't appear, the trigger isn't firing — check Postgres logs for `trigger_realtime_call_review` lines.

---

## Commit + push (after local test passes)

```bash
git add \
  components/call-history/call-history-shell.tsx \
  lib/types.ts \
  supabase/functions/daily-call-review/index.ts \
  supabase/functions/analyze-single-call \
  supabase/migrations/040_realtime_call_review_trigger.sql \
  supabase/migrations/041_realtime_call_review_use_vault.sql \
  supabase/migrations/042_realtime_call_review_add_auth_header.sql

git commit -m "$(cat <<'EOF'
feat(call-history): instant call reviews via Postgres trigger + edge fn + Realtime UI

Adds analyze-single-call edge function fired by a Postgres trigger on
calls INSERT/transcript-UPDATE via pg_net, with auth/config in Supabase
Vault. Call History Result column flips from "Pending Review" to its
final label within ~15-30s of a call ending (was up to 31h). Daily cron
remains as safety net with new review_enabled filter + coverage log.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

git push origin staging
```

(Netlify will auto-deploy from staging.)

---

## Gate 10 (after push): prod smoke test

Make a real call via prod agent `agent_c6c4facfa0c12f9d7e1f1a8c83`. Confirm same behavior on the deployed Netlify build.

---

## CRON_SECRET discrepancy — worth knowing

The value Joshua originally sent (`d79c5814...`) does NOT match what's actually in production. The real value is `c96f10b9...9c3dc558` — verified by reading `cron.job` for the working daily-call-review schedule.

Vault was updated to match production. No further action needed unless you want to rotate the secret (in which case: update Supabase env vars AND `cron.job` command AND Vault entry together).

---

## Do NOT touch (still applies)

- `app/api/webhooks/retell-call/route.ts` — orphan 200-OK stub. Leave it.
- Any Retell agent / phone / LLM via MCP — read-only inspection is fine; mutations require Joshua's per-action approval.

---

## If something breaks overnight

The backend is defensive:
- Trigger function is wrapped in `EXCEPTION WHEN OTHERS` — any internal error is swallowed, calls writes always succeed
- pg_net is fire-and-forget — failures don't block writes
- Vault read failures → trigger logs and skips, calls writes unaffected
- Edge function returns 200 for all eligibility skips — never blocks

Worst case: realtime trigger silently fails for some call → daily cron catches it at 07:00 UTC the next day (cron is the safety net).

Rollback path if needed (would require Joshua to run as postgres):
```sql
DROP TRIGGER IF EXISTS calls_realtime_review_on_transcript_update ON public.calls;
DROP TRIGGER IF EXISTS calls_realtime_review_on_insert ON public.calls;
-- Leave the function, column, vault secrets, and publication change in place;
-- they're harmless if the triggers don't reference them.
```
