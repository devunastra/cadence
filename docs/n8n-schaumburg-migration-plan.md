# Schaumburg "Email → Notion" — Make.com → n8n Migration Plan

> **Status:** Scoping complete. Email + storage decisions confirmed (2026-05-28). Trigger/parse buildable now; GHL + welcome-email steps still blocked on access.
> **Source scenario:** "SCHAUMBURG Email to Notion (Mailhook)" (Make.com, zone us1)
> **Last updated:** 2026-05-28

**Confirmed decisions:**
- **Email = Option B** — inquiries forward from `info@amschaumburg.com` → `dev@lunastra.ai` (our inbox); n8n reads that. Receives the forwarded copy, so the body matches the existing regex format.
- **Notion = dropped** — lead records go to our app's Supabase `leads` table instead.
- **Still pending:** GHL API access, welcome-email send account, and the Supabase-write-vs-GHL-webhook fork.

---

## 1. Goal

Rebuild the Arthur Murray Schaumburg lead-intake automation in **n8n**, replacing the current Make.com scenario. Where it makes sense, route lead records into our own app (Supabase) instead of Notion.

---

## 2. What the current workflow does (11 modules)

Linear flow, triggered by an inbound inquiry email:

1. **Mailhook trigger** — receives the inquiry email (forwarded from `info@amschaumburg.com`).
2–5. **Regex parsers** — extract Full Name, First Name, Email (required — stops if missing), Phone.
6. **OpenAI (o4-mini)** — extract the inquiry reason/message text.
7. **OpenAI (gpt-4o-mini)** — normalize phone to digits only.
8. **Notion search** — look for an existing record by **Email OR Phone** (dedup).
9. **Notion create page** — create the lead **only if the search returned zero matches**.
10. **Microsoft/Outlook send** — send the lead a welcome email.
11. **GHL create contact** — add the contact (with the reason in a custom field).

**Core logic:** the welcome email + GHL contact only fire for **new** leads (the create step is gated behind the dedup check). Returning inquiries are skipped.

---

## 3. Trigger / email flow

```
Website inquiry form
   → email lands in  info@amschaumburg.com   (Microsoft 365 inbox)
   → auto-forward rule  → Make.com mailhook address
   → triggers the automation
```

*Unconfirmed:* exact forward setup + the original (non-forwarded) email body format. Both need verifying before build.

---

## 4. Integrations & access requirements

| Item | Needed for | Provided by | Specifics | Conditional |
|------|-----------|-------------|-----------|-------------|
| Email access | n8n trigger | Studio | **Option A:** read-only OAuth to `info@amschaumburg.com`; **Option B:** forward inquiries to an inbox we control | email decision |
| GHL API | Create contact | Studio | API key / Private Integration token + Schaumburg Location ID + confirm "Reason" custom field (`KMpbP5JuOzb1zvoXNdIe`) | — |
| Microsoft send | Welcome email | Studio | OAuth w/ Mail.Send (likely same `info@` account) | — |
| Notion token | Dedup + create | Studio | Integration token shared with DB `14a71c37-5730-80df-ab57-eabb597f5775` | only if Notion stays |
| Notion export | One-time migration | Studio | Export of existing lead records | only if moving to Supabase |
| OpenAI key | Reason extraction | **Us (agency)** | API key | — |
| Supabase access | Write leads to our app | **Us (we own)** | Scoped write + Schaumburg `studio_id` | only if writing Supabase directly |
| n8n instance | Host workflow | **Us** | — | — |

---

## 5. Key decisions (forks)

1. **Email: Option A (their mailbox) vs Option B (forward to our inbox)** — sets the trigger node.
2. **Notion vs Supabase** — sets the "store the lead" section. Since our app replaces Notion, the likely direction is: one-time migrate existing Notion records → `leads` table, then insert future inquiries there.
   - Sub-note: our app already has a `ghl-contact` webhook (`app/api/webhooks/ghl-contact/route.ts`) that upserts a lead into Supabase on GHL contact create (deduped by `ghl_contact_id`) — but it carries only name/phone/email/source, **not the reason**. So writing to Supabase directly from n8n is likely cleaner if we want the inquiry message stored.

---

## 6. Target n8n design (node-by-node)

```
[Trigger]  Outlook/IMAP — read inquiry emails, filter to inquiries only
   ↓
[Code]  Parse Name / Email / Phone / Message from the body
   ↓
[IF]  Email present?  ── no ──▶ stop
   ↓ yes
[OpenAI]  Extract reason     +     [Code]  Format phone → digits
   ↓
[Query]  Existing lead by email OR phone?
   ↓
[IF]  New lead?  ── no ──▶ stop
   ↓ yes
[Create lead]    → Supabase leads table (or Notion)
[Send email]     → Microsoft Outlook (welcome email)
[Create contact] → GoHighLevel (with Reason custom field)
```

- Set **"Continue On Fail"** on the create nodes (mirrors Make's "Ignore" handlers).
- Field mapping confirmed against the app's `leads` schema + `studio_field_options` at build time.

---

## 7. Risks & open confirmations

- **Parser body format (highest risk):** Make's regexes were tuned to the *forwarded* email. n8n via IMAP reads the *original* — body may differ. Test against a real sample first.
- Confirm originals actually rest in `info@`'s inbox (vs. a server-side redirect that keeps no copy).
- Confirm the forward rule's **condition** (which emails it forwards) → becomes the n8n trigger filter.
- Confirm whether the welcome-email send account is the same mailbox as the trigger.
- Confirm whether AMLS Schaumburg's GHL already fires the app's `ghl-contact` webhook.
- Notion schema may have drifted (app is replacing Notion).

---

## 8. Sequencing

**Can start now (no client dependency):**
- Stand up the n8n workflow skeleton.
- Build + test the parse + phone-format nodes — needs **one raw sample of the original inquiry email**.

**Blocked on client:**
- Trigger config (email Option A/B), store-the-lead section (Notion vs Supabase), GHL + Notion credentials, welcome-email account.

**Final:**
- Parallel-run n8n alongside Make (easy under Option B), compare outputs, cut over, disable Make.
- One-time Notion → Supabase data migration (if Supabase).

---

## 9. Status / next steps

- Client access/scope request sent (email option, GHL, Notion).
- Waiting on: email access decision + Notion-vs-Supabase direction.
- No-regret move now: obtain a raw sample of an original inquiry email to de-risk the parser.
