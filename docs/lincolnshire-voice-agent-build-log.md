# AM Lincolnshire Voice Agent — Build & Test Log

> Working log for the conversational + latency overhaul of the Lincolnshire outbound voice agent.
> Append test-call analyses at the bottom as call IDs come in.

---

## Scope (HARD RULE)

The **only** Retell agent we modify is **`AM Lincolnshire Agent (Joshua-draft)`**:

| Thing | Value |
|---|---|
| Agent ID | `agent_cd8a872b64a03338e6c54a41a0` |
| Conversation flow | `conversation_flow_433bca831dcb` |
| Voice | `11labs-Hailey` |
| n8n tools workflow | `Voice AI Functions copy (Joshua)` `LXlMa0Gy2Fq2xuUO` (webhook paths suffixed `-joshua`) |
| Outbound phone | `+17623713782` |

**Out of scope — never touch:** `NEW TEST MOJO JFF` `agent_c6c4facfa0c12f9d7e1f1a8c83`; old TEST AI copy `agent_1605a239e08d6100f7422d194e`; production `Arthur Murray Lincolnshire Receptionist` `agent_a21bd030d52b9d54626fa9f44e`; other copies (`agent_e6a183…`, `agent_24766140…`).

This agent is a fresh duplicate of the LIVE production agent (newer architecture than `docs/voice-agent-spec.md`).

---

## Version & pin state

| | Version | Published? | Notes |
|---|---|---|---|
| Live (current) | **v11** | yes | **Accept-offered-earliest streamline.** Post-pitch `node-pitch-earliest-offer` ACCEPT edge (`edge-pitch-offer-accept`) repointed `node-fix5-fetch-earliest` → NEW code `node-accept-set-preferred` ("Set Preferred From Earliest (Accept)", sets `preferred_time = earliest_iso`) → else_edge → reused v6 `node-fastpath-confirm` ("Perfect — I'll get {{earliest_formatted}} booked for you. One moment.") → Create `node-1774027370706`. Removes the 3 redundant steps that caused the call_20a7 hangup: the re-offer (`node-fix5-offer-earliest`), the redundant `availability_check` (`node-1774085313178`), and the contradictory `Final Confirmation` double-ask. Other-day edge (`edge-pitch-offer-otherday` → Get Preferred Time `node-1773656520723`) UNCHANGED. `node-fix5-set-preferred`/`node-fix5-fetch-earliest`/`node-fix5-offer-earliest` left intact (still serve the "just give me the earliest" defer path). Race condition (slot taken between offer/book) surfaces as a `create_appointment` failure → Appointment Failure `node-1773659315552` (same accepted trade-off as v6 bypass). 4/4 playground sims pass (mocked tools). Published 2026-06-08. Booking completion + perceived snappiness confirmable only on a live call. **NOTE: log table was stale (jumped v6→v11); v7–v10 publishes were not recorded here — live was actually v10 immediately before this publish, confirmed via `agent.retrieve`.** |
| (superseded) | v6 | yes | Earliest-slot availability-check **bypass** (latency): NEW `branch` "Earliest Exact Match?" (`node-fastpath-branch`) after resolver Code `node-1777692711035` — match (`{{preferred_time}} == {{earliest_iso}}` && `{{earliest_available}} == "true"`) → NEW `Fast-Path Confirm` (`node-fastpath-confirm`, speaks only `{{earliest_formatted}}`) → Create `node-1774027370706`, skipping the `availability_check` round-trip. Else → Validation Message → Availability Check (unchanged). Prereq: added `earliest_available` to `get_earliest_slot` tool (`tool-1773896569777`) `response_variables`. Also carries the static-greeting fix + voice 1.6/1.4/1.3 from draft v6. Published 2026-06-08. Latency/voice/static-greeting confirmable only on next live call. |
| (superseded) | v5 | yes | Call-open PACE fix: all 4 greetings shortened ~50-60% (~12-18 words, identity + brief reason + good-time gate); `voice_speed` 1.20→1.25; `enable_dynamic_voice_speed` true→false; `begin_message_delay_ms` 1500→600. Published 2026-06-05. Pace gain confirmable only on next live call. |
| (superseded) | v4 | yes | Call-open latency regression fix: `node-prefetch-earliest` `wait_for_result` true→false (greeting no longer blocked by the silent get_earliest_slot round-trip) + voice_speed 1.13→1.20. Published 2026-06-05. |
| (superseded) | v3 | yes | Latency + naturalness pass: HP on 6 booking nodes + scripted-read model downgrade + One Layer Deeper de-stutter + pitch warmth + voice_speed 1.13. Published 2026-06-05. |
| (superseded) | v2 | yes | Data-driven earliest (T1) + soonest-day de-bias (T2) + n8n earliest_available/1h (T3). Published 2026-06-05. INTRODUCED the call-open latency regression (blocking prefetch at call start), fixed in v4. |
| (superseded) | v1 | yes | T1–T6 + FIX 1–5. Published 2026-06-02. |
| (superseded) | v0 | yes | Original T1–T6 only |

**Two pins must move in lockstep on every publish** ([[outbound-version-pins]]):
1. Retell phone `+17623713782` → `outbound_agent_version` (Retell phone-number config, NOT a Supabase `outbound_agents` table — that table does not exist in this project) = **11**
2. n8n `Trigger Retell Outbound Call` (`89ae6077`, wf `LXlMa0Gy2Fq2xuUO`) → `override_agent_version` = **11** (still needs the n8n engineer to set this — Retell side done)

Pin 1 (Retell phone) bumped 10→11 at the v11 publish (2026-06-08), verified before=10 / after=11 via `phoneNumber.retrieve`. Pin 2 (n8n `override_agent_version`) must be set to **11** by the n8n engineer to complete lockstep. Next publish → both to 12.

> Retell published versions are **immutable** — every change set creates a new draft version, and publishing it bumps the pins. There is no "edit v0 in place."

---

## Open flags (surfaced during v11 sim — NOT fixed, out of scope of v11 ticket)

These were observed driving the playground sim and **confirmed identical on live v10** — i.e. pre-existing, not introduced by v11. Logged for a future ticket.

1. **Other-day availability path: `parseNowRaw` TypeError + unresolved `{{ preferred_time }}`.** When the caller declines the offered earliest and names another day/time, the chain `Get Preferred Time (node-1773656520723) → Extract Variables → Code (node-…) → Availability Check (node-1774085313178)` can throw `TypeError: cannot read property 'match' of undefined` in the `parseNowRaw` code node (when `preferred_date` extracts empty), and then call `availability_check` with a literal unresolved `preferred_time: "{{ preferred_time }}"` → n8n 500 → transfer/escalate. Partly a sim artifact (playground may not resolve the template the same way a live call does), but the `parseNowRaw` null-guard is a genuine code-node hardening opportunity. Reproduced on BOTH v10 and v11 → pre-existing.
2. **Contradictory `Final Confirmation` (node-1773930717386) on the NORMAL availability path.** It states `{{is_available_summary}}` (which can read as if booking is underway) AND then asks "Does that work for you?" — a self-contradictory book-and-double-ask. This is the same shape as the call_20a7 step-3 complaint, but on the normal (non-accept) path. v11 only removed it from the accept path. Candidate follow-up: make the summary purely informational ("That slot is open.") so the confirm question reads cleanly.

---

## 2026-06-09 — Vague-caller over-dig (call_0dfd) — HELD, NOT PUBLISHED

**Ticket:** One Layer Deeper over-digs (asks 2-5 follow-ups) when the caller is relentlessly vague ("just curious"/"nothing in particular"/"mhmm"/"idk"). Two nodes: Reason lane `node-1777284686423` (→ Main Pitch `node-1776244506867`), General lane `node-1776245287680` (→ Extract Variables `node-1777280545153`). Required deterministic guarantee of EXACTLY ONE follow-up.

**Outcome: HELD. Draft restored to v13 baseline. No publish, no pin change.** Phone `+17623713782` stays `outbound_agent_version = 11`; n8n `override_agent_version` stays 11. The vague-caller gate could NOT be made deterministic.

**Root cause (proven via chat `message_with_tool_calls` node trace):** the One Layer Deeper conversation node emits a SECOND follow-up turn **within the same node visit, with NO `node_transition` between the two agent turns.** The model generates the second question before Retell ever evaluates an exit edge. There is no node boundary at the point of failure, so a hard code-node counter (the spec's escalation) has nothing to hook onto — the counter would never run between the two follow-ups.

**8 approaches tested against the terse-vague caller (reason set, enter OLD with a clear motivation, then "idk"/"mhmm"/"nope"), all FAIL (second follow-up persists):**
1. Soft turn-gated edge ("agent asked its one follow-up and caller responded") + vague-exit edge + prompt cap → FAIL
2. Exhaustive complementary-pair prompt edges ("has detail" + "any other reply / default") → FAIL
3. Always-true equation edge `{{stage_number}} == 1` (non-LLM) as catch-all → FAIL (edge never evaluated; in-node double-speak wins)
4. Equation edge moved to highest priority → FAIL
5. Single forced exit edge only ("the caller has said anything at all") → passed ONCE then FAILED on reruns (run-to-run luck, not deterministic)
6. Model downgrade gpt-5.1 → gpt-5-mini (matching the reliable First Question node) + simplified prompt → FAIL
7. Maximally-constraining "you speak EXACTLY ONE time, a second message is a critical error" prompt → FAIL
8. First-Question-style static "say this exact line, then wait" prompt → FAIL (model paraphrased then re-dug anyway)

**Why First Question is reliable but One Layer Deeper is not:** First Question reads ONE fixed scripted string with zero generative latitude and has exhaustive edges; it never needs to generate twice. One Layer Deeper MUST generate a context-tailored follow-up, and that same generative latitude is what lets the model emit a second turn. The behavior is inherent to gpt-5.1/gpt-5-mini on a generative conversation node and is not overridable by edges, equations, counters, or prompt wording.

**Note:** the soft/single-edge configs DID pass the gate on the General lane and on the chatty/substantive caller in several runs — the failure is specifically the terse one-word-vague caller on a generative dig node. It is intermittent, not 100%, but never 5/5 clean, so it fails the publish gate.

**Recommended path forward (next ticket, larger restructure — out of scope of a same-node fix):** replace the generative One Layer Deeper with a **deterministic single-turn structure**: a node that reads ONE near-fixed follow-up line keyed off `{{reason}}` (First-Question pattern, minimal generation) so it cannot double-generate, OR drop the discovery dig entirely for vague openers and route straight to pitch (the vague caller has, by definition, no goal to dig into). Either needs its own build + sim cycle.

**Also observed (separate naturalness defect, confirmable only live):** the ONE follow-up frequently contains an **em-dash** ("doing this just for yourself—are you...") despite the prompt's explicit no-em-dash rule, and a doubled "Got it - and..." stutter on the second (buggy) turn. The em-dash issue affects even the single legitimate follow-up and is worth a wording pass.

**Sim harness used:** created a TEMP chat agent **`agent_3747b7a7deea9034cca730729c`** ("TEMP SIM - vague caller (Joshua) DELETE ME") bound to the same draft flow `conversation_flow_433bca831dcb`, drove deterministic scripted conversations via `chat.createChatCompletion`, and read `message_with_tool_calls` for node-level traces. **Surfaced for manual deletion (no-deletion rule) — I did not delete it.**

---

## Goals

1. **More conversational** — after "why do you want to dance?", acknowledge the caller's actual answer and ask exactly ONE relevant follow-up before pitching. (Previous team's attempt felt robotic because the follow-up was canned/non-responsive.)
2. **Lower latency** — across STT, model tiers, tool round-trips.
3. **Connect to Joshua's n8n clone** (`-joshua` webhooks).

---

## Change history

### v0 — original overhaul (T1–T6), published 2026-06-02
- **T1** `One Layer Deeper` (General `1776245287680`, Reason `1777284686423`): rewritten to acknowledge caller's words + ONE relevant follow-up; removed canned "Have you ever danced before?"; vague-answer safe fallback; model `gpt-5-mini → gpt-5.1`.
- **T2** `First Question` (General `1777280712989`, Reason `1777284680021`): "lots of info" edge routed THROUGH One Layer Deeper (always-on follow-up); one "just book me" bypass kept.
- **T3** Models: Question Handling ×3 + Group Class Push + Special Request `gpt-5.5 → gpt-5.1`; PriorityLane on Greeting, both First Question, Main Pitch.
- **T4** Settings: voicemail leaves a message (`static_text`), `begin_message_delay_ms=1500`, `end_call_after_silence_ms=30000`, interruption 0.7 (greeting 0.5 / pitch 0.6), call-center ambience 0.3, backchannel on, dynamic responsiveness + voice speed on, reminders 8s/max2, `stt_mode=fast`.
- **T5** Tool timeouts `120000 → 8000` (create/reschedule `10000`); fixed `delete_appointment` leading-space auth header.
- **T6** All 12 tool URLs + post-call webhook repointed to `-joshua`.
- Published v0; outbound phone + n8n override repointed to this agent v0.

### v1 — five fixes (PUBLISHED 2026-06-02; pins bumped 0→1)
Found via batch simulation of v0:
- **FIX 1 — Model safety revert (anti-hallucination).** Reverted fact/policy-generating nodes to the stronger model: Question Handling ×3 (`conversation-1777403153194-0`, `1777604430953`, `1777609061737`) and Special Request Handling (`1777658041525`) `gpt-5.1 → gpt-5.5`. **Group Class Push (`1777720640332`) left on `gpt-5.1`** (scripted routing, no facts). Scripted reads, One Layer Deeper, Main Pitch, PriorityLane, STT, timeouts unchanged.
- **FIX 2 — Post-booking goodbye loop.** Hardened `Final Confirmation` (`1773930717386`): no in-node ad-lib/goodbye, ask one "Does that work?" confirm, broadened confirm edge to natural phrasings. Broadened `End Call Decision` (`1776268718855`) wrap-up edge. Result: booking → one confirmation → one goodbye → End Call, no loop.
- **FIX 3 — Close the greeting shortcut.** The greeting "shares a clear motivation" edge previously skipped discovery → went to pitch. Re-routed it into One Layer Deeper on all greeting nodes (General `1774931569845` → `1776245287680`; Reason Wedding `1774094516287`, Special Occasion `1774094517507`, For Fun `1774094518930` → `1777284686423`). Scheduling-bypass edges and `dance_interest` extraction preserved; no double-dig.

- **FIX 4 — "Just book me" bypass stall.** `Extract Variables` `1777280545153` had a dead-end Else edge (required non-empty `dance_interest`) → empty-`dance_interest` bypass callers stalled. Added Else → Main Pitch `1776244506867` (skips the Update Dance Interest write so no empty/hallucinated value is sent). Happy path unchanged.
- **FIX 5 — Get Preferred Time loop.** `Get Preferred Time` `1773656520723` had no path for "I'll take the earliest / you pick / whatever's soonest" → looped re-asking. Added a defer edge → on-demand `get_earliest_slot` → branch on `earliest_iso != ""`: if present, offer it ("The earliest we have is <day at time> — let me grab that for you") → existing availability-check → confirm → book chain; if empty, graceful "what day works best?" (never speaks a blank/ISO). 5 new nodes near the booking cluster; reuses existing booking chain.

Final re-simulation (tools mocked, faithful n8n contract incl. empty-earliest variant): **24/24 scenarios pass** (8 × 3 runs) — FIX 5 happy + empty paths, plus FIX 1–4 regressions. Zero loops, zero regressions.

**Note:** the dramatic "goodbye loop" in the FIRST sim was amplified by a mock field-name mismatch (`slot_available` vs live `is_available`); FIX 2 is still a genuine hardening. Tool contract cross-checked against the live `-joshua` workflow — matches.

**Orphaned node (untouched):** legacy `Get Earliest Slot` `node-1773896597743` has no inbound edges — unused/harmless, left in place (not ours to delete).

---

### v2 — data-driven earliest pitch + soonest-day resolution + 1h enforcement (PUBLISHED 2026-06-05; pins bumped 1→2)
Three tickets shipped together as one published version. Client decisions: build all three together; minimum lead time = exactly 1 HOUR.

**TICKET 1 — prefetch earliest + data-driven, empty-safe pitch (Retell)**
- NEW function node `node-prefetch-earliest` ("Prefetch Earliest Slot") inserted in the start chain: current-time Code `node-1777781703793` → (else_edge repointed) → prefetch (tool `tool-1773896569777`, `wait_for_result:true`) → both success edge and `else_edge` → `Logic Split node-1773476796411`. Populates `earliest_*` + `earliest_available` before the pitch. Empty-path handled by the pitch, so the error edge to Logic Split is safe.
- `Main Pitch node-1776244506867`: DELETED the literal "and the we can start as early as next week Tuesday." and the "don't skip the word next" rule. Replaced with an empty-safe conditional — if `{{earliest_available}}=="true"` (or `{{earliest_iso}}` non-empty), speak `{{earliest_formatted}}` as natural "[day] at [time]"; else say a generic "we've got a few openings coming up — what day works best for you?" naming NO day. Never speaks a blank/ISO/variable name. ($80 + 45-min pitch body preserved.)

**TICKET 2 — de-bias day resolution to SOONEST upcoming occurrence (Retell)**
All four nodes patched in lockstep (both Day-Slot subgraphs):
- Extractor `day` descriptions `node-1776430870236` + `node-1774105492169`: bare day name → soonest upcoming occurrence (this week if ≥1h ahead of `{{current_time_AmericaChicago}}`, else next week); explicit "next [day]"/"X weeks"/"after next" preserved; added "MOST-RECENTLY-NAMED-DAY WINS — discard a prior `day`" override (fixes "is Friday?" after "Tuesday"); fixed the variable name from the non-existent `{{current_time_America/Chicago}}` to the real `{{current_time_AmericaChicago}}`.
- Resolver Code `node-1777692711035` + `node-1777696582810`: replaced the forced `getNextSunday(now)` next-week roll with soonest-occurrence math + a 1-hour minimum-lead guard (rolls to next week only if the this-week occurrence is <1h away/past); `extraWeeks` modifier preserved and applied on top.

**TICKET 3 — earliest_available signal + 1h buffer confirms (n8n `LXlMa0Gy2Fq2xuUO`)**
- `Earliest Slot` `dc6f1261…`: added additive string field `earliest_available` ("true"/"false"); on no slot, returns empty `""` for `earliest_formatted`/`earliest_date`/`earliest_display`/`earliest_iso` and `earliest_available:"false"` — REMOVED the "next week"/"next week Tuesday" fabricated fallback. Make-equivalence preserved (additive only).
- `Return Earliest Slot` `d5b9ae90…`: added `"earliest_available"` to the JSON body.
- 1h buffer CONFIRMED: `Calculate Slot Window` `d529b3bd…` already uses `now.plus({ hours: 1 })` — exactly 1h, no change. GAP FOUND + FIXED on the same-day specific-day path: `Day Summary1` `8e561700…` did NOT filter slots <1h away for same-day requests (only `Check Day` blocked closed/strictly-past whole days). Added a same-day-only guard that drops any slot <1h from server-now (Chicago); future days unaffected; empties to the graceful "no open slots on [day]" message.

**Verification (deterministic, gate-passed):**
- Resolver unit tests 8/8: Wed→"Friday"=this Fri (live Friday bug FIXED); Friday-after-Tuesday=this Fri (most-recent override); Fri-3pm→"Friday"=next Fri (rolls forward); Tue-1:00→Tue-1:15=next Tue (<1h); Tue-1:00→Tue-2:00=same-day (>1h); "next Friday"=following Fri; "2 weeks"=+2wk; Mon→"Saturday"=this Sat.
- n8n contract unit tests: real slot → `earliest_formatted:"Tuesday, 2:00 PM"` + `earliest_available:"true"`; no slot → all spoken fields `""` + `"false"` (no fabricated day); same-day filter drops 1:15, keeps 2:00/3:00; future day unfiltered.
- 22/22 flow-state checks pass on flow v2 (prefetch present + wired, pitch literal removed + empty-safe, 2 extractor descs + 2 resolver codes patched).
- Retell flow validated to compile (update succeeded — Retell rejects malformed graphs). n8n validate: only pre-existing warnings + the pre-existing false-positive `Get Alternates` "{{}}" error (Luxon format string, not ours).

**NOT verified (honest):** No end-to-end LLM batch simulation was run — the Retell `tests.createBatchTest` path requires publishing first and would execute real `create_appointment` against the live GHL calendar. Conversational truthfulness of the pitch read, FIX 5 deferral interaction, closed-day phrasing, single-goodbye/no-loop, and latency (TTFT/e2e, incl. the added prefetch round-trip) are PENDING live test calls. The prior v1's mocked-tool dashboard sim could not be driven from this surface.

**Trade-offs (named):** T1 adds one blocking `wait_for_result` tool round-trip at call open before the pitch (bet: overlaps greeting/reason discovery; truthful anchoring worth it). T2 soonest-occurrence can now land same-day (≥1h) — intended per client 1h rule. T3 same-day callers see a filtered (smaller) slot list — correct per policy.

---

### v3 — latency + naturalness ("less robotic") pass (PUBLISHED 2026-06-05; pins bumped 2→3)

Triggered by the v2-validated booking call `call_34dd02e2947525d4e54d2b0614b` (quality 9, positive, booked) plus client feedback: "agent still too slow to respond, voice sounds robotic." Measured: e2e p50 **2023ms** (target <900ms, first milestone ≤1200ms); LLM TTFT p50 836ms / p90 1062ms / max 1407ms; TTS 186ms / ASR 163ms (both fine). LLM TTFT + turn-taking dominate; the ~2s gaps are the robotic tell. Build executed directly by principal-ai-engineer under the §0 gate (senior-retell-engineer Agent tool unavailable in this surface).

**Mechanism note:** flow v2 was the published/immutable flow. Created agent draft via `agent.createVersion(base_version:2)` → forked an editable conversation-flow **v3**; edited flow v3 + agent v3 settings; `agent.publish(version:3)`. `model_choice.high_priority` (not top-level `high_priority`) is the live HP flag.

**PART A — latency**
- **A1 — high_priority TRUE** on the 6 booking hot-path nodes (`model_choice.high_priority` false→true): both Get Preferred Time (`node-1773656520723`, `node-1776430637461`), both One Layer Deeper (`node-1776245287680`, `node-1777284686423`), FIX 5 Offer Earliest (`node-fix5-offer-earliest`) + Ask Day (`node-fix5-ask-day`). Greeting / Main Pitch / First Question ×2 were already HP. The "day-slot summary read" is the `{{day_available_slot}}` read **inside** the two Get Preferred Time nodes — no separate node exists, so it's covered by A1.
- **A2 — model downgrade** on the scripted-read `Get Preferred Time node-1773656520723` only: gpt-5.1 → gpt-5.4-mini. (`node-1776430637461` was already gpt-5.4-mini from a prior pass.) One Layer Deeper kept gpt-5.1 (HP-only; re-measure before any downgrade). gpt-5.5 Question Handling ×3 + Special Request **untouched** (FIX 1 anti-hallucination revert — accepted tax).
- **Prefetch check (`node-prefetch-earliest`, `wait_for_result:true`):** sits at call-open under the greeting + reason discovery; one blocking round-trip is overlapped by the spoken open — not on a per-turn booking path. Confirmed fine; left as-is.
- **Trade-off (PriorityLane dilution):** PriorityLane is finite; HP now on 10 nodes vs the original 4 dilutes the lane. Bet: booking-path per-turn latency matters more than marginal greeting speed; the slow turns measured were all on the now-HP booking nodes.

**PART B — naturalness ("less robotic")**
- **B1 — voice_speed 1.08 → 1.13** (agent setting; `enable_dynamic_voice_speed` stays on). SUBJECTIVE — applied as a modest bump, **flagged for client to judge by ear** on the next live call; trivially reversible.
- **B2 — One Layer Deeper de-stutter** (both `node-1776245287680` + `node-1777284686423`, identical text). The v2 transcript glitch was "Got it, wanting something totally new is exciting—got it - and is there a particular style…" — a doubled "got it" + em-dash run-on, caused by the model ad-libbing an acknowledgement AND appending the canned safe-fallback stem `"Got it - …"`. Fix: removed the `"Got it - "` stem; safe fallback is now `"That's a great start. Is there a particular style or feel you're hoping to learn?"` used as the WHOLE turn (one ack, then the question); added hard rules — ONE acknowledgement only, never repeat "got it", no em-dash joins, ack and question as two clean sentences; converted all spoken examples to period-separated clauses. Verified: 0 em-dashes and 0 "Got it -" in both nodes.
- **B3 — `normalize_for_speech` evaluated → LEFT FALSE.** The complaint is latency/cadence, not mispronunciation; no price/time mis-read appears in the call review. Prompts already hand-author spoken forms ("forty-five minute", "2pm to 9pm", "$80"); turning normalize ON risks conflicting with those and altering the already-validated v2 reads, and is a TTS-layer behavior not regression-testable via sim. Candidate to A/B only if a future call surfaces a real mispronunciation.
- **B4 — pitch warmth (`node-1776244506867`), conservative.** Only the "IF RETURNING FROM OTHER NODES" bridge instruction reworded to sound genuinely glad and reflect the caller's own words; **no pricing/policy/required-content change** ($80 + forty-five-minute + earliest-availability data logic all preserved, verified).
- **begin_message_delay_ms (1500) — UNTOUCHED.** Adds 1.5s only at call-open (voicemail-detection trade the client chose). Flagged as a separate decision, not changed here.

**Regression verification (routing/wording only — sim CANNOT measure latency or voice):**
No edges, transition conditions, or node topology were changed. Proven by diffing v2 vs v3: edges + transition_condition byte-identical on all 7 edited nodes; node count 106 = 106. Since transition conditions are unchanged, the same edges fire on the same inputs → no routing regression possible. Fact/policy nodes confirmed still gpt-5.5. A full LLM batch sim was NOT run (would require publishing first and would book real GHL appts — same honest constraint as v2); structural-equivalence is the correct gate for a flags-and-prompt-body change. Booking flow, discovery, FIX 5 deferral, and no-loop are structurally intact.

**ONLY confirmable on the next live call (NOT verified by this work):**
1. e2e latency drop (target p50 ≤1200ms on booking-path turns; <900ms stretch) — slow turns that were 1817/1624/1549ms in earlier calls must fall <1200ms now they're HP. Read from `calls` latency cols / instant-review pipeline vs `call_34dd02e2947525d4e54d2b0614b` as control.
2. Voice naturalness at speed 1.13 — purely by ear; revert to 1.08 if too fast.
3. The de-stuttered acknowledgement actually reads as one clean clause in production.

**Pins:** Retell phone `+17623713782` `outbound_agent_version` 2→3 ✅; n8n `Trigger Retell Outbound Call` (`89ae6077`, wf `LXlMa0Gy2Fq2xuUO`) `override_agent_version` 2→3 ✅. Both in lockstep at 3.

### v4 — call-open latency REGRESSION fix + voice speed (PUBLISHED 2026-06-05; pins bumped 3→4)

**Own it:** this was a **v2-introduced regression**. v2's "prefetch earliest at call start" design put a **blocking, silent** `get_earliest_slot` call on the call-open path, BEFORE the greeting. On the live call `call_4db20bcab0a06b906be1afce24e` (v3) the caller hung up at ~14s because the agent took ~10s to start talking. v3's prefetch note ("one blocking round-trip overlapped by the spoken open") was **wrong** — the prefetch fires at `time_sec 0`, BEFORE any greeting, so nothing overlaps it; the greeting waits on the full GHL round-trip (up to the 8000ms tool timeout) plus `begin_message_delay_ms=1500` plus greeting generation.

**Root-cause chain (confirmed live):** start `node-1777604631592` → current-time Code `node-1777781703793` → `else_edge` → **`node-prefetch-earliest`** (function, tool `tool-1773896569777` get_earliest_slot, `wait_for_result:true`, `speak_during_execution:false`, timeout 8000ms, hits GHL via `/webhook/get_earliest_slot-joshua`) → `node-1773476796411` (Logic Split → greetings). The greeting cannot be reached until the blocking tool returns.

**Retell-docs finding (function-node non-blocking semantics).** Verified via `mcp__retell__search_docs`, the official function-node docs page, and web docs:
- With `wait_for_result:false` + `speak_during_execution:false`, the flow **"transitions immediately after function gets invoked, right upon entering the node"** → greeting is instant. (Docs-guaranteed.)
- BUT the docs **explicitly do NOT guarantee** that the tool's `response_variables` populate when `wait_for_result:false`: *"output variables may not be populated yet when transitioning to downstream nodes… account for this in your flow logic."* The docs even advise attaching a conversation node to communicate the result rather than assuming availability.

**Approach chosen: A (flip the flag in place), NOT B (reposition).** Set `node-prefetch-earliest.wait_for_result` **true → false** (speak_during_execution stays false). Rationale vs. B (reposition the prefetch after the greeting at a single chokepoint):
- The greeting/discovery graph has **no single chokepoint** every path-to-pitch passes through (General + 3 Reason greetings each fan out via their own First Question / One Layer Deeper / "just book" bypass; Reason variants also go direct to pitch). A robust reposition would need ~4 insertions, each re-introducing a blocking mid-conversation call — adding routing-regression risk.
- Approach A flips ONE flag, **docs-guarantees the instant greeting** (the actual bug that caused the hangup), and its only downside is bounded: if the background tool hasn't populated `earliest_*` by the time Main Pitch runs, the pitch **already** falls to its safe line "and we've got a few openings coming up — what day works best for you?" (no blank, no ISO). In practice the GHL round-trip (~1–3s) completes long before the pitch at ~20–30s, so `earliest_*` will almost always be set — the docs just stop *guaranteeing* it at the transition instant. Worst case we lose ONE optional "as early as Tuesday" sentence, which is exactly what the existing fallback handles gracefully. That is a far better trade than re-introducing a blocking call or a 4-node restructure to protect one sentence.

**Voice (FIX 2):** `voice_speed` 1.13 → **1.20** (client-approved; `enable_dynamic_voice_speed` stays on). `begin_message_delay_ms` left at **1500** (client's voicemail-detection choice; the 8s blocking prefetch was the real opener problem, not the 1.5s — note it can be trimmed later for sub-2s opens).

**Mechanism:** flow v3 was published/immutable → `agent.createVersion(base_version:3)` forked editable flow **v4** → edited flow v4 node + agent v4 `voice_speed` → `agent.publish(version:4)`.

**§0 trace.**
- **Why?** Fixes a confirmed v2-introduced open-latency regression that caused a real caller hangup (sound-human / fast-open mission goals).
- **Touches?** Exactly one flow node's one field (`node-prefetch-earliest.wait_for_result`) + one agent setting (`voice_speed`). Tool `get_earliest_slot` unchanged; n8n earliest pipeline unchanged.
- **Breaks (trace)?** *Happy:* greeting fires immediately at open; `earliest_*` populate in the background, ready by Main Pitch (~20–30s later). *Empty / slow-GHL:* if `earliest_*` not yet set at pitch time, pitch reads "we've got a few openings — what day works best?" (no blank/ISO) — verified the pitch node's fallback text is unchanged. *Booking / discovery / FIX 5 deferral:* untouched — `get_earliest_slot` is re-invoked on-demand in the FIX 5 path regardless of the prefetch, so deferral still works. *Routing:* structural diff v3→v4 = only `wait_for_result` changed on this one node; `edges` + `else_edge` byte-identical; node count 106=106; `start_node_id`, `tools`, `global_prompt` identical → no routing regression possible.
- **Sounds-like?** Instant greeting (the reason-based variant still routes via Logic Split — greeting variants untouched), then natural discovery, then pitch with or without the earliest-day line depending on data.
- **Trade-off?** Tiny risk the `earliest_*` vars aren't ready if the GHL round-trip runs unusually long (>~25s); mitigated by the pitch's safe generic fallback (no hallucination, no blank). Voice 1.20 is faster — flagged for client to judge by ear; trivially reversible.

**Regression verification (structural-equivalence — sim CANNOT measure the open-latency fix; that's live-only).** Diffed flow v3 vs v4: one node changed, one field, edges/transitions byte-identical. No LLM batch sim run (would require publishing first + would book real GHL appts — same honest constraint as v2/v3). Booking flow, discovery, FIX 5 deferral, and the pitch empty-path are structurally intact.

**ONLY confirmable on the next live call (NOT verified here):**
1. The call-open latency improvement — greeting should now start ~1.5–2.5s after pickup (begin_message_delay + greeting gen) instead of ~10s. Read from the next call's transcript timestamps / `calls` latency cols vs `call_4db20bcab0a06b906be1afce24e` as the control.
2. `earliest_*` reliably populated by Main Pitch in production (the docs' non-guarantee for non-blocking vars) — if the "as early as <day>" line ever goes missing, that's the signal it wasn't ready; the safe fallback covers it either way.
3. Voice naturalness at speed 1.20 — by ear; revert to 1.13 if too fast.

**Pins:** Retell phone `+17623713782` `outbound_agent_version` 3→4 ✅ (Retell phone-number config — there is no Supabase `outbound_agents` table in this project); n8n `Trigger Retell Outbound Call` (`89ae6077`, wf `LXlMa0Gy2Fq2xuUO`) `override_agent_version` 3→4 ✅. Both in lockstep at 4.

### v5 — greeting PACE fix (length + speaking rate + start delay) (PUBLISHED 2026-06-05; pins bumped 4→5)

Triggered by live call `call_c139a22fbeacc02eb8cc15e57e8` (v4). v4's open-BLOCK fix worked — the greeting now plays in full (no 10s block). But the caller hung up at **14s during the greeting** and reported "agent still talking too slow." Root cause is no longer lag: the greeting was a ~35-word monologue that takes ~10s to deliver even at voice_speed 1.20. So the open still *felt* slow — that's greeting **length + speaking rate**, not a round-trip stall.

**Mechanism:** flow v4 was published/immutable → `agent.createVersion(base_version:4)` forked editable flow **v5** (response engine repointed to flow v5) → edited the 4 greeting node prompts on flow v5 + the 3 agent v5 voice/delay settings → `agent.publish(version:5)`.

**CHANGE 1 — shorten all 4 greetings ~50-60%** (kept: identity = Sarah + Arthur Murray Lincolnshire; brief reason personalization where the variant has it; the "is now a good time?" gate verbatim-in-intent; `{{first_name}}` default "there"). Dropped the explicit "I'm their virtual assistant" line to hit ~12-18 words (identity rules permit disclosure only if asked/natural; global "are you AI" handling still covers it).

| Node | Name | BEFORE | AFTER |
|---|---|---|---|
| `node-1774931569845` | General Greeting | "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I'm their virtual assistant and I heard you wanted to dance! Is now still a good time to chat?" | "Hi {{first_name}}, it's Sarah from Arthur Murray Lincolnshire. Heard you're interested in dancing — is now a good time?" |
| `node-1774094516287` | Reason Wedding | "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I'm their virtual assistant and I heard you are preparing for a wedding. How exciting! Is now a good time to chat?" | "Hi {{first_name}}, it's Sarah from Arthur Murray Lincolnshire. Heard you've got a wedding coming up — exciting! Is now a good time?" |
| `node-1774094517507` | Reason Special Occasion | "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I'm their virtual assistant and I noticed you are preparing for a special occasion. Great! Is now a good time to chat?" | "Hi {{first_name}}, it's Sarah from Arthur Murray Lincolnshire. Heard you've got a special occasion coming up — is now a good time?" |
| `node-1774094518930` | Reason For Fun | "Hi {{first_name}}, this is Sarah from Arthur Murray Lincolnshire, the dance studio. I'm their virtual assistant and it sounds like you're looking to learn some dancing! Is now a good time to chat?" | "Hi {{first_name}}, it's Sarah from Arthur Murray Lincolnshire. Heard you're looking to dance just for fun — is now a good time?" |

The "IF RETURNING FROM ESCALATION…" bridge line and the "Call behaviours: Limit the conversation to verifying whether now is a good time" limiter were preserved unchanged on all 4 nodes.

**CHANGE 2 — voice (agent settings):** `voice_speed` 1.20 → **1.25**; `enable_dynamic_voice_speed` true → **false** (consistent 1.25 with no dynamic slowdown on longer reads).

**CHANGE 3 — start delay:** `begin_message_delay_ms` 1500 → **600** (cuts most of the dead air at open). **FLAGGED:** weaker voicemail detection than 1500ms (600ms gives less lead time for the machine-greeting to register before the agent speaks) — but a far snappier open. Reversible. The earlier v0–v4 voicemail-detection rationale for 1500 is knowingly traded down here for open speed.

**§0 trace.**
- **Why?** v4's open-block fix worked but the open still FEELS slow — caller hung up at 14s mid-greeting citing pace. Long greeting + speaking rate are now the bottleneck (sound-human / fast-open mission goals).
- **Touches?** 4 greeting node prompts (flow v5) + 3 agent settings (voice_speed, enable_dynamic_voice_speed, begin_message_delay_ms). No edges, no other nodes, no booking flow, no v2 data-driven pitch, no v3/v4 fixes, no prefetch node, no gpt-5.5 fact nodes.
- **Breaks (trace)?** *Empty-path:* every greeting starts "Hi {{first_name}}, …" with default "there" → "Hi there, it's Sarah…" reads naturally. *Routing:* all greeting outgoing edges are conditioned on the USER's reply ("Good time to talk…", "shares a clear motivation", "wants to proceed to scheduling directly", reason-variant "mentions group classes") — NOT on the agent's wording. The "is now a good time?" gate is preserved in all 4, so the same edges fire on the same inputs → no routing regression possible. *Hallucination:* shorter text gives the LLM less to embellish; reason personalization stays factual to the variant. *Type:* no variable types touched.
- **Sounds-like?** Read aloud, each is a warm, complete opener — identity, a one-clause nod to why they reached out, then the gate. Not clipped. ~3-4s to deliver at 1.25 vs ~10s before.
- **Trade-off?** `begin_message_delay_ms` 600 weakens voicemail detection vs 1500 (named, reversible); voice 1.25 + dynamic-off is faster and more consistent but could read slightly brisk — judge by ear on the next live call.

**Regression verification (routing/wording only — sim CANNOT measure voice speed or perceived pace; that's live-only).** Structural: no edges, transition conditions, or topology changed — only the 4 greeting `instruction.text` bodies and 3 agent settings. Each greeting retains the "is now a good time?" gate the downstream edges key off, so greeting → good-time gate still routes correctly to First Question / discovery. A full LLM batch sim was NOT run (would require publishing first + would book real GHL appts — same honest constraint as v2–v4).

**ONLY confirmable on the next live call (NOT verified here):**
1. **The pace improvement** — greeting should now take ~3-4s to deliver (vs ~10s) and the open should feel snappy. The caller's "too slow" complaint is the thing to re-check. Read from the next call's transcript timestamps vs `call_c139a22fbeacc02eb8cc15e57e8` as control.
2. Voice naturalness at 1.25 with dynamic speed off — by ear; revert to 1.20 / dynamic-on if too brisk.
3. Voicemail-detection reliability at begin_message_delay 600ms — watch the next few voicemail-reached calls; bump back toward 1500 if detection degrades.

**Pins:** Retell phone `+17623713782` `outbound_agent_version` 4→5 ✅ (verified before=4 / after=5); n8n `Trigger Retell Outbound Call` (`89ae6077`, wf `LXlMa0Gy2Fq2xuUO`) `override_agent_version` 4→5 ✅ (verified `jsonBody` now `"override_agent_version": 5`). Both in lockstep at 5.

---

## n8n tool contract (cross-checked, used by FIX 2 edge conditions)
- `availability-check-joshua` → `is_available` ("true"/"false"), `is_available_summary`, `alt_time_1_iso`, `alt_time_2_iso`
- `create-appointment-joshua` → `status` ("Appointment created successfully"), `event_id`
- `get_earliest_slot-joshua` → `earliest_iso/display/date/formatted` + `earliest_available` ("true"/"false"; on no slot all spoken fields are "" and earliest_available is "false") — added v2
- `get-current-datetime-joshua` → `current_iso`, `current_display_time`
(Full inventory in session recon / [[am-lincolnshire-joshua-draft]].)

---

## Known issues / open items

| # | Item | Status |
|---|---|---|
| 1 | **Df bypass Extract trap** | ✅ FIXED in v1 (FIX 4) — Else → Main Pitch |
| 1b | **Get Preferred Time loop** ("wants earliest") | ✅ FIXED in v1 (FIX 5) |
| 2 | **STT 450ms endpointing** not settable via API on this flow type; `stt_mode=fast` approximates it | Dashboard-only if precise value wanted |
| 3 | **Degraded escalation** — `Escalate Message` on the clone has Sheets+Discord disabled → escalations return success but go nowhere | Accepted as silent (no Sheets/Discord access) |
| 4 | **Real-data bookings** — booking tools hit the live GHL calendar | Joshua deletes test appts manually |
| 5 | **Latency unmeasured** — sim can't measure TTFT/endpointing; needs live calls | Pending test calls |
| 6 | **Voicemail** — leaves a message; `begin_message_delay_ms=1500` front-loads 1.5s silence at call open | By design (voicemail detection) |
| 7 | **Few-shot examples** in One Layer Deeper are invented | Swap for real transcripts after test calls |
| 8 | **Defect 1 (Friday→Tuesday)** from call_61c0… | ✅ FIXED in v2 (Ticket 2) — soonest-occurrence resolver, verified 8/8 unit cases incl. exact bug |
| 9 | **Pitch hardcoded "next week Tuesday"** | ✅ FIXED in v2 (Ticket 1) — data-driven from prefetched earliest, empty-safe |
| 10 | **v2 conversational paths + latency unverified** | PENDING live calls — no end-to-end batch sim run (would book real GHL appts); prefetch round-trip latency at call-open unmeasured |

---

## Eval metrics (baseline before/after)
1. **Follow-up relevance** — does the follow-up reference the caller's actual answer? Rubric 0–10, target ≥9/10 across 10 calls.
2. **Follow-up fires once** — exactly one discovery follow-up per substantive call; zero on bypass.
3. **End-of-speech → first-word latency** — p50/p95 from Retell call analysis; steady-state target <900ms.
4. **Booking-rate** — no regression vs prior.
5. **No goodbye loop** — every completed booking ends cleanly.

Substrate: `calls` / `call_reviews` + instant-call-review pipeline (Postgres trigger → `analyze-single-call` edge fn → Realtime UI).

---

## Live-call test script
1. **Substantive** (minimal greeting, then) "I want to feel more confident dancing at parties." → one relevant follow-up → pitch.
2. **Substantive, front-loaded** "Yeah now's good — I want to get confident dancing at parties." → (FIX 3) should STILL get one follow-up.
3. **Wedding** "It's for my wedding this fall." → wedding-specific follow-up.
4. **Vague** "I dunno, just always wanted to try." → safe fallback follow-up.
5. **Just book me** "Can we skip to scheduling?" → no follow-up, straight toward booking.
6. **Complete a booking** → confirm single goodbye, no loop.
7. **Voicemail** → leaves the message cleanly.

---

## TEST CALL ANALYSIS LOG

> Append one row per analyzed call. Paste call IDs and I'll fill in the analysis.

| Date | call_id | Agent ver | Scenario | Dir | Picked up | Follow-up fired? | Follow-up relevant? | Latency feel | Booked? | Loop? | Sentiment | Notes / action items |
|------|---------|-----------|----------|-----|-----------|------------------|---------------------|--------------|---------|-------|-----------|----------------------|
| 2026-06-04 | call_61c023d8798f96823bb50ac6a33 | 1 | live test — discovery + day-availability | outbound | yes | yes | yes | SLOW ~2s e2e (p50 2025ms) | no | no (hung up) | neutral | CRITICAL: "is Friday available?" returned Tuesday June 9 every time → user hangup. PRIORITY: LLM TTFT dominates latency. Two fixes scoped (separate publishes). See Detailed notes. |
| 2026-06-05 | call_34dd02e2947525d4e54d2b0614b | 2 | live test — booking (earliest-slot redesign) | outbound | yes | yes | yes | SLOW ~2s e2e (p50 2023ms / max 2439ms); TTFT p50 836 / p90 1062 / max 1407; TTS 186 / ASR 163 | **yes** | no | positive | VALIDATED v2 earliest-booking redesign (quality 9). Latency still ~2s + voice feels robotic per client. → drove **v3** latency + naturalness pass (HP on 6 booking nodes, scripted-read downgrade, One Layer Deeper de-stutter, voice_speed 1.13). v3 latency/voice gains confirmable only on next live call. |
| 2026-06-04/05 | call_4db20bcab0a06b906be1afce24e | 3 | live test — call open | outbound | yes | n/a (hung up during greeting) | n/a | CRITICAL ~10s to first word at OPEN | no | no (hung up at ~14s) | negative | **ROOT CAUSE = blocking call-open prefetch.** `node-prefetch-earliest` (`wait_for_result:true`, silent) makes a blocking `get_earliest_slot` GHL round-trip (timeout 8000ms) BEFORE the greeting; + begin_message_delay 1500ms + greeting gen ≈ ~10s silence → caller hung up. This was a **v2-introduced regression**. **FIXED in v4:** `wait_for_result` true→false (non-blocking; greeting instant, earliest_* populate in background, pitch empty-path fallback covers the rare not-ready case). Open-latency fix confirmable ONLY on the next live call. |
| 2026-06-05 | call_c139a22fbeacc02eb8cc15e57e8 | 4 | live test — call open (pace) | outbound | yes | n/a (hung up during greeting) | n/a | open no longer BLOCKED (v4 fix confirmed working — greeting plays in full) but still FEELS slow: ~35-word greeting ≈ ~10s to deliver even at voice_speed 1.20 | no | no (hung up at ~14s during greeting) | negative | **v4 open-block fix CONFIRMED working** (greeting reached + spoken in full, no 10s stall). New root cause = greeting **length + speaking rate**, not lag. → drove **v5**: shortened all 4 greetings ~50-60% (~12-18 words), voice_speed 1.20→1.25, enable_dynamic_voice_speed→false, begin_message_delay 1500→600. v5 pace gain confirmable ONLY on the next live call (sim can't measure perceived pace). |

### Detailed notes
<!-- Per-call deep-dives go here: transcript excerpts, node traces, defects found, fixes proposed. -->

#### call_61c023d8798f96823bb50ac6a33 — 2026-06-04 (agent v1, outbound, 126s, user_hangup, not booked, quality 5, neutral)

Reviewed by senior-retell-engineer + senior-n8n-engineer (diagnosis) and principal-ai-engineer (gate). Principal **corrected** the Defect-1 root cause against the live tool-call logs.

**Defect 1 (CRITICAL) — "Friday" resolved to Tuesday every turn → caller hung up.**
Transcript: caller said "Tuesday would be good. And is Friday available?", then twice "Is Friday available?" / "No, not Tuesday, Friday." Tool returned Tuesday June 9 slots all three times.

- Tool-call evidence (extractor outputs): call 1 `day=2026-06-09T10:16:00-05:00`, call 2 `day=2026-06-09T14:16:00-05:00`. Time component tracked the call clock (10:16→14:16) but the **calendar date stayed pinned to Tuesday June 9** even on turns where the caller said ONLY "Friday."
- **Root cause (principal-corrected):** the extractor re-resolves each turn (it is NOT re-emitting a frozen anchor) and independently lands on Tuesday. The bug is in the `day` variable **description** on both extractors (`node-1776430870236`, `node-1774105492169`, identical): rigid "bare day name → next week" rules with worked examples for **Tuesday and Saturday only — no Friday example** — and **no clause to discard a prior `day` when the caller names a new day.**
- n8n EXONERATED: `day-slot-check-joshua` (execs 68929/68930) faithfully returned slots for the Tuesday date Retell sent. Bug is 100% Retell-side.
- **Required pre-step:** confirm whether `day` is `const`-bound on tool `tool-1774105669590` (both Day Slot Check nodes share it) before editing.
- **Fix (Publish A, pins 1→2):** rewrite `day` description on both extractors in lockstep — per-bookable-day worked examples incl. Friday; explicit "most-recently-named-day-wins, discard prior `day`" override; multi-day-in-one-utterance disambiguation (resolve the day being *asked about*). Trace empty-day → tool → n8n. Prompt-only first; escalate extractor model only if sim fails. Keep const binding if confirmed.
- **Deferred (separate tickets):** closed-day (Sun/Mon) graceful handling (pre-existing); duplicate subgraph `node-1774105492169` also lacks the FIX 5 earliest-deferral edge.

**Defect 2 (PRIORITY per client) — latency.**
Measured: e2e p50 2025ms / max 2779ms (target <900ms); LLM TTFT p50 725ms / p90 1662ms; slow turns 1817ms (One Layer Deeper, gpt-5.1, NOT HP) + 1624/1549ms (day-slot summary reads on Get Preferred Time `node-1776430637461`, gpt-5.4-mini, NOT HP). TTS 188ms / ASR 271ms (fine). LLM TTFT dominates.
- Confirmed live: only 4 nodes HP (Greeting `1774931569845`, Main Pitch `1776244506867`, First Question ×2). Entire booking hot path is `high_priority:false`.
- **Fix (Publish B, pins 2→3):** HP `true` on both Get Preferred Time (`1773656520723`, `1776430637461`), both One Layer Deeper (`1776245287680`, `1777284686423`), Offer Earliest (`node-fix5-offer-earliest`), Ask Day (`node-fix5-ask-day`). Downgrade gpt-5.1→gpt-5.4-mini on scripted-read Get Preferred Time `1773656520723` ONLY (HOLD FIX 5 read downgrades — they speak slot times). Leave One Layer Deeper on gpt-5.1 (HP only), re-measure first. Do NOT touch gpt-5.5 fact nodes (FIX 1 anti-hallucination revert). `begin_message_delay_ms=1500` untouched (call-open only).
- **Trade-off (named):** PriorityLane is finite; adding HP nodes dilutes the lane vs the original 4. Bet: booking-path per-turn latency > marginal greeting speed.

**Sequencing:** SEPARATE publishes. A (Friday) first — it broke a real booking; latency only slowed it. Each bumps both version pins in lockstep.

**Eval to confirm on next calls:**
- Defect 1: caller-named-day → tool `day` arg lands on that weekday. Target 6/6 in re-sim (incl. multi-day + closed-day utterances), then 100% across next 3 live calls.
- Defect 2: e2e p50 ≤ 1200ms on booking-path turns (first milestone; <900ms stretch). Slow turns (1817/1624/1549ms) must drop <1200ms once HP. Read from `calls` latency cols / instant-review pipeline vs this call as control.

---

## 2026-06-08 — v8 PUBLISH: fix post-pitch improvised wrong-day line (Get Preferred Time arrival)

**Bug (call_8054, v7):** Node `Get Preferred Time` `node-1773656520723` (gpt-5.4-mini) had branches for RETURNING-FROM-* and GET TIME but **no branch for the fresh "arrived from the pitch" entry path** (Main Pitch `node-1776244506867` → silent Code 2 `node-1777605149061` → Get Preferred Time). With no scripted line it improvised: "Absolutely - Bachata is a great choice. you like to come in next Wednesday at 2:00 PM?" → repeated the dance-style compliment, dropped "Would" (grammar), hallucinated "next Wednesday" (it does not read earliest_formatted).

**Why a prose fix failed (and was reverted):** First attempt prepended an "ARRIVING FROM THE PITCH" branch to the node instruction. `playground.completion` sim proved gpt-5.4-mini could NOT reliably condition spoken output on `{{earliest_available}}` inside one long instruction — Case A correct only 1/3, Case B improvised double-asks / incoherent "come in then" with no slot. Get Preferred Time instruction was restored byte-identical to v7 (verified == v7).

**Fix (STRUCTURAL, deterministic):** Repointed Code 2 `else_edge` from Get Preferred Time → new branch `node-pitch-earliest-branch` ("Pitch: Earliest Offered?", equation `{{earliest_available}} == "true"`):
- **TRUE** → `node-pitch-earliest-offer` ("Pitch Earliest Offer", gpt-5.4-mini HP): says EXACTLY "Would you like to come in then, or is another day better for you?" (no compliment, no restated/"next" day, no spoken var → empty-var safe). Accept → `node-fix5-fetch-earliest` (earliest fast-path). Other-day → `node-1773656520723` (Get Preferred Time GET TIME logic).
- **ELSE** → `node-pitch-noearliest-wait` ("Pitch No-Earliest Wait", silent passthrough): no speech (pitch already asked "what day works best?"), forwards to Get Preferred Time once caller names a day. Eliminates the pre-existing no-earliest double-ask.

**Sim results (playground.completion v8, tools mocked):**

| Scenario | Result |
|---|---|
| A: post-pitch earliest — arrival line | 5/5 exactly "Would you like to come in then..." — no compliment, no "next", grammatical |
| A: caller accepts (yes / sure / perfect) | → Get Earliest Slot → Offer Earliest → Set Preferred → Validation → book (earliest fast-path engages) |
| A: caller wants another day (Friday / next Wed) | → Get Preferred Time → "And what time on that day would you like?" |
| B: post-pitch NO earliest — arrival | 5/5 SILENT at wait node, zero double-ask |
| B: caller names day (day+time / day-only / avail-q) | forwards to Get Preferred Time, collects correctly |
| Returning (availability / issue / final-confirm) | unaffected; new offer line leaked 0/3 |

**Published v8.** Phone `+17623713782` `outbound_agent_version` 7 → 8 (confirmed). **n8n `Trigger Retell Outbound Call` `override_agent_version` → set to 8** (hand to n8n engineer).

**Confirmable only on live call:** real `availability_check` + Code-node runtime execution (stateless playground cannot run the Code node's runtime globals — it errored on `parseNowRaw` and the unmocked `availability_check` 500'd, producing a sim-only transfer-to-team-leader artifact at the tail of the accept path; routing up to that point is correct); perceived latency of the extra branch + conversation-node hop added to the post-pitch path (1 branch eval + 1 short conv node).

---

## 2026-06-09 — v13 PUBLISH: greeting choppiness fix (interruption sensitivity) + simpler client wording

**Scope:** `AM Lincolnshire Agent (Joshua-draft)` `agent_cd8a872b64a03338e6c54a41a0`, flow `conversation_flow_433bca831dcb`. Live published was v11; draft sat at v13 (inherited). Built on/published v13.

**Defect (client-reported, recurring):** Greeting feels choppy/robotic — "stopping on every word." Greeting nodes are already `static_text`, so wording was not the cause.

**Diagnosis (CONFIRMED via word-timing):** A near-zero-duration "(inaudible speech)" event splits the greeting into two TTS utterances at the exact point caller noise is detected — the agent is being INTERRUPTED by background noise/breath, pausing, then resuming. Evidence:
- `call_d418fac7b33883414ac461ce1b3` (v11): agent "...Arthur Murray" ends @3.80s → user "(inaudible speech)" zero-duration blip @3.85s → agent resumes "Lincolnshire..." @3.84s. Split mid-greeting.
- `call_20a7cf00e4a4b58db4aa25ce3b1` (v10): agent "Hi Joshua, it's Sarah" → "from" ends @2.27s → "(inaudible speech)" blip @2.39s → resumes "Arthur Murray Lincolnshire..." @2.31s. Same pattern.
Not backchannel (backchannels fire only while listening to user, not while agent speaks). Root cause = interruption sensitivity too high for a short scripted greeting in a noisy caller environment. The caller's noisy environment itself is not fully controllable; what we CAN control is how readily the agent yields to it during the greeting.

**Fix (greeting nodes only):**
- `interruption_sensitivity` 0.5 → **0.3** on all 4 greeting nodes: General Greeting `node-1774931569845`, Reason Wedding `node-1774094516287`, Reason Special Occasion `node-1774094517507`, Reason For Fun `node-1774094518930`. (Agent-level stays 0.7 — node override governs the greeting; discovery/booking keep normal interruptibility.)
- Simpler client-requested wording, all 4 (kept `{{first_name}}`, kept "is now a good time?" gate, kept `static_text`):
  - General: "Hi {{first_name}}, it's Sarah from Arthur Murray Lincolnshire, the dance studio. Is now a good time?"
  - Wedding: "...the dance studio. Heard you've got a wedding coming up — is now a good time?"
  - Special Occasion: "...the dance studio. Heard you've got a special occasion coming up — is now a good time?"
  - For Fun: "...the dance studio. Heard you're looking to dance just for fun — is now a good time?"

**Trade-off (named):** Lower interruption sensitivity = the agent is harder to interrupt mid-sentence during the greeting. Acceptable for a ~3s scripted line; caller can still cut in cleanly at the gate. If a caller genuinely talks over the greeting, the agent finishes the short line first.

**§0 trace:** routing unchanged (edges evaluate the user's reply, not the spoken text); first_name empty → "Hi there..." (default applies, reads naturally); static_text = zero hallucination surface; no impact on discovery/booking.

**Routing-regression sim (playground.completion v13, from For Fun node):**
| User reply | Route | Correct? |
|---|---|---|
| "Yes." | Reason For Fun → First Question | ✓ good-time/nothing-else |
| "Yes, I'd love to learn, dancing looks fun" | → One Layer Deeper | ✓ good-time + motivation |
| "Yeah sure, can we book?" | → Main Pitch → scheduling | ✓ proceed-to-scheduling |
| "No, I'm driving, call later" | → Bad Time To Talk (callback) | ✓ bad-time handling |
Empty first_name sim → "Hi there, it's Sarah from Arthur Murray Lincolnshire, the dance studio..." ✓

**CONFIRMABLE ONLY ON LIVE CALL:** the choppiness/interruption fix itself. Playground sim cannot measure audio/interruption behavior — the 0.3 sensitivity drop must be verified on a real call in a noisy environment.

**Published v13.** Phone `+17623713782` `outbound_agent_version` **11 → 13** (confirmed live). **n8n `Trigger Retell Outbound Call` `override_agent_version` → set to 13** (hand to n8n engineer).
