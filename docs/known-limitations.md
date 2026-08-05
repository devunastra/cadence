# AMLS WebApp — Known Limitations & Minor Issues

> Last updated: 2026-05-11

---

## 1. Appointment chip verb tracking (Created / Updated / Deleted)

Appointment activity chips in the Conversations page show a verb (Created, Updated, Rescheduled, Deleted) by matching each chip to our internal `appointment_events` log. The matching works by timestamp proximity — we find the event that occurred closest in time to when the chip message was created.

**Root cause:** GoHighLevel does not include the appointment ID inside the activity message payload itself — it only provides the appointment name and timestamp. Without the ID, the chip verb is determined by finding the nearest `appointment_events` entry in time.

This produces two known edge cases:

1. **Rapid successive actions on the same appointment** — if two actions are taken on the same appointment within ~30 seconds (e.g. create an appointment then immediately mark it as Showed), both chips will match the same earliest event (e.g. both show "Created" instead of "Created" then "Updated"). The matching always returns the earliest candidate in the window, so the second chip never advances to the next event.

2. **Near-simultaneous actions on different appointments** — if two separate appointments for the same contact are acted on within 1 minute of each other, a chip could match the wrong appointment's event.

**In practice these are edge cases because:**
- Contacts typically only have one active appointment at a time
- Consecutive actions on the same appointment within 30 seconds are uncommon
- All underlying appointment data is always accurate — only the chip label in the conversation thread is affected

---

## 2. Email thread row collapse (minor, intermittent)

Occasionally, clicking to collapse an email thread row in the Conversations page does not respond on the first click. The root cause appears to be a timing edge case between React's rendering cycle and the click event — we were unable to reproduce it consistently enough to isolate a fix. It has been partially mitigated with a controlled component pattern and CSS-based hover states.

**Low priority because:**
- The vast majority of conversations at AMLS happen over SMS, not email
- A collapse-all / expand-all toggle button is available in the thread header as a workaround

---

## 3. Display scaling / browser zoom

This dashboard was designed and tested at **Windows display scale 100%**. At that scale, the UI looks exactly as intended at **browser zoom 100%**.

If your machine runs at **Windows display scale 125%** (common on high-DPI laptops), the UI will appear enlarged at browser zoom 100%. To restore the intended look, set your browser zoom to **80%**.

We investigated normalising the layout to compensate for OS-level DPI scaling automatically (so 125% scale + 100% zoom = correct layout) but the effort-to-benefit ratio was not worth it for this project. The workaround above is reliable.

**Affected users:** Anyone on a Windows machine with display scaling above 100% (Settings → Display → Scale).

---

## 4. Contacts in GHL without a Leads profile

The Leads table was seeded from Notion — it only contains leads that were tracked in Notion at the time of migration. GoHighLevel may contain additional contacts (e.g. Bryan Steward, Anne bent) who were added directly in GHL and never existed in Notion.

**Consequences:**
- These contacts will appear in the Conversations page (their messages come from GHL), but they will have **no lead profile** in the Leads table and no side panel data when their conversation is opened.
- They will **not appear** in search results on the Conversations page, since search is performed against the Leads table (Supabase), not GHL directly.
- They will **not appear** in the contact picker when creating a new appointment.

**Workaround:** Manually create a lead entry for the contact in the Leads table (via the "+ New Lead" button). Once a lead record exists with the correct `ghl_contact_id` populated, the contact will behave normally across all pages.

---

## 5. Leads column reorder is desktop-only

Dragging a Leads column header to rearrange columns uses the browser's native HTML5 drag-and-drop, which **does not fire on touch devices**. On a phone or tablet the header simply doesn't drag.

**Why we left it there:** the Leads table scrolls horizontally on mobile, and a long-press-to-drag fallback would fight that scroll gesture for the same finger — a worse trade than not having the feature on a screen that shows two or three columns at a time anyway.

**Workaround:** reorder once on a desktop. The order is saved per user, per studio (`user_preferences.col_order`), so it carries over to that user's phone.

---

## 6. Leads column layout is personal, not shared

Three Leads table settings belong to **you**, not the studio: column **width**, column **order**, and which columns you've **hidden** via the toolbar's Columns picker. Two people in the same studio can have completely different layouts, and changing yours never touches theirs.

The shared thing is the **view** — the tabs above the table. A view defines the column set the studio agreed on; the Columns picker only lets you drop some of those from your own screen. So:

- Hiding a column in the Columns picker → only you stop seeing it.
- Removing a column from a view (hover the tab → pencil icon) → **everyone** stops seeing it.

Hidden columns are tracked per view, so hiding Email in one view doesn't hide it in another. Hiding is also capped: at least one column must stay visible.
