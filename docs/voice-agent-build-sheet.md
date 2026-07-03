# Voice Agent Build Sheet — Top-10 Prioritized Backlog

> **Purpose.** This document translates the [voice-agent-spec.md](voice-agent-spec.md) into actionable work. Each ticket below is implementable as-written by one engineer in one sitting (or one focused day, for larger items). The spec describes *what* and *why*; this sheet describes *exactly how* and *in what order*.
>
> **Scope guard.** Every change targets one agent: **`TEST AI (Joshua copy)`** (`agent_1605a239e08d6100f7422d194e`), conversation flow `conversation_flow_382e66ab131b`, and the matching n8n workflow `Voice AI Functions copy (Joshua)` (`LXlMa0Gy2Fq2xuUO`). **Never modify production originals.**
>
> **Discipline reminder.** Every ticket goes through [spec §0](voice-agent-spec.md#0-change-discipline-non-negotiable) and [spec §13](voice-agent-spec.md#13-definition-of-done-for-a-change). Do not skip steps just because a ticket looks small.

---

## Effort scale

| Tag | Meaning |
|---|---|
| XS | < 30 min — single config flip, one-line prompt edit, no test calls beyond smoke |
| S | 30 min – 2 hr — 1–3 node edits, one or two test calls, no external coordination |
| M | 2–6 hr — new node OR n8n workflow change OR new dynamic variable, coverage test calls |
| L | 1–3 days — cross-team work (n8n + Retell + Supabase) or new variable contract |
| XL | > 3 days — architectural shift |

---

## Priority matrix used

`impact × feasibility × urgency`, with ties broken in favor of the change that **reduces caller-facing failure** over the change that adds polish.

---

## The Top 10 (in rollout order)

| # | Ticket | Effort | Status | Source in spec |
|---|---|---|---|---|
| 1 | [BS-01: Remove "virtual assistant" disclosure from greetings](#bs-01) | XS | ✅ Shipped v34 (2026-05-22) | [D1](voice-agent-spec.md#d1-sarah-self-discloses-as-virtual-assistant--client-script-does-not) |
| 2 | [BS-02: Graceful empty-email handling in create_appointment](#bs-02) | S | ✅ Applied to v37 draft + n8n live (2026-05-22) | [12.1.3](voice-agent-spec.md#121-reliability--correctness) |
| 3 | [BS-03: Reduce tool timeouts 120 000 ms → 8/10 s](#bs-03) | S | ✅ Shipped v34 (2026-05-22) | [12.2.6](voice-agent-spec.md#122-latency) |
| 4 | [BS-04: parseTime support for "noon" / "midnight" / "half past" / "quarter to"](#bs-04) | S | ✅ Applied to v36 draft (2026-05-22) | [12.1.1](voice-agent-spec.md#121-reliability--correctness) |
| 5 | [BS-05: Set reminder_trigger_ms (silence nudge)](#bs-05) | XS | ✅ Shipped v34 (2026-05-22) | [12.3.9](voice-agent-spec.md#123-natural-conversation) |
| 6 | [BS-06: Style-aware personalized greeting (D12)](#bs-06) | M | Pending | [D12](voice-agent-spec.md#d12-specific-dance-personalization-scenario-2-is-missing-in-current-greetings) |
| 7 | [BS-07: Confirmation day/date/time read-back (D3)](#bs-07) | M | Pending | [D3](voice-agent-spec.md#d3-confirmation-phrasing) |
| 8 | [BS-08: Trust-and-Announce race-condition recovery](#bs-08) | S | ✅ Applied to n8n Get Alternates jsCode (2026-05-22) | [12.1.4](voice-agent-spec.md#121-reliability--correctness) |
| 9 | [BS-09: Hesitancy handler (D4)](#bs-09) | M | Pending | [D4](voice-agent-spec.md#d4-hesitancy-handler-is-missing) |
| 10 | [BS-10: Wedding-specific probes (D11)](#bs-10) | M | Pending | [D11](voice-agent-spec.md#d11-wedding-probes-are-scenario-specific-in-the-client-script-generic-in-the-agent) |

### Defect-driven additions (discovered from call analysis 2026-05-22)

| # | Ticket | Effort | Status | Source |
|---|---|---|---|---|
| 11 | [BS-11: Tool execution-message description fix (`availability_check` + `day_slot_check`)](#bs-11) | XS | ✅ Shipped v35 (2026-05-22) | Tool config audit during call analysis |
| 12 | [BS-12: Strict return-from-escalation bridge guard (8 nodes)](#bs-12) | S | ✅ Shipped v35 (2026-05-22) | call_bed2029 — bridge misfired on caller confusion |
| 13 | [BS-13: Mandatory callback time echo in Get Callback Time subagent](#bs-13) | S | ✅ Shipped v35 (2026-05-22) | call_09402d2f — confirmation echo skipped |
| 14 | BS-14: Wait-for-user-decision + Explain-lesson-again rules on Get Preferred Time | S | ✅ Applied to v38 draft (2026-05-22) | call_c6f4 — caller asked "tell me more" 3x, agent looped on "what date and time?" |
| 15 | BS-15: Bump Main Pitch interruption_sensitivity 0.6 → 0.8 | XS | ✅ Applied to v38 draft (2026-05-22) | call_7bb3 — agent kept reciting pitch through caller's "stop. stop. stop." |

**Deferred to next batch** (justification in §1 at the end of this doc):

- D2 "Taste-tester" framing — optional A/B test
- D5 Pricing-push escalation phrasing — minor refinement
- D13 Family-wedding routing — blocked on GHL inquiry form change (cross-team)
- D14 Reactive empathy lines — quality polish
- 12.2.7 Speculative availability check — needs Retell platform support
- 12.2.8 Cache `earliest_slot` for 60s — small latency win
- 12.3.10 Wider backchannel vocabulary — quality polish
- 12.4.13–16 Coverage items (partial callback, multi-person, package pricing, "not interested" marking)
- 12.5.17/18 Voicemail detection_prompt + per-reason voicemail message
- D7 Open hours discrepancy — **external blocker**: needs client confirmation

---

## BS-01 — Remove "virtual assistant" disclosure from greetings

**Spec link.** [D1](voice-agent-spec.md#d1-sarah-self-discloses-as-virtual-assistant--client-script-does-not) · Effort: **XS** · Risk: **none**

### Why

1. The agent's own global prompt rule (spec §2) says *"Never say you are an AI unless directly asked."* The current greeting violates that rule.
2. Neither of the client-provided documents has Sarah self-disclose as "virtual assistant" in any opening.
3. Advances Goal 1 (sound human) in spec §1.

### Where (4 nodes)

| Node ID | Node name | Section in spec |
|---|---|---|
| `node-1774094516287` | Reason Wedding | [§17.2](voice-agent-spec.md#172-greeting-nodes-one-per-reason) |
| `node-1774094517507` | Reason Special Occasion | §17.2 |
| `node-1774094518930` | Reason For Fun | §17.2 |
| `node-1774931569845` | General Greeting | §17.2 |

If a `Callback Greeting` node exists (it should, per spec §4.1 and the agent v33+ version description), apply the same change to it.

### Diff per node

**Reason Wedding** (`node-1774094516287`) `instruction.text`:

```diff
 IF RETURNING FROM ESCALATION ACKNOWLEDGEMENT: Don't repeat the greeting line. Say: "Alright, should we proceed to scheduling?"

-Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I'm their virtual assistant and I heard you are preparing for a wedding. How exciting! Is now a good time to chat?"
+Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I heard you are preparing for a wedding. How exciting! Is now a good time to chat?"

 Call behaviours:
 Limit the conversation to verifying with the user whether now is a good time to chat, do not answer anything else.
```

**Reason Special Occasion** (`node-1774094517507`):

```diff
-Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I'm their virtual assistant and I noticed you are preparing for a special occasion. Great! Is now a good time to chat?"
+Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I noticed you are preparing for a special occasion. Great! Is now a good time to chat?"
```

**Reason For Fun** (`node-1774094518930`):

```diff
-Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I'm their virtual assistant and it sounds like you're looking to learn some dancing! Is now a good time to chat?"
+Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. It sounds like you're looking to learn some dancing! Is now a good time to chat?"
```

**General Greeting** (`node-1774931569845`):

```diff
-Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I'm their virtual assistant and I heard you wanted to dance! Is now still a good time to chat?"
+Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I heard you wanted to dance! Is now still a good time to chat?"
```

### Acceptance criteria

- ✅ All four greeting nodes' first spoken sentence omits the phrase "I'm their virtual assistant and" (or any equivalent self-disclosure).
- ✅ If caller directly asks "are you a real person?" / "are you an AI?", Sarah confirms briefly via the global prompt's existing "may confirm without elaboration" rule. (No new node needed; existing behavior covers this.)
- ✅ Test cases [G1, G2, G3, G6](voice-agent-spec.md#2011-greeting-paths) still pass.
- ✅ No regression on Trust-and-Announce, Bad Time, Escalation, SMS, Voicemail paths (regression suite).

### Test plan

1. **Smoke** — 1 call per reason (Wedding, Special Occasion, For Fun, default → For Fun fallback): confirm first sentence omits the disclosure.
2. **Adversarial** — 1 call where caller asks "wait, are you a robot?" mid-greeting → Sarah confirms briefly and proceeds.
3. **Regression** — Re-run smoke from §20.2 of the spec.

### Open questions

- Does a `Callback Greeting` node exist in the live agent? Verify before publishing. If yes, include in this ticket; if no, log as Open Issue.

---

## BS-02 — Graceful empty-email handling in `create_appointment`

**Spec link.** [12.1.3](voice-agent-spec.md#121-reliability--correctness) · Effort: **S** · Risk: **medium** (touches the booking critical path) · **Status:** ✅ Applied 2026-05-22 (v37 draft + n8n live); see "Final shipped diff" below.

### Final shipped diff (different from original Option B plan above)

After pre-flight, the actual `Search Contact` n8n node uses GHL's general `/contacts?query=<text>` endpoint (multi-field text search), NOT `/contacts/lookup`. So the rewrite is simpler than the original plan:

**n8n side — `Search Contact` node (`e10ab3c2-848a-4d95-aac3-afb2eb28e531`):** Updated `parameters.queryParameters.parameters[1].value` from:
```
={{ $('Create Appointment').item.json.body.email }}
```
to:
```
={{ ($('Create Appointment').item.json.body.email || '').trim() || ($('Create Appointment').item.json.body.phone_number || '').trim() || 'NO_IDENTITY' }}
```

Behavior:
- Non-empty email → email-based lookup (no change from before).
- Empty email + non-empty phone → phone-based lookup (the fix).
- Both empty → query is literal `"NO_IDENTITY"` → GHL returns no contact → existing `?? ''` fallback in Create New Event → `Failed to create appointment` (graceful, no wrong-contact attachment).

**Retell side — `create_appointment` tool:**
```diff
- "required": ["description", "email", "time"],
+ "required": ["description", "time"],
  "properties": {
    "description": { ... },
    "email": { ... },
+   "phone_number": { "type": "string", "const": "{{ phone_number }}" },
    "time": { ... }
  }
```

`email` still passed (now optional). `phone_number` added as passthrough.

**Forward-compatibility note:** the n8n change is forward-compatible with v36 published — v36 callers don't send `phone_number`, so the fallback chain skips it; behavior on v36 is identical to before. The empty-email fix only activates after v37 publishes.

### Why

`create_appointment` requires `email`. When the GHL lead form didn't capture an email (the lead came in via SMS or phone-only inquiry), `{{email}}` is empty → the tool returns `Failed to create appointment` → caller routes through `Appointment Failure` → likely escalation. **Every email-less lead currently fails to book.** Confirmed by the contract in [spec §18.5](voice-agent-spec.md#185-create_appointment) (parameter `email` is required).

### Two design options

| Option | What it does | Trade-off |
|---|---|---|
| **A. Ask Sarah to collect email mid-call** | Sarah asks "What's the best email for your confirmation?" when `{{email}}` is empty, just before booking | One extra turn; caller may not have email handy |
| **B. (Recommended) Make email optional on the n8n workflow side** | n8n's Create Appointment workflow stops requiring email; uses phone-number-based contact lookup as fallback | Single-source fix; caller sees no change |

**Pick B.** Caller flow stays clean. Sarah's spoken behavior unchanged.

### Where

- **n8n workflow** `Voice AI Functions copy (Joshua)` (`LXlMa0Gy2Fq2xuUO`)
- **Node**: `Search Contact` (`e10ab3c2-848a-4d95-aac3-afb2eb28e531`) — currently does GHL `/contacts/lookup?email=…` only.
- **Tool config** in Retell flow: tool-1773483027421 (`create_appointment`) — currently has `email` in `required`.

### Diff

#### n8n change — `Search Contact` node

Change the GHL lookup to try email first, fall back to phone:

```diff
- GET /contacts/lookup?email={{ $json.email }}
+ // If email is non-empty, try email first; else try phone:
+ GET /contacts/lookup?email={{ $json.email }}&phone={{ $json.phone_number }}
+ // GHL's lookup endpoint accepts multiple params; first match wins.
```

If both empty (should not happen — outbound caller has at least a phone), respond with `Failed to create appointment` + `error_message: "no_contact_identity"`.

#### Retell tool config change — `create_appointment`

```diff
 {
   "name": "create_appointment",
   "parameters": {
     "type": "object",
-    "required": ["description", "email", "time"],
+    "required": ["description", "time"],
     "properties": {
       "description": { "type": "string", "const": "{{ dance_interest }}" },
-      "email":       { "type": "string", "const": "{{ email }}" },
+      "email":       { "type": "string", "const": "{{ email }}" },
+      "phone_number": { "type": "string", "const": "{{ phone_number }}" },
       "time":        { "type": "string", "description": "the time they chose for the booking in ISO 8601 format" }
     }
   }
 }
```

Add `phone_number` as a passthrough so n8n can use it as fallback.

### Acceptance criteria

- ✅ With `email=""` + `phone="+15555551234"`: `create_appointment` returns `Appointment created successfully` and the GHL contact lookup uses phone.
- ✅ With both `email="x@y.com"` + `phone="..."`: email-based lookup wins (no behavior change for normal case).
- ✅ With both empty: returns `Failed to create appointment` with `error_message: "no_contact_identity"` (graceful fail, not a crash).
- ✅ No regression on §20.1.3 booking tests (B1–B17).

### Test plan

1. Outbound a test lead with `email=""`, `phone` populated. Run B1 happy path. Should book.
2. Outbound a test lead with both populated. Should still book.
3. Outbound with both empty (simulate via test trigger). Should hit Appointment Failure with the new error_message.

### Open questions

- Does GHL's `/contacts/lookup` support combined `email` + `phone` query params? Confirm by hitting the endpoint with both, both empty, only one. Adjust the n8n node accordingly.

---

## BS-03 — Reduce tool timeouts 120 000 ms → 8 000 ms

**Spec link.** [12.2.6](voice-agent-spec.md#122-latency) · Effort: **S** · Risk: **low** (existing Error edges absorb failures)

### Why

All 10 tools currently have `timeout_ms: 120000` ([spec §5](voice-agent-spec.md#5-tools-external-webhooks)). If n8n hangs, the caller sits silently for 2 minutes. The flow's Error-edge handling kicks in only after timeout. We can fail fast in 8s and route to the graceful error path much sooner.

### Where

All 10 tool definitions in the Retell conversation flow's `tools` array. Tool IDs:

| Tool | tool_id |
|---|---|
| schedule_ai_callback | tool-1773476107645 |
| create_appointment | tool-1773483027421 |
| get_current_datetime | tool-1773483200841 |
| update_dance_interest | tool-1773483324165 |
| reschedule_appointment | tool-1773483394937 |
| delete_appointment | tool-1773483426005 |
| escalate_message | tool-1773483525114 |
| get_earliest_slot | tool-1773896569777 |
| availability_check | tool-1774085096900 |
| day_slot_check | tool-1774105669590 |

### Diff per tool

```diff
- "timeout_ms": 120000,
+ "timeout_ms": 8000,
```

For `create_appointment` and `reschedule_appointment` specifically (which do multiple GHL round trips), use **10 000 ms** — slightly more headroom:

```diff
- "timeout_ms": 120000,
+ "timeout_ms": 10000,
```

### Acceptance criteria

- ✅ When a tool's n8n workflow hangs (force a sleep > 10s in test), the Retell flow routes to the Error edge within 8–10 seconds.
- ✅ Normal-latency tool calls (< 3s) are unaffected.
- ✅ No regression on any §20.1 test case under normal conditions.

### Test plan

1. **Negative**: temporarily inject a `wait(15s)` in the `availability_check` n8n workflow. Place a test call, request a time. Expect: Sarah says "I'm sorry, something went wrong on my end. I will now attempt to transfer the call to my team leader" within ~8s, not 2 min.
2. **Positive**: full smoke from spec §20.2 — confirm no regression.

### Open questions

- Are 8s / 10s the right values? Measure p95 of each tool from past 30 days of n8n executions. If p95 > 6s for any tool, bump that tool's timeout to `1.5 × p95`.

---

## BS-04 — `parseTime` support for "noon" / "midnight" / "half past" / "quarter to"

**Spec link.** [12.1.1](voice-agent-spec.md#121-reliability--correctness) · Effort: **S** · Risk: **low**

### Why

Current `parseTime` in the Local Code parse nodes only matches `H:MM AM/PM`. A caller saying "noon," "midnight," "half past two," or "quarter to four" causes `preferred_time_raw` to fail extraction → flow loops back to Get Preferred Time → Sarah re-asks → caller is annoyed.

### Where

Two identical Local Code nodes:
- `node-1777692711035` — Stage 2 parse
- `node-1777696582810` — Stage 5 parse

Both contain the same `parseTime` function. Patch both identically.

### Diff (apply to both nodes)

Inside the `parseTime(timeStr)` function, before the existing regex split:

```diff
 function parseTime(timeStr) {
   if (!timeStr) return null;
   const clean = timeStr.trim().toLowerCase();

+  // Handle word-form times
+  if (clean === 'noon')        return { hours: 12, minutes: 0 };
+  if (clean === 'midnight')    return { hours: 0,  minutes: 0 };
+
+  // Handle "half past X" → X:30
+  const halfPast = clean.match(/^half\s+past\s+(\d{1,2})\s*(am|pm)?$/);
+  if (halfPast) {
+    let h = parseInt(halfPast[1], 10);
+    const mod = halfPast[2];
+    if (mod === 'pm' && h !== 12) h += 12;
+    if (mod === 'am' && h === 12) h = 0;
+    // If no AM/PM, assume PM for hours 1-11 (studio hours skew afternoon)
+    if (!mod && h >= 1 && h <= 11) h += 12;
+    return { hours: h, minutes: 30 };
+  }
+
+  // Handle "quarter past X" → X:15 and "quarter to X" → (X-1):45
+  const quarterPast = clean.match(/^quarter\s+past\s+(\d{1,2})\s*(am|pm)?$/);
+  if (quarterPast) {
+    let h = parseInt(quarterPast[1], 10);
+    const mod = quarterPast[2];
+    if (mod === 'pm' && h !== 12) h += 12;
+    if (mod === 'am' && h === 12) h = 0;
+    if (!mod && h >= 1 && h <= 11) h += 12;
+    return { hours: h, minutes: 15 };
+  }
+  const quarterTo = clean.match(/^quarter\s+to\s+(\d{1,2})\s*(am|pm)?$/);
+  if (quarterTo) {
+    let h = parseInt(quarterTo[1], 10) - 1;
+    if (h < 0) h = 23;
+    const mod = quarterTo[2];
+    if (mod === 'pm' && h !== 12) h += 12;
+    if (mod === 'am' && h === 12) h = 0;
+    if (!mod && h >= 1 && h <= 11) h += 12;
+    return { hours: h, minutes: 45 };
+  }
+
   const parts = clean.split(' ');
   // ... existing regex split logic
```

### Acceptance criteria

- ✅ Test B8 ("noon") now parses to `{hours: 12, minutes: 0}` and proceeds to availability check.
- ✅ "midnight," "half past two," "quarter to four," "quarter past three" all parse correctly.
- ✅ Existing time formats ("2:00 PM", "4:15 PM") still parse correctly.
- ✅ Closed-day check still rejects "noon on Sunday."

### Test plan

1. Test B8 with caller saying "noon next Tuesday" → expect parsed as Tuesday 12:00 PM → availability_check fires.
2. Caller says "half past four" without day → Sarah asks for day → caller "Friday" → parses Friday 16:30.
3. Caller says "midnight" → Sarah likely should reject as outside hours; availability_check returns `isValid=false`.
4. Re-run B1, B6, B7 (existing time formats) for regression.

### Open questions

- Does the studio ever book hours outside the 2 PM – 7:30 PM Tue–Fri / 11 AM – 3:30 PM Sat window? If "noon" / "midnight" can never be valid, the closed-day code can reject them earlier. Confirm before assuming the availability check filters them.

---

## BS-05 — Set `reminder_trigger_ms` (silence nudge)

**Spec link.** [12.3.9](voice-agent-spec.md#123-natural-conversation) · Effort: **XS** · Risk: **none**

### Why

Currently `reminder_trigger_ms` is unset → Sarah waits in silence until `end_call_after_silence_ms` (30s) fires, then ends the call. A caller who paused to check their calendar is dropped without a chance to re-engage. Adding a soft 8s nudge ("You still with me?") recovers many of these.

### Where

Agent config — `agent_1605a239e08d6100f7422d194e`. Not a flow change; an agent-level setting.

### Diff

```diff
 {
   "agent_id": "agent_1605a239e08d6100f7422d194e",
   ...
+  "reminder_trigger_ms": 8000,
+  "reminder_max_count": 2,
   ...
 }
```

### Acceptance criteria

- ✅ After 8s of caller silence mid-conversation, Sarah says a brief nudge ("You still with me?" or Retell default).
- ✅ Max 2 nudges per call (so caller is never spammed).
- ✅ After 30s total silence (existing `end_call_after_silence_ms`), call still ends gracefully.

### Test plan

1. Place a call, after Sarah finishes a question stay silent for 12s. Expect nudge around 8s. Stay silent another 12s. Expect second nudge around ~16–20s total. Then silence till 30s — call ends.
2. Place a call, respond promptly — no nudges fire.
3. Confirm nudge does NOT fire during a tool execution (when Sarah is intentionally waiting on `availability_check`).

### Open questions

- Does Retell support customizing the reminder text? If yes, set it to something natural like "Hello? You still with me?" rather than the default. If not, default is fine.

---

## BS-06 — Style-aware personalized greeting (D12)

**Spec link.** [D12](voice-agent-spec.md#d12-specific-dance-personalization-scenario-2-is-missing-in-current-greetings) · Effort: **M** · Risk: **medium** (new variable contract; n8n + flow coordinated)

### Why

When `dance_interest = "salsa"`, the caller expects to hear *"I heard you're interested in learning salsa — that's awesome!"* ([client Scenario 2](voice-agent-spec.md#scenario-2--specific-dance-salsa-as-example)). Currently the agent ignores the specific style and routes to a generic For Fun / General greeting. This is the single biggest "she heard me" gap.

### Design

Two-part change:

1. **n8n** — at outbound call trigger, normalize raw `dance_interest` to `dance_interest_normalized` using a keyword whitelist. Pass both to Retell as dynamic variables.
2. **Retell flow** — add a Logic Split *before* the reason routing that checks `dance_interest_normalized`. If non-empty + matches a known style, route to a new `Specific Dance Greeting` node. Otherwise fall through to existing reason routing.

### Style keyword whitelist (initial)

| Normalized value | Triggers on raw values matching (case-insensitive) |
|---|---|
| `salsa` | "salsa", "salsa dancing", "salsa lessons", "salsa and ..." |
| `bachata` | "bachata" |
| `ballroom` | "ballroom", "ballroom dancing", "waltz", "foxtrot", "tango ballroom" |
| `country` | "country", "country dancing", "country line", "two-step" |
| `swing` | "swing", "east coast swing", "west coast swing", "lindy hop" |
| `tango` | "tango", "argentine tango" |
| `bolero` | "bolero" |
| `cha-cha` | "cha cha", "cha-cha", "chacha" |
| `wedding-first-dance` | "wedding dance", "first dance", "wedding choreography" |
| `''` (fallback) | anything not matching → generic greeting fires |

This list is **product business** — confirm with the client before locking it in. The mapping should be maintained in the n8n workflow's first node so it's a single source of truth.

### Where

#### n8n change

Add a new code node `Normalize Dance Interest` at the very start of the outbound trigger flow (whichever workflow fires the outbound call). Output adds `dance_interest_normalized` to the dynamic variables passed to Retell.

#### Retell flow change

1. New node: **`Specific Dance Greeting`**
   - Type: `conversation`
   - Model: `gpt-5-mini`
   - `interruption_sensitivity`: 0.5
   - `responsiveness`: 0.75
   - Prompt:
     ```
     IF RETURNING FROM ESCALATION ACKNOWLEDGEMENT: Don't repeat the greeting line. Say: "Alright, should we proceed to scheduling?"

     Say the greeting line: "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I heard you're interested in learning {{dance_interest_normalized}} — that's awesome! Is now a good time to chat?"

     Call behaviours:
     Limit the conversation to verifying with the user whether now is a good time to chat, do not answer anything else.
     ```
   - Outgoing edges: same structure as Reason Wedding (good-time → Specific Dance First Question; user shares motivation → Extract Variables → Update Dance Interest; user wants to proceed to scheduling → Main Pitch; user mentions group classes → Special Request Handling).

2. New node: **`Specific Dance First Question`** (lower priority — can use existing First Question node if budget tight)
   - Prompt: `"Great! So tell me, why are you looking to learn {{dance_interest_normalized}}?"`
   - All else mirrors the existing `First Question` node `node-1777280712989`.

3. New Logic Split node, placed AFTER `Logic Split (dance_interest empty?)` and BEFORE `Logic Split (reason)`:
   - If `dance_interest_normalized != ""` → route to `Specific Dance Greeting`
   - Else → continue to existing reason routing

### Acceptance criteria

- ✅ With `dance_interest="I want to learn salsa"` and `dance_interest_normalized="salsa"`: greeting includes "I heard you're interested in learning salsa — that's awesome!"
- ✅ With `dance_interest="just want to learn dancing"` and `dance_interest_normalized=""`: falls through to General Greeting (no behavior change).
- ✅ Variable is never read aloud unrendered (empty-variable safety).
- ✅ New test cases [G10, G11, G12](voice-agent-spec.md#2111-test-matrix-additions-extending-201) added to spec §20.1.1 pass.

### Test plan

1. **G10** — Test lead with `dance_interest_normalized="salsa"`. Expect: "I heard you're interested in learning salsa…"
2. **G11** — Test lead with `dance_interest_normalized=""`, `dance_interest="just want to dance"`. Expect: General Greeting fallback.
3. **G12** — Test lead with `dance_interest_normalized="hip hop"` (not in whitelist). Expect: falls back to generic greeting (because the whitelist filter wouldn't have produced a value).
4. **Regression** — all G1–G7 still work.

### Open questions

1. **Whitelist coverage** — client should sign off on the initial whitelist. Items they want to add or remove?
2. **Multi-style input** — caller form says "salsa AND bachata." Normalize to which? Suggested: first match in priority order, OR concatenate with " and " for the spoken output ("salsa and bachata — that's awesome!"). Confirm with client.
3. **Where does `dance_interest_normalized` live in n8n?** Pick the outbound trigger workflow. Verify the n8n workflow has access to the raw `dance_interest` from GHL before triggering Retell.

---

## BS-07 — Confirmation day/date/time read-back (D3)

**Spec link.** [D3](voice-agent-spec.md#d3-confirmation-phrasing) · Effort: **M** · Risk: **medium** (new variable formatting)

### Why

Current Confirmation Message says only *"Your appointment has been confirmed and you're all booked in!"* — doesn't read back what was booked. If Sarah misheard the day or time, the caller has no chance to catch it before the call ends. Client script ([§7](voice-agent-spec.md#7-confirmation)) explicitly requires explicit read-back: *"I have you scheduled for {Day}, {Date} at {Time}…"*.

### Where

- Add new dynamic variable: `preferred_time_spoken` — natural-language version of `preferred_time` (e.g., `"Friday, May 29th at 4:00 PM"`).
- Populate it in the same Local Code parse nodes that already compute `preferred_time` ISO:
  - `node-1777692711035` (Stage 2)
  - `node-1777696582810` (Stage 5)
- Update Confirmation Message node `node-1773659337380`.
- Update Reschedule Message node `node-1776264411698` similarly.

### Diff

#### Local Code parse nodes — add `preferred_time_spoken` computation

At the very end of the existing parse function, before the final `return`:

```javascript
// Build the spoken format: "Friday, May 29th at 4:00 PM"
const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const monthsLong = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function fmtTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}
const spoken = `${days[resolvedDate.getDay()]}, ${monthsLong[resolvedDate.getMonth()]} ${ordinal(resolvedDate.getDate())} at ${fmtTime(resolvedDate)}`;

return {
  preferred_time:        formatISO(resolvedDate),
  preferred_time_spoken: spoken,   // NEW
  preferred_day:         null,
  // ... rest unchanged
};
```

Add `preferred_time_spoken` to the node's `response_variables` mapping.

#### Confirmation Message node (`node-1773659337380`)

Change `instruction.type` from `static_text` to `prompt` (so it can interpolate variables):

```diff
- "instruction": {
-   "type": "static_text",
-   "text": "Your appointment has been confirmed and you're all booked in!"
- }
+ "instruction": {
+   "type": "prompt",
+   "text": "Say exactly: \"Perfect — I have you scheduled for {{preferred_time_spoken}}. You'll receive a confirmation shortly, and we're really excited to meet you! Just wear something comfortable — no experience needed at all.\""
+ }
```

#### Reschedule Message node (`node-1776264411698`)

```diff
- "instruction": {
-   "type": "static_text",
-   "text": "Your appointment has been rescheduled!"
- }
+ "instruction": {
+   "type": "prompt",
+   "text": "Say exactly: \"All set — I've rescheduled you to {{preferred_time_spoken}}. You'll receive an updated confirmation shortly!\""
+ }
```

### Acceptance criteria

- ✅ After successful booking, Sarah reads back the exact day, date, and time of the appointment.
- ✅ `preferred_time_spoken` is computed correctly for: this week, next week, "in 2 weeks," explicit dates, day+time combinations.
- ✅ The phrasing matches client script §7 exactly (including "wear something comfortable" closer).
- ✅ Empty-variable safety: if `preferred_time_spoken` is somehow empty, the line is unspoken or falls back to the old phrasing. (Add a fallback in the parse code: never return an empty string.)

### Test plan

1. B1 happy path — confirm Sarah reads "I have you scheduled for Tuesday, May 26th at 2:00 PM…"
2. B2 (earliest shortcut) — confirm correct day name + date.
3. B9 ("next Saturday" resolution) — confirm read-back date matches what was actually booked (not what was asked).
4. R2 reschedule — confirm new time is read back, not old.
5. Cross-month case — book Sat May 30; verify "May" not "June."

### Open questions

- Does the client want the `"Just wear something comfortable — no experience needed at all."` closer EVERY time, or only first-time bookings? Confirm; if only first-time, gate it on a new variable `is_first_lesson`.

---

## BS-08 — Trust-and-Announce race-condition recovery

**Spec link.** [12.1.4](voice-agent-spec.md#121-reliability--correctness) · Effort: **S** · Risk: **low** · **Status:** ✅ Applied 2026-05-22 (n8n live; no Retell publish needed)

### Final shipped diff (different from original plan above)

Pre-flight found the original build-sheet plan was wrong about where the wording lives. The alt-times conversation nodes (`node-1774172203915`, `node-1776430793245`) just speak `{{message}}` verbatim. The actual phrasing is constructed on the n8n side in the `Get Alternates` Code node (`cdcf4aa5-47c9-47dc-8a1c-c831be4d1bf9`) within `Voice AI Functions copy (Joshua)`.

Two patches applied to `parameters.jsCode`:

```diff
- message = `It seems the time you requested isn't open. We do have ${alt_1_display} or ${alt_2_display} that day — would either of those work?`;
+ message = `Hmm, looks like that just got taken. We do still have ${alt_1_display} or ${alt_2_display} that day. Would either of those work?`;

- message = `It seems the time you requested isn't open. We do have ${alt_1_display} that day — would that work?`;
+ message = `Hmm, looks like that just got taken. We do still have ${alt_1_display} that day. Would that work?`;
```

Case C (`Unfortunately, that day is fully booked. Would you like to try a different day?`) left unchanged per build sheet.

**Em-dash removed** per the v29 anti-em-dash policy ([[retell-v28-fast-path-and-deflection]]) — replaced with period.

**No Retell publish needed** for this ticket — n8n change is live.

### Why

Trust-and-Announce ([spec §4.2](voice-agent-spec.md#42-booking-sequence)) collapses 1.5s of "let me check" into "Perfect, let me get that booked for you." If someone *else* books the slot between our suggestion and our `availability_check` firing, the caller hears:

1. "Perfect — let me get that booked for you." (caller relaxes)
2. ~2 seconds pass
3. Generic alt-time message: "It seems the time you requested isn't open. We do have…"

That juxtaposition is awkward. Better recovery line: **"Hmm — looks like that just got taken. We do still have {{alt_time_1}}…"**

### Where

The alt-times conversation node `node-1774172203915` (Stage 2) and `node-1776430793245` (Stage 5).

Detection: we know we're in a Trust-and-Announce race when the *previous* node's spoken line included "Perfect — let me get that booked" AND we're now landing here. Currently no flag tracks that. Options:

- **(A) New dynamic variable** `trust_and_announce_active` set in Get Preferred Time when the fast-path fires; consumed (and reset) here.
- **(B) Just use the racier phrasing always** — even when the caller picked a time without a prior suggestion. The phrasing "looks like that just got taken" is plausible either way.

**Pick B** — simpler, no new variable, no risk of stale flag.

### Diff

Both alt-times nodes (`node-1774172203915` and `node-1776430793245`) — update Case A line:

```diff
- Case A — if {{alt_time_1}} AND {{alt_time_2}} are both real times (e.g. "2:00 PM"):
- Say warmly: "It seems the time you requested isn't open. We do have {{alt_time_1}} or {{alt_time_2}} that day — would either of those work?"
+ Case A — if {{alt_time_1}} AND {{alt_time_2}} are both real times (e.g. "2:00 PM"):
+ Say warmly: "Hmm — looks like that just got taken. We do still have {{alt_time_1}} or {{alt_time_2}} that day — would either of those work?"

- Case B — if only {{alt_time_1}} is a real time and {{alt_time_2}} is empty:
- Say: "It seems the time you requested isn't open. We do have {{alt_time_1}} that day — would that work?"
+ Case B — if only {{alt_time_1}} is a real time and {{alt_time_2}} is empty:
+ Say: "Hmm — looks like that just got taken. We do still have {{alt_time_1}} that day — would that work?"
```

Case C (fully booked) unchanged — the "fully booked" framing is different from "just got taken."

### Acceptance criteria

- ✅ When availability_check returns `is_available=false` with alts, Sarah uses the "looks like that just got taken" phrasing.
- ✅ When the day is fully booked, Sarah uses the existing "Unfortunately, that day is fully booked" phrasing (Case C unchanged).
- ✅ No regression on B11, B12, B13 from spec §20.1.3.

### Test plan

1. B11 — request a time that you've pre-booked manually in GHL → expect "Hmm — looks like that just got taken. We do still have 2:00 PM or 4:00 PM…"
2. B12 — same but engineer GHL to only return one alt → expect the single-alt variant.
3. B13 — request a day with no remaining slots → expect Case C unchanged.

### Open questions

- Does "looks like that just got taken" feel right when the caller didn't accept a suggestion (they asked for an arbitrary time)? Read it aloud both ways. Decide.

---

## BS-09 — Hesitancy handler (D4)

**Spec link.** [D4](voice-agent-spec.md#d4-hesitancy-handler-is-missing) · Effort: **M** · Risk: **medium** (new global node — must avoid false positives)

### Why

Client script ([§8.1](voice-agent-spec.md#8-objection--edge-case-handling)) wants Sarah to recognize hesitation and respond with a specific reassurance:

> "Totally understandable — the intro lesson is really designed to be low-pressure and fun, just a chance to see the studio and try dancing without any commitment. The hardest step you'll take is the one through the door coming in."

Today the agent has no such path. Hesitant callers either get re-pitched (which feels pushy) or escalate (which loses the booking).

### Where

New global node: **`Hesitancy Handler`**.

### Node spec

```json
{
  "id": "node-<new>",
  "name": "Hesitancy Handler",
  "type": "conversation",
  "model_choice": { "type": "cascading", "model": "gpt-5.1", "high_priority": false },
  "instruction": {
    "type": "prompt",
    "text": "The user expressed hesitation, uncertainty, or a soft hold (e.g. \"let me think about it\", \"I'm not sure yet\", \"maybe later\", \"I'll have to check\"). Do NOT push hard.\n\nSay: \"Totally understandable — the intro lesson is really designed to be low-pressure and fun, just a chance to see the studio and try dancing without any commitment. The hardest step you'll take is the one through the door coming in.\"\n\nThen ask once, gently: \"Would you like me to go ahead and lock in a day, or would you rather think it over?\"\n\nWait silently for the response. Do not push again on this node."
  },
  "interruption_sensitivity": 0.5,
  "responsiveness": 0.85,
  "edges": [
    {
      "destination_node_id": "node-1773656520723",
      "transition_condition": { "type": "prompt", "prompt": "The user agrees to schedule or wants to proceed" }
    },
    {
      "destination_node_id": "node-1776328180518",
      "transition_condition": { "type": "prompt", "prompt": "The user wants more time to decide" }
    }
  ],
  "global_node_setting": {
    "condition": "The user expresses hesitation or uncertainty about booking — including but not limited to: \"I'm not sure\", \"let me think about it\", \"I might wait\", \"maybe later\", \"I have to check with my partner\", \"I need to think it over\", \"I'm hesitant\", \"I'm not ready yet\". DO NOT trigger on: clear declines (\"no thanks\"), bad-time signals (\"I'm busy now\" — that's Bad Time), or simple questions (\"how much is it?\" — that's normal flow).",
    "cool_down": 10
  }
}
```

Routing on the outgoing edges:
- "User agrees to schedule" → loop back to Get Preferred Time (`node-1773656520723`)
- "User wants more time" → Bad Time To Talk (`node-1776328180518`), which already captures callback time

### Acceptance criteria

- ✅ Caller says "I'm not sure yet" mid-pitch → Sarah responds with the reassurance script.
- ✅ Single soft re-ask after the reassurance, then waits silently.
- ✅ Does NOT fire on a clear decline ("no thanks").
- ✅ Does NOT fire on Bad Time signals (which have their own handler).
- ✅ Cool-down 10s prevents the handler from firing repeatedly in one call.

### Test plan

1. Place a test call. Mid-pitch, say "I'm not sure, let me think about it." Expect the reassurance script + soft re-ask.
2. After Sarah's re-ask, say "yeah, okay, let's book" → loops back to Get Preferred Time.
3. After Sarah's re-ask, say "actually let me think more" → routes to Bad Time → callback.
4. Adversarial — say "I'm busy now" → Bad Time fires (not Hesitancy). Confirm the global-trigger conditions don't overlap.
5. Adversarial — say "no thanks" → handled by existing escalation/end paths (Hesitancy does NOT fire).

### Open questions

- Should there be an upper bound on hesitancy fires per call? Cool-down 10s + max 2 fires?
- The reassurance line is long. Read it aloud to confirm it doesn't feel preachy.

---

## BS-10 — Wedding-specific probes (D11)

**Spec link.** [D11](voice-agent-spec.md#d11-wedding-probes-are-scenario-specific-in-the-client-script-generic-in-the-agent) · Effort: **M** · Risk: **low**

### Why

[Client Scenario 1](voice-agent-spec.md#scenario-1--wedding) shows wedding callers should hear:
- "Have you picked your wedding song yet?"
- Then: "Are you picturing something more choreographed, something simple, or a mix?"
- Then reaction: "Nice — that's a great balance."

Currently the wedding-routed branch goes through the generic First Question + One Layer Deeper. Wedding callers — typically engaged, emotionally invested — deserve a probe that demonstrates Sarah heard their inquiry.

### Where

The wedding lane goes: `Reason Wedding` (`node-1774094516287`) → `First Question` (Reason path) (`node-1777284680021`) → `One Layer Deeper` (Reason path) (`node-1777284686423`) → `Main Pitch`.

We need wedding-specific replacements for the First Question and One Layer Deeper nodes WITHIN the wedding lane only. Don't touch the Reason Special Occasion or Reason For Fun lanes — they share these nodes.

**Two options:**

| Option | What it does |
|---|---|
| (A) Fork the wedding lane into its own dedicated First Question + One Layer Deeper nodes | Cleanest separation but more nodes to maintain |
| (B) Make the existing First Question + One Layer Deeper prompt aware of `reason` and branch internally via the LLM | Fewer nodes, LLM-dependent (risk of drift) |

**Pick A.** Cleaner separation, more testable.

### Node specs

#### New node: `Wedding First Question` (`node-<new-A>`)

```
Type: conversation
Model: gpt-5-mini
Interruption sensitivity: default
Responsiveness: 0.75

Prompt:
Ask: "Have you picked your wedding song yet?" Wait silently for the response.

RETURNING FROM ESCALATION ACKNOWLEDGEMENT: Don't repeat the question. Say: "Alright, should we proceed to scheduling?"

Call behaviours:
React briefly to the user's answer:
- If they have a song: "Perfect — that helps a lot."
- If they don't: "No worries — most couples figure that out as they go."
Then immediately transition.

Do not ask any other questions in this node.

Edges:
- "User answered yes/no on the wedding song" → Wedding One Layer Deeper (new node B)
- "User wants to proceed to scheduling directly" → Main Pitch
- "User mentions group classes" → Special Request Handling
```

#### New node: `Wedding One Layer Deeper` (`node-<new-B>`)

```
Type: conversation
Model: gpt-5-mini
Responsiveness: 0.75

Prompt:
Ask: "Are you picturing something more choreographed, something simple, or a mix?" Wait silently for the response.

React briefly:
- "Choreographed" → "Awesome — we love that."
- "Simple" → "Totally — simple and elegant is beautiful."
- "A mix" → "Nice — that's a great balance."
Then transition.

Do not ask any other questions.

Edges:
- "User shares preference on choreography style" → Main Pitch
- "User wants to proceed to scheduling directly" → Main Pitch
- "User mentions group classes" → Special Request Handling
```

#### Route change: `Reason Wedding`

```diff
Edges from Reason Wedding (node-1774094516287):
- destination_node_id: node-1777284680021  (First Question - shared)
+ destination_node_id: node-<new-A>        (Wedding First Question)
  transition: "Good time to talk and user says nothing else"

- destination_node_id: node-1776244506867  (Main Pitch)
  destination_node_id: node-1776244506867  (Main Pitch) — unchanged for "shares motivation" edge

  ... (other edges to Special Request Handling, etc. unchanged)
```

### Acceptance criteria

- ✅ Wedding-routed call (G1) hears the song probe FIRST, not the generic "what made you wanna dance?"
- ✅ One Layer Deeper for weddings asks the choreography-style question.
- ✅ Non-wedding lanes (G2 Special Occasion, G3 For Fun, G4 default, G6 General) are unaffected.
- ✅ Bridging to Main Pitch is smooth (no awkward "and what made you wanna dance?" after the wedding probes).

### Test plan

1. **G1+B1** golden path — confirm wedding probe sequence: song → choreography → main pitch → booking.
2. **G2** Special Occasion lane — confirms NOT affected by wedding changes.
3. **G3** For Fun — confirms NOT affected.
4. Adversarial — caller says "yeah I have a song, just book me already" on the first probe → routes to Main Pitch directly (skips choreography probe). Confirm the "User wants to proceed to scheduling directly" edge fires.

### Open questions

- Should the reaction lines ("Perfect — that helps a lot." / "Awesome — we love that.") be in the prompt as suggestions for the LLM to choose, or hard-coded as separate static-text micro-nodes? Suggestion-style is more natural; static-text is more predictable. Default to suggestion-style; observe drift.

---

## BS-11 — Tool execution-message description fix (`availability_check` + `day_slot_check`)

**Effort:** XS · **Risk:** Low · **Status:** ✅ Shipped v35 (2026-05-22)

### Why

`availability_check` and `day_slot_check` had `execution_message_type: static_text` but `execution_message_description` containing an LLM-style anti-hallucination instruction ("Say a single short natural filler phrase such as 'Checking that for you now.' …DO NOT use parentheses…"). With `static_text` type, Sarah would have spoken the entire instruction verbatim. Latent bug — never observed because the recent triage calls all hit the earliest-slot shortcut, which bypasses both tools. Discovered during BS-11/12/13 pre-flight audit.

### Where

Conversation flow `conversation_flow_382e66ab131b`, tools array:
- `availability_check` (`tool-1774085096900`)
- `day_slot_check` (`tool-1774105669590`)

### Diff

```diff
- "execution_message_description": "Say a single short natural filler phrase such as \"Checking that for you now.\" or \"Got it — one moment.\" DO NOT use parentheses. DO NOT prefix with \"Note:\". DO NOT use brackets, asterisks, or any stage direction. DO NOT narrate your actions. Speak as if talking to a real person — not as if writing a note to yourself."
+ "execution_message_description": "Just a moment, checking that for you."
```
(`day_slot_check` analogously → `"Let me see what's open that day."`)

`execution_message_type: static_text` unchanged.

### Acceptance criteria

- ✅ On any non-earliest booking attempt, Sarah says `"Just a moment, checking that for you."` while `availability_check` runs — verbatim, no LLM in loop.
- ✅ On any "what's open Wednesday?"-style ask, Sarah says `"Let me see what's open that day."` while `day_slot_check` runs.
- ✅ No regression on §20.1 booking tests.

### Test plan

1. Outbound test call: caller asks for a non-earliest time (e.g., "Wednesday at 3 PM") → confirm Sarah's filler phrase matches verbatim during the tool execution.
2. Outbound test call: caller asks "what's open Wednesday?" → confirm `day_slot_check` filler matches verbatim.

---

## BS-12 — Strict return-from-escalation bridge guard (8 nodes)

**Effort:** S · **Risk:** Low · **Status:** ✅ Shipped v35 (2026-05-22)

### Why

In `call_bed2029d2fa4c85e4ae6a12d9be` (v33), a confused caller said `"What? What?"` mid-discovery. Sarah responded with `"Alright, should we proceed to scheduling?"` — the bridge phrase from the soft `IF RETURNING FROM ESCALATION ACKNOWLEDGEMENT` guard. The guard is in 8 nodes (4 greetings + First Question ×2 + One Layer Deeper ×2) and triggered incorrectly because the LLM has no hard signal of "returning from escalation"; it relied on context inference.

### Where

8 nodes — all conversation-type with the soft `IF RETURNING FROM ESCALATION ACKNOWLEDGEMENT` guard at the top of the prompt:
- `node-1774094516287` Reason Wedding
- `node-1774094517507` Reason Special Occasion
- `node-1774094518930` Reason For Fun
- `node-1774931569845` General Greeting
- `node-1777280712989` First Question (General path)
- `node-1777284680021` First Question (Reason path)
- `node-1777284686423` One Layer Deeper (Reason path)
- `node-1776245287680` One Layer Deeper (General path)

Main Pitch's separate guard ("Great. So we should start with the intro lesson.") is **NOT** touched — different bridge phrase, lower observed risk.

### Diff per node

```diff
- IF RETURNING FROM ESCALATION ACKNOWLEDGEMENT: Don't repeat the greeting line. Say: "Alright, should we proceed to scheduling?"
+ ESCALATION-RETURN BRIDGE — STRICT: Use the bridge phrase "Alright, should we proceed to scheduling?" ONLY when Sarah's immediately preceding turn was an escalation transfer offer AND the caller has just declined it (e.g. "no thanks", "never mind", "let's keep going"). In ANY other case — including caller confusion ("what?", "huh?", "say again?", "I didn't catch that"), brief silences, or simple "no" answers mid-conversation — proceed with the line below as written. When in doubt, do not bridge.
```

(Reason nodes used "IF RETURNING..." with leading `IF`; First Question and One Layer Deeper used "RETURNING..." without. Both variants are now replaced with the unified strict block.)

### Acceptance criteria

- ✅ Legitimate case: Sarah offers transfer → caller declines ("no thanks") → bridge fires.
- ✅ Confusion case: caller says "What?" / "Huh?" mid-pitch → bridge does NOT fire; Sarah repeats the prior line.
- ✅ Mid-conversation "no" (not a transfer decline) → bridge does NOT fire.
- ✅ When in doubt → no bridge.

### Test plan

1. Place outbound call. Caller says "What?" mid-question → Sarah repeats prior question.
2. Place outbound call. Caller asks for human → Sarah offers transfer → caller "no thanks" → bridge fires correctly.

---

## BS-13 — Mandatory callback time echo in Get Callback Time subagent

**Effort:** S · **Risk:** Medium · **Status:** ✅ Shipped v35 (2026-05-22)

### Why

In `call_09402d2fb3fbc7ac7f0ff254e80` (v35 callback path), caller said "five minutes from now" → Sarah went straight to `"Please give me a moment while I record it."` with NO verbal echo confirmation (e.g., "Got it — five minutes from now, is that right?"). In `call_dbab93d558c4cce22a09aaedfe7` (v33 non-callback path) the echo did fire ("Got it — thirty minutes from now works. Great! So we will call you back today at 9:28 AM…"). Subagent prompt suggested confirmation via "such as" rather than mandating it; gpt-5-mini optimized for speed and skipped.

### Where

`node-1776164846024` Get Callback Time (subagent, gpt-5-mini, responsiveness 0.9).

### Diff

Replace entire prompt:

```diff
- The user intends to have a call back date. Your goal is to confirm a date and time from the user.
- Once a date and time is retrieved, verbally confirm one more time about their callback time, such as "Great! So we will call you back on [Day] at [Time], is that alright?" Wait for the caller to confirm.
- Once the caller confirms, use `get_current_datetime` to get the current date and time as reference. No need to state the timezone.
-
- Call Behaviours:
- The variable {{callback_time}} must be set in ISO8601, e.g. "2026-04-21T19:00:00-05:00".
+ The user just stated when they'd like a callback. Your job has two MANDATORY steps. Step 1 is non-negotiable.
+
+ STEP 1 (REQUIRED verbal confirmation — never skip, even for clear times):
+ Speak the time back to the user using a pattern like:
+ "Got it — [restate the time naturally, e.g. 'five minutes from now' or 'tomorrow at 5 PM']. Is that right?"
+ or
+ "Great! So we will call you back at [time], is that alright?"
+ Then wait silently for the caller's yes/no.
+
+ STEP 2 (after caller confirms with yes/yeah/correct/that works):
+ Use `get_current_datetime` to get the current date and time as reference. No need to state the timezone.
+ Set {{callback_time}} in ISO8601 (e.g., "2026-04-21T19:00:00-05:00").
+
+ If the caller says no or corrects the time, capture the new time and return to Step 1.
+
+ Call Behaviours:
+ - Step 1 verbal confirmation is non-optional. Skipping it is a bug.
+ - Do not speak the ISO timestamp aloud — speak the time naturally.
+ - Do not narrate the tool call.
+ - {{callback_time}} must be set in ISO8601, e.g. "2026-04-21T19:00:00-05:00".
```

### Acceptance criteria

- ✅ Step 1 fires on every callback time entry, even unambiguous ones ("five minutes from now").
- ✅ {{callback_time}} still set to ISO8601 (downstream contract preserved).
- ✅ Caller corrections route back to Step 1.

### Test plan

1. Outbound call → caller "bad time, call me in 5 minutes" → Sarah: "Got it — five minutes from now, is that right?" → wait.
2. Outbound call → caller "tomorrow at 5 PM" → Sarah: "Great! So we will call you back at 5 PM tomorrow, is that alright?" → wait.
3. Outbound call → caller corrects time on echo → Sarah re-echoes and confirms.

### Watch item

Cannot guarantee gpt-5-mini will obey "non-negotiable Step 1" in 100% of calls. If skip rate >0 on live test traffic, consider: (a) bump subagent to gpt-5.1 for compliance discipline, or (b) restructure into a dedicated static-text echo node + extract before the ISO conversion.

---

## Rollout order & strategy

**Recommended publish order:**

1. ✅ **BS-01 + BS-03 + BS-05** (bundled) — Shipped v34 (2026-05-22)
2. ✅ **BS-11 + BS-12 + BS-13** (defect bundle from call analysis) — Shipped v35 (2026-05-22)
3. ✅ **BS-04** — Shipped v36 (2026-05-22)
4. ✅ **BS-02 + BS-08** (bundled) — Shipped v37 (2026-05-22)
5. ✅ **BS-14 + BS-15** (defect bundle from v37 test calls) — Applied to v38 draft (2026-05-22)
6. **BS-09** (M) — promoted to next after v37 test calls showed hesitancy ("let me think about it") gap
7. **BS-07** (M) — confirmation read-back; still pending but no observed wrong-time bookings yet
8. **BS-06** (M) — biggest scope change, most rigorous testing
9. **BS-10** (M) — last (polish-oriented); bundle with BS-09 if testing capacity allows

**Between each publish, run the smoke + coverage protocol from spec §20.2.** Do not stack publishes — at least one measurement cycle in between.

### Total estimated effort

- XS items shipped: BS-01, BS-05, BS-11
- S items shipped: BS-03, BS-04, BS-08, BS-12, BS-13
- S items in v37 draft (awaiting publish): BS-02
- M items remaining: BS-06, BS-07, BS-09, BS-10 — ~16 hr combined

**Remaining ~16 hr of dev time** + ~6 hr of test calls = **~22 hr / ~2.5 dev-days**. Includes the §13 Definition of Done gates for each ticket.

---

## Items NOT in the top 10 — and why

### Deferred to next batch

| Item | Reason |
|---|---|
| D2 Taste-tester framing | Optional polish; client script's formal §4 doesn't include it |
| D5 Pricing-push phrasing | Minor refinement; current phrasing is functional |
| D13 Family-wedding routing | **Blocked** on GHL inquiry form change — external dependency |
| D14 Reactive empathy lines | Quality polish, not load-bearing |
| 12.1.2 No existing-appointment pre-check | Adds complexity for relatively rare flow |
| 12.1.5 Reschedule event_id flow | Existing GHL re-issued ID handling in cadence app catches the common case |
| 12.2.7 Speculative availability check | Depends on Retell platform support |
| 12.2.8 Cache earliest_slot 60s | < 200ms latency win; deprioritize |
| 12.3.10 Wider backchannel vocabulary | Cosmetic; "mhm/okay" is fine |
| 12.3.12 Numeric normalization | Verify via test calls first before fixing |
| 12.4.13 Partial callback (different number) | Rare; defer until volume justifies |
| 12.4.14 Multi-person scheduling | Rare; book one, GHL UI handles the rest |
| 12.4.15 Package pricing answer | Out of scope per client §5.2 |
| 12.4.16 "Not interested" deflection | Not on critical path; escalation already handles |
| 12.5.17/18 Voicemail enhancements | Wait for current 1500ms delay measurement |
| D7 Open hours discrepancy | **Blocked** on client confirmation |

### Hard external blockers

- **D7 — Open hours**: client must confirm Tue–Fri 2:00–7:30 PM, Sat 11:00–3:30 PM (the formal §6.1 values) vs the simple-example values. Until confirmed, do not change anything; the agent reads hours from the GHL calendar config, so as long as that's correct, the agent will be correct.
- **D13 — Family-wedding routing**: needs new `wedding_role` field on the GHL inquiry form. Requires client + GHL admin coordination.

---

## Discipline gates per ticket (recap from spec §13)

Before any ticket is "done":

1. Justified against [§1 Mission](voice-agent-spec.md#1-mission) — explicit in each ticket's *Why* section above.
2. Success criterion + rollback signal defined — in *Acceptance criteria*.
3. Every path traced (happy / error / empty-var / hallucination / global-intersection) — in *Test plan*.
4. Spoken lines read aloud — confirmed during dev.
5. Live tested ≥ 5 calls on touched paths.
6. Latency measured vs baseline — in test report.
7. Force-failure path tested — in *Test plan* where applicable.
8. `version_description` written explaining what + why + trade-off.
9. Modification summary recorded to memory.
10. Publish title + description ready (per memory rule).
11. Rollback signal watched 24–72 hr post-publish.
12. Spec updated if behavior diverged from this build sheet's plan.

**No skipping. No "just this once."** Every gate exists because something broke before.

---

## Sign-off block

| Ticket | Reviewer | Date approved | Date implemented | Date published | Date rollback-watch complete |
|---|---|---|---|---|---|
| BS-01 | Joshua | 2026-05-22 | 2026-05-22 | 2026-05-22 (v34) | — |
| BS-02 | Joshua | 2026-05-22 | 2026-05-22 (v37 draft + n8n live) | pending v37 publish | — |
| BS-03 | Joshua | 2026-05-22 | 2026-05-22 | 2026-05-22 (v34) | — |
| BS-04 | Joshua | 2026-05-22 | 2026-05-22 | 2026-05-22 (v36) | — |
| BS-05 | Joshua | 2026-05-22 | 2026-05-22 | 2026-05-22 (v34) | — |
| BS-06 | — | — | — | — | — |
| BS-07 | — | — | — | — | — |
| BS-08 | Joshua | 2026-05-22 | 2026-05-22 (n8n live) | n/a — n8n change only | — |
| BS-09 | — | — | — | — | — |
| BS-10 | — | — | — | — | — |
| BS-11 | Joshua | 2026-05-22 | 2026-05-22 | 2026-05-22 (v35) | — |
| BS-12 | Joshua | 2026-05-22 | 2026-05-22 | 2026-05-22 (v35) | — |
| BS-13 | Joshua | 2026-05-22 | 2026-05-22 | 2026-05-22 (v35) | — |
| BS-14 | Joshua | 2026-05-22 | 2026-05-22 (v38 draft) | pending v38 publish | — |
| BS-15 | Joshua | 2026-05-22 | 2026-05-22 (v38 draft) | pending v38 publish | — |

---

**End of build sheet.**
