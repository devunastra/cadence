# Schaumburg — agent is speaking Lincolnshire's facts

**Status:** ✅ Fixed and published 2026-08-01 as agent **v2**. Not yet test-called —
Schaumburg is still paused (`studios.voice_agent_enabled = false`).
**Written:** 2026-08-01, from the White Rock onboarding session.
**Why it exists:** the same defect was found and fixed on White Rock. This was the same
bug on a different studio.

---

## The problem in one line

Schaumburg's voice agent told callers it was **"Arthur Murray Lincolnshire"**, quoted
**Lincolnshire's hours**, and read from a knowledge base whose studio name was
Lincolnshire — because all three studios' conversation flows shared one knowledge base
and the prompts were cloned verbatim.

Discovered when a White Rock caller was told the studio was open "Tuesday through Friday
2:00 to 9:00" (call `call_945e33ec944556b49628196490e`). Fixing White Rock revealed the
shared source; Schaumburg had it too.

---

## Identifiers

| Thing | ID |
|---|---|
| Studio (Supabase) | `aeefb977-5d03-4e40-994a-327cb51b7918` |
| Timezone | `America/Chicago` |
| Retell outbound agent | `agent_9bd7f902d7e62f788986e85d69` — "AM Schaumburg Outbound Agent (Joshua-draft)", **v2, published** |
| Its conversation flow | `conversation_flow_fab3e82bf94e` — **v2, published** (113 nodes, 12 tools) |
| Its knowledge base | `knowledge_base_05dfb37d64c00d42` — **"AM Schaumburg KB"** (new) |
| Knowledge base (shared, Lincolnshire's) | `knowledge_base_6d01eff4863bb0fd` — "Global Knowledge Base" — **no longer read by Schaumburg** |
| Phone number | `+18472609336` (type `custom`) — inbound `agent_116a6eab4db3287db3a1b0088e`, outbound `agent_9bd7f902…` pinned `latest_published` |
| n8n voice workflow | `Wgg5bQTPJYFsDSn8` |
| n8n inquiries workflow | `rMbzNhw2XP7eBJQq` |
| n8n Discord reports | `8XJjkiw7lT3s9hTM` |
| n8n callback data table | `VmEyZDyEjnlYEIBb` — "AI Callback Schaumburg" |
| GHL | location `upQmnNZT3QeZXbNOA34D`, calendar `XGsTFu73ZQKOZXXdzSuK` |
| Pre-change backup | `backups/retell/agent_9bd7f902d7e62f788986e85d69/20260731T234209Z/` (gitignored) |

**Schaumburg is still paused:** `studios.voice_agent_enabled = false`. Both call paths
are gated on it, so nothing dials while it stays false.

---

## The hours decision — settled 2026-08-01

Four sources disagreed:

| Source | Tue–Fri | Saturday |
|---|---|---|
| `studios.appointment_slots` (what actually books) | 2:00 PM – 8:15 PM | 11:00 AM – 4:15 PM |
| Their welcome email, in `rMbzNhw2XP7eBJQq` | 1pm – 10pm | 10am – 3pm |
| `Calc Schaumburg Call Window` (when the dialer calls) | 1pm – 9pm | 10am – 3pm |
| Global KB (what the agent said before this fix) | 2:00 – 9:00 PM | 11:00 AM – 5:00 PM |

**Resolved: the agent quotes the bookable range** — Tue–Fri 2 PM to 8:15 PM, Sat 11 AM to
4:15 PM — and `studios.appointment_slots` was **left unchanged**. The welcome email's wider
hours are treated as building-open hours, not lesson hours.

Rationale: writing the welcome-email hours without widening the slots ships a caller-facing
contradiction (the agent offers nothing at 1pm or after 8:15 PM). Widening the slots instead
would have changed what real students get booked into — adding 1 PM and 9 PM lessons and
dropping Saturday's 3:30 PM slot — which needs the studio to confirm it staffs those times.
This is the same choice White Rock made.

`appointment_slots` today, unchanged:

```
0 (Sun): []                                    1 (Mon): []
2-5 (Tue-Fri): 14:00 14:45 15:30 16:15 17:15 18:00 18:45 19:30
6 (Sat):       11:00 11:45 12:30 13:15 14:00 14:45 15:30
```

> If the studio later confirms it will teach 1 PM and 9 PM lessons, widen
> `appointment_slots` **first**, then update the KB and the two prompt nodes to match.

---

## What was fixed

### Defect 1 — the shared knowledge base ✅

Created `knowledge_base_05dfb37d64c00d42` "AM Schaumburg KB" with the same two documents
(`basic_studio_info.md`, `faq.md`) and the same structure as the Global KB — correct name,
address **608 E Golf Rd, Schaumburg, IL 60173**, phone **(847) 882-3700**, intro lesson
**$80**, 45 minutes, and Schaumburg's real hours and break. Studio-neutral parts (dances
offered, what to wear, the no-quoting-packages rule, group classes, the escalation line)
copied verbatim.

Flow v2's `knowledge_base_ids` now points at it alone.

**The Global KB was never edited.** Verified byte-identical by SHA256 after the change;
Lincolnshire still reads it.

### Defect 2 — hardcoded hours in the flow prompts ✅

The hours lived in two nodes, both named **"Get Preferred Time"**
(`node-1773656520723`, `node-1776430637461`), with byte-identical instruction text — three
distinct claims each:

| Claim | Before | After |
|---|---|---|
| Hours answer | `2pm to 9pm on weekdays` / Sat `11am to 5pm` | `2pm to 8:15pm Tuesday through Friday` / Sat `11am to 4:15pm` |
| Slot cadence + break | `2:00pm`, `11:00am`, break `5:45pm to 6:00pm` | `2pm`, `11am`, break `5pm to 5:15pm` |
| Recommend-a-date | `weekdays from 2pm to 9pm, and Saturday from 11am to 5pm` | `Tuesday through Friday from 2pm to 8:15pm, and Saturday from 11am to 4:15pm` |

The break was Lincolnshire's. Schaumburg's real gap is 5:00–5:15 PM (16:15 + 45 min = 17:00,
next slot 17:15).

**`"Tuesday to Saturday"` (6 occurrences) was left alone — it is correct for Schaumburg.**
The closed-day answers ("not available on Sundays/Mondays") were already right, and the
`2pm` example time is bookable on every open day.

### Defect 3 — times spoken as "12:00 PM" ✅

Removed every `:00` spoken time from the prompts and used none in the new KB. Added to the
global prompt's TIMESTAMP RULES:

> When speaking a time that lands on the hour, say it without minutes — "12 PM", not
> "12:00 PM". Never read ":00" aloud. Only include minutes when there are minutes,
> like "8:15 PM".

The `H:MM AM/PM` **extraction** format specs and the `-05:00`/`-06:00` ISO offsets were
left untouched, as specified — they are parsing instructions, never spoken.

### Defect 4 — agent-level Lincolnshire leftovers ✅ (found during this work)

Not in the original scope, same root cause:

- `voicemail_option` said "Arthur Murray Dance Studio in **Lincolnshire**" → now Schaumburg
- `pronunciation_dictionary` carried a Lincolnshire IPA entry → cleared

### Defect 5 — the dialer was pinned to v0 ✅ (found during this work)

`Trigger Retell Outbound Call` in `Wgg5bQTPJYFsDSn8` carried
`"override_agent_version": 0`. Publishing a version had **no effect on outbound calls** —
the pin overrides `latest_published`. This is why v1's transfer fix (published 2026-07-30)
was never actually live.

Moved `0 → 2`. As a result, v1's Transfer Call fix also goes live: transfers now reach
`+18478823700` (Schaumburg) instead of `+18473830704` (Lincolnshire's team leader).

> **Whenever you publish a new version of this agent, bump this pin too**, or the publish
> is a no-op for the callback dialer. The phone binding
> (`+18472609336` → `latest_published`) does follow publishes; the n8n node does not.

---

## Verified after the change

| Check | Result |
|---|---|
| Flow v2 node / tool count | 113 / 12 — unchanged |
| Nodes modified | exactly the 2 "Get Preferred Time" nodes |
| `"Lincolnshire"` anywhere in Schaumburg's flow | 0 |
| Old hours strings (`2pm to 9pm`, `11am to 5pm`, `5:45pm to 6:00pm`) | 0 |
| Spoken `:00` (`2:00pm`, `11:00am`) | 0 |
| `"Tuesday to Saturday"` | 6 — preserved |
| Lincolnshire flow `conversation_flow_433bca831dcb` | untouched: 12 "Lincolnshire", 4 `2pm to 9pm`, 4 `11am to 5pm`, 6 `$80`, still on the Global KB |
| Global KB documents | byte-identical to the pre-change backup (SHA256) |
| Inbound agent `agent_116a6eab4db3287db3a1b0088e` (flow `conversation_flow_c499a7be0d25`) | clean — no KB attached, 0 Lincolnshire strings, 0 wrong-hours strings. Was never affected. |
| `studio_field_options` for Schaumburg | both `AI Called` and `Did Not Answer` present |
| `Trigger Retell Outbound Call` `from_number` | `+18472609336` — Schaumburg's own. The White Rock-number concern in the original draft of this doc was already resolved. |

---

## Still open

- **Test call not made.** Ask about hours *and* price. Schaumburg is paused, so unpausing
  (`voice_agent_enabled = true`) is a prerequisite — that also arms the callback dialer.
- **Rename `knowledge_base_6d01eff4863bb0fd`** from "Global Knowledge Base" to
  "AM Lincolnshire KB". The name is why this went unnoticed — it reads as studio-neutral
  and is not. **The Retell API has no KB-update endpoint** (only create / get / list /
  delete / add-source / delete-source), so this has to be done by hand in the Retell
  dashboard. Deleting and recreating would break Lincolnshire's flow reference — don't.
- **Drop "(Joshua-draft)"** from the agent name when it goes live. Left as-is for now since
  the studio is still paused.
- **Orphaned KB** `knowledge_base_93f3bfbbfd405ef9` ("AMLS Studio FAQ", containing
  "Arthur Murray Lincolnshire FAQ") is attached to no agent. Safe to ignore or delete.
- **`Format Studio Details`** in `Wgg5bQTPJYFsDSn8` derives `studio_hours` from
  `calendar_start_hour`/`calendar_end_hour` (10 and 22), which would render "10 AM to 10 PM"
  — wrong in the same way the old prompts were. Harmless **today** because the flow never
  references `{{studio_hours}}` or `{{open_days}}` (only `{{studio_name}}` and
  `{{intro_offer_price}}`). If anyone wires those variables into a spoken prompt, fix this
  node first. Same latent gap White Rock documented.

---

## Reference — the White Rock precedent

Same defect, fixed first. Useful as a worked example.

| | |
|---|---|
| Agent | `agent_6d0b5e7d413c9817461a0eb347`, published v6 |
| Flow | `conversation_flow_e50547385d12` |
| Its own KB | `knowledge_base_8f45029fcb3d0217` — "AM White Rock KB" |
| Version history | v2 prompt hours · v3 own KB · v6 `:00` pronunciation |

Full write-up: [`white-rock-onboarding.md`](./white-rock-onboarding.md).
