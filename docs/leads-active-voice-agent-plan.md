# Plan — Active Outbound Voice Agent Selector (Leads tab)

> **Status:** App side **BUILT & committed** on branch `feature/active-outbound-agent-selector` (commit `3a10cfa`) — `tsc --noEmit` clean. Not pushed/merged. **Migration 048 not yet applied to the DB.** n8n steps (§7) are **pending — manual by Joshua**.
> **Author:** Claude
> **Date:** 2026-06-22

---

## Context

The client wants, in the **Leads** tab, a dropdown of the studio's Retell voice agents. Whichever agent is selected becomes the one that **calls future leads**. Today the calling agent is **hardcoded inside n8n** (the "Trigger Retell Outbound Call" node pins both `override_agent_id` and `override_agent_version`), so switching agents means an engineer editing the workflow. This feature moves that choice into the app: the studio picks an agent in the UI, the selection is stored in Supabase, and n8n reads it at call time.

**Chosen integration path (confirmed by Joshua):** App → Supabase → n8n → Retell. The app never calls Retell for this; it only writes the selection to a studio column. n8n reads that column and passes it to Retell's `create-phone-call` as `override_agent_id`.

**Decisions locked with Joshua:**
1. **Agent version = always latest published.** n8n omits `override_agent_version`; Retell auto-uses the agent's latest published version. (Removes the lockstep version-pin chore for outbound — see [[outbound_version_pins]].)
2. **Caller ID = keep the studio's current number.** Only the agent changes; `from_number` stays hardcoded in n8n.
3. **Rollout = Lincolnshire first.** App UI is generic (any studio); only the Lincolnshire n8n clone (`LXlMa0Gy2Fq2xuUO`, "Voice AI Functions copy (Joshua)") gets wired now. Schaumburg (`Wgg5bQTPJYFsDSn8`) is deferred until confirmed to be a clone, not production.

---

## How the pieces already line up (reuse-first)

Almost everything needed already exists:

| Need | Reuse | Location |
|---|---|---|
| Per-studio agent list (dropdown source) | `studio_test_agents` table + `getStudioTestAgents()` | `supabase/migrations/043_studio_test_agents.sql`, `lib/test-agents.ts:14` |
| Agent-list API (session/studio/membership-guarded, returns `{id,label}`) | **`GET /api/test-agents`** — reuse as-is | `app/api/test-agents/route.ts` |
| Dropdown component | `SimpleSelect` | `components/simple-select.tsx` |
| Fetch-on-mount + select pattern | `/test` page `AgentDropdown` | `app/(app)/test/page.tsx:102` |
| Server-action template (role gate → service-client `studios` update → fire-and-forget activity log → `revalidatePath`) | `setVoiceAgentEnabled` | `app/actions.ts:641` |
| Realtime studio-row subscription | `VoiceAgentToggle` | `components/leads/voice-agent-toggle.tsx:108` |
| Studio column auto-loads (uses `select('*')`) | `getStudios` | `lib/data-cache.ts:30` |
| Context get/patch | `useCurrentStudio()` / `updateCurrentStudio()` | `components/studio-context.tsx` |
| Header placement (next to the toggle) | leads page header block | `app/(app)/leads/page.tsx:13` |

New code is small: one migration, one type field, one server action, one component, one filter tweak, plus the n8n clone wiring.

---

## Implementation

### 1. Database — `supabase/migrations/048_studios_active_outbound_agent.sql` (new)
- `ALTER TABLE studios ADD COLUMN IF NOT EXISTS active_outbound_agent_id text;` — nullable. **NULL means "fall back to `retell_agent_id`"** (the studio's default), so existing rows need no backfill.
- Idempotent. No RLS change — `studios` is already scoped and read via `select('*')`.

### 2. Type — `lib/types.ts`
- Add `active_outbound_agent_id: string | null` to the `Studio` interface (near the other `retell_*` / `voice_agent_*` fields). Flows everywhere automatically via `select('*')`.

### 3. Server action — `app/actions.ts` (new `setActiveOutboundAgent`)
Model on `setVoiceAgentEnabled` (`app/actions.ts:641`):
1. `getUser()`; throw `Unauthorized` if none.
2. Role gate: `studio_owner`/`super_admin` of this studio, else global `super_admin`, else `Forbidden` (identical to the toggle's check).
3. **Validate the agent belongs to this studio** — confirm `agentId` exists in `studio_test_agents` for `studioId` (`is_active = true`). Reject otherwise (don't trust client input; blocks storing a foreign/typo agent id). Allow `''`/null to reset → `NULL` (use studio default).
4. Service-client `update({ active_outbound_agent_id: agentId || null }).eq('id', studioId)`.
5. Fire-and-forget `activity_logs` insert (`lead_name: 'Outbound agent changed: <label>'`, `actor_email`, `event_type: 'update'`) — same pattern as `setVoiceAgentEnabled`.
6. `revalidatePath('/leads')`.

### 4. Component — `components/leads/outbound-agent-selector.tsx` (new, `'use client'`)
- `useCurrentStudio()` → `currentStudio`, `updateCurrentStudio`, `userRole`, `isSuper`. `canEdit = isSuper || userRole === 'studio_owner'` (mirror the toggle).
- Fetch agents on mount: `fetch('/api/test-agents')` → `agentOptions: {id,label}[]` (mirror `app/(app)/test/page.tsx:34`).
- Selected value = `currentStudio.active_outbound_agent_id` ?? the option whose `id === currentStudio.retell_agent_id` (so the effective default is preselected) ?? `''`.
- Render `SimpleSelect` (label e.g. **"Outbound agent"**, caption "Calls future leads"). On change: optimistic `updateCurrentStudio({ active_outbound_agent_id })`, call `setActiveOutboundAgent`; on error show toast + revert.
- **Realtime:** subscribe to `studios` UPDATE for `id=eq.currentStudio.id` and merge `active_outbound_agent_id` (copy `voice-agent-toggle.tsx:108`).
- **States:** loading → muted "Loading agents…"; empty → muted "No voice agents configured"; staff (`!canEdit`) → disabled `SimpleSelect` showing the current agent (read-only).

### 5. Placement — `app/(app)/leads/page.tsx`
Put the selector beside `VoiceAgentToggle` in the existing `flex-shrink-0 px-5 pb-3` block:
```tsx
<div className="flex-shrink-0 px-5 pb-3 flex flex-col md:flex-row md:items-center gap-3">
  <VoiceAgentToggle />
  <OutboundAgentSelector />
</div>
```

### 6. Call-attribution companion change (required) — `app/actions.ts:1558`
`syncRetellCallsNow` pulls calls with `filter_criteria: { agent_id: [studio.retell_agent_id], … }`. If the active agent differs from `retell_agent_id`, its calls would never sync → invisible in Call Analytics/History. Fix: build the `agent_id` array from the studio's **full** agent set — `studio_test_agents.agent_id` (active) ∪ `{ retell_agent_id, retell_inbound_agent_id }`, deduped, falsy-filtered — and pass that array. Fall back to current behavior if the set is empty.
- This is the **only** agent-filtered sync site today (the Retell webhook is a stub: `app/api/webhooks/retell-call/route.ts`; no cron route exists post-Netlify). During impl, grep for any Netlify scheduled function doing the same and apply the same filter.

### 7. n8n — Lincolnshire clone `LXlMa0Gy2Fq2xuUO` (MANUAL — Joshua applies; no automated edits)

> **Verified against the live workflow 2026-06-22 (read-only).** The outbound dialer path is:
> `Get row(s)` (Data Table "AI Callback", id `9U0GXNR5uRUTWUPy`) → `Loop Over Items` → `Phone Number Formatting` → `Get Field Option IDs` → `Aggregate` → **`Resolve Field IDs`** → **`Trigger Retell Outbound Call`** (id `89ae6077…`) → `Update row(s)`.
> There is **no** "Fetch Studio" node (earlier research assumed one — it does not exist). `studio_id` **is** available: `Resolve Field IDs` outputs `studio_id` (derived from the field-options query).

**Step 1 — Add a Supabase read node "Get Active Outbound Agent"**
- Type: **Supabase → Get a row** (reuse the credential already on the existing Supabase nodes such as "Get a row" / "Get Lead (ended)"; project ref `npcpkffnswzvzmqolort`).
- Table `studios`, filter `id = {{ $('Resolve Field IDs').item.json.studio_id }}`.
- Insert on the wire between `Resolve Field IDs` and `Trigger Retell Outbound Call` (Resolve Field IDs → **Get Active Outbound Agent** → Trigger Retell Outbound Call).
- Safe because the Retell node references all its data by node name (`$('Phone Number Formatting')…`), so replacing the current item with the studios row does not disturb it.

**Step 2 — Edit the "Trigger Retell Outbound Call" JSON body**
- Change `override_agent_id` (currently the hardcoded `"agent_cd8a872b64a03338e6c54a41a0"`) to:
  ```
  {{ $('Get Active Outbound Agent').item.json.active_outbound_agent_id || $('Get Active Outbound Agent').item.json.retell_agent_id || 'agent_cd8a872b64a03338e6c54a41a0' }}
  ```
  (active selection → studio default → last-resort literal = today's agent, so it can never be worse than now.)
- **Delete the `"override_agent_version": 13` line** (→ Retell uses the agent's latest published version, per decision #1).
- Leave `from_number` (`+17623713782`), `to_number`, and `retell_llm_dynamic_variables` exactly as-is.
- **Do not touch the `Authorization` header.** ⚠️ The Retell API key is currently hardcoded inline in that header — consider moving it to an n8n credential later (separate hardening, out of scope here).

**Step 3 — Pre-flight & test (on the clone)**
- Confirm `studios.retell_agent_id` for Lincolnshire = `agent_cd8a872b64a03338e6c54a41a0`, so the fallback preserves current behaviour.
- "Get row(s)" is currently filtered to the test email `jdrsalve@gmail.com` (called_at isEmpty) — keep using a test row while validating.
- Set `studios.active_outbound_agent_id` to the *second* Lincolnshire agent, run the loop on a test row, open the `Trigger Retell Outbound Call` execution, and confirm the request body shows `override_agent_id` = the selected agent and **no** `override_agent_version`. Reset afterwards.
- **Deploy the app migration (adds `active_outbound_agent_id`) BEFORE** this node goes live — otherwise the Supabase read has no such column and the expression falls back to `retell_agent_id` (still safe — behaves as today).

**Do not modify the Schaumburg workflow** (`Wgg5bQTPJYFsDSn8`). Wire it the same way later, on its own clone, once confirmed.

---

## Edge cases
- **No agents for studio** → selector shows "No voice agents configured"; n8n falls back to `retell_agent_id`.
- **Stored agent later removed** from `studio_test_agents` → preselect shows it as raw id / "Unknown agent"; n8n still sends it (Retell 400s on a truly invalid id — a clear, safe failure).
- **Staff** → read-only selector. **Super admin** switching studios → sees that studio's agents (route already studio-scopes).
- **Pause (kill switch)** is orthogonal — `VoiceAgentToggle` still governs whether calls happen at all; this only governs *which* agent.
- **from_number ≠ selected agent's number** is intentional (decision #2) and valid per Retell (any published agent may call from any owned number).

---

## Verification (end-to-end)
1. **DB:** apply migration (branch/local); confirm `active_outbound_agent_id` exists on `studios`.
2. **App (owner):** `/leads` shows the selector with the effective agent preselected; change it → success toast; refresh → persists; second session → updates via Realtime.
3. **Roles:** staff sees it read-only; bad input (agent id not in `studio_test_agents`) → action rejects.
4. **n8n (clone, test):** set `active_outbound_agent_id` to the *second* Lincolnshire agent; run the outbound workflow with a test lead; inspect the Retell request body → `override_agent_id` = selected, **no** `override_agent_version`; confirm Retell places the call with that agent. Reset after.
5. **Attribution:** after a test call by the non-default agent, run "Sync now" → the call appears in Call History/Analytics (proves the agent-array filter).

---

## Files
**New:** `supabase/migrations/048_studios_active_outbound_agent.sql`, `components/leads/outbound-agent-selector.tsx`
**Edit:** `lib/types.ts`, `app/actions.ts` (new action + `syncRetellCallsNow` filter), `app/(app)/leads/page.tsx`
**Reuse (no change):** `components/simple-select.tsx`, `app/api/test-agents/route.ts`, `lib/test-agents.ts`, `components/studio-context.tsx`, `lib/data-cache.ts`
**n8n (separate, on publish):** clone `LXlMa0Gy2Fq2xuUO`

## Suggested execution (when approved)
- **senior-software-engineer** — migration + type + action + component + page + attribution fix (app side only).
- **n8n (you, manual):** apply §7 on the `LXlMa0Gy2Fq2xuUO` clone yourself — no automated n8n edits will be made on your behalf.
- **code-reviewer / qa-tester** — review + role/RLS/dark-mode/edge-case pass before ship.

## Out of scope (this pass)
Schaumburg n8n wiring; per-agent version pinning; swapping caller-ID `from_number`; any inbound-agent change.
