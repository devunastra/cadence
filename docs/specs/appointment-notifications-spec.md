# Spec: Appointment Booked Notifications

In-app notification when an appointment is booked — surfaced via a bell + popover in a new sticky top header (and optionally a toast). No email in v1.

---

## Decision: build in the codebase

Considered three surfaces. Verdict: build in the Next.js app.

| Surface | Verdict | Reason |
|---|---|---|
| **GHL native notifications** | ✗ Wrong audience | GHL's `toNotify: true` notifies the **contact** (customer), not the studio team. Different problem. |
| **n8n workflow** | ✗ Wrong layer | Tightly coupled to product UX (per-user opt-in, in-app bell, deep link into calendar). Memory flags that n8n MCP "has a narrow view" of workflows — fragile maintenance surface. |
| **In codebase** | ✓ | All primitives already exist: Resend (deferred), toast provider, `user_preferences` notification toggle pattern, Realtime channels. GHL appointment webhook is the natural single trigger. |

---

## Trigger point: the GHL appointment webhook

`app/api/webhooks/ghl-appointment/route.ts` is the **single convergence point** for every appointment creation path:

| Booking source | Path |
|---|---|
| AI agent (Retell) | Retell tool call → GHL → webhook fires → we notify |
| GHL UI direct | GHL → webhook fires → we notify |
| Our calendar UI | `createAppointment` action → GHL → webhook fires back → we notify |

Notifying from the webhook (filtered to `'Created'` verb) catches every path with no duplication and no source-specific code.

**Idempotency:** GHL retries `AppointmentCreate` on delivery failures, and our own `createAppointment` causes GHL to fire the webhook back. Guarded by `appointments.notified_at` — set on first dispatch, skip if non-null.

**v1 scope:** Only `'Created'`. Reschedule/cancel/status-change notifications are out of scope but trivial to add later via the `type` column.

---

## Surfaces

### 1. Bell + popover (primary)

Lives in a new sticky top header, present on every authenticated route.

- **Header:** ~48px tall, `sticky top-0 z-30`, `bg: var(--color-bg)`, `borderBottom: 1px solid var(--color-border)`, no shadow. Sits **to the right of the sidebar** (sidebar stays full-height on the left), spans only the main content column. Added in `components/app-shell.tsx` above `<main>`. Page heading top padding tightened from `pt-5 md:pt-10` to `pt-5` everywhere to compensate (rule updated in `rules/ui-styling.md`).
- **Bell:** Lucide `Bell` `size={20}`, right-aligned in the header. Red unread dot with count, "9+" cap.
- **Popover:** ~360px wide, anchored under the bell, right-edge aligned. List of notifications, most recent first. Unread rows get a subtle accent dot or background tint. Footer: "Mark all as read". Empty state: "No notifications yet". Close on outside click or Esc.
- **Row click:** marks read, navigates to the `link` (e.g. `/calendar?appointmentId=...`).
- **Mobile:** bell slot lives in the existing mobile hamburger header (`app-shell.tsx`), to the right of the studio name.

### 2. Toast (optional, per-user)

Re-uses `useToast().showSuccess(...)` from `components/ui/toast-provider.tsx`. Fires on the Realtime `INSERT` only when `notify_appointment_toast` pref is true. Default on, easy to turn off for users who keep the calendar open all day.

### 3. Email — deferred

Not in v1.

---

## Data model

### Migration `047_notifications.sql` (done)

```sql
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id   uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL,         -- 'appointment_booked' for v1
  title       text NOT NULL,
  body        text,
  link        text,
  metadata    jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**One row per recipient.** If three users in a studio have opted in, the webhook writes three rows. Read state is per-user automatically.

**RLS:** users `SELECT/UPDATE/DELETE` their own rows only. No `INSERT` policy — inserts come from server-side writes (service role) only.

**Indexes:** `(user_id, created_at DESC) WHERE read_at IS NULL` for the unread badge query; `(user_id, created_at DESC)` for the popover list.

**Realtime:** added to `supabase_realtime` publication.

### `user_preferences` additions (done)

Two booleans, default `true`, matching the existing `notify_lead_*` pattern:

- `notify_appointment_created` — controls whether the webhook writes a row for this user
- `notify_appointment_toast` — controls whether the bell component fires a toast on Realtime INSERT

### `appointments.notified_at timestamptz` (done)

Idempotency guard. `null` initially. Set on first notification dispatch. Webhook skips dispatch if non-null.

---

## Server actions (done)

In `app/actions.ts`:

| Function | Purpose |
|---|---|
| `getNotifications(studioId, { limit, unreadOnly })` | List for popover |
| `getUnreadNotificationCount(studioId)` | Badge count |
| `markNotificationRead(id)` | Single row |
| `markAllNotificationsRead(studioId)` | Footer button |
| `getUserPreferences(studioId)` | Extended to return the two new toggles |
| `saveNotificationPreferences(prefs)` | Signature changed to object form for extensibility |

Type added: `Notification` in `lib/types.ts`.

---

## Audience routing (v1)

Two audiences, unioned:

1. **All opted-in `studio_users` for the studio** — anyone with a `studio_users` row for the studio where `notify_appointment_created = true`.
2. **All `super_admin` users — across every booking, every studio.** A super_admin gets a notification even for studios they're not a member of. Lunastra/Myrrh need a platform-wide view of activity. This is the role's purpose.

A user is "super_admin" when they have at least one `studio_users` row with `role = 'super_admin'` (same definition used by `app/(app)/layout.tsx` and `data-cache`).

**De-dup:** if a super_admin is also a regular member of the studio (e.g., a dev added themselves as `studio_owner` for testing), they get exactly one notification, not two. The webhook collects the union of both audiences and inserts one row per distinct `user_id`.

**Pref handling for super_admins on studios they're not members of:** they have no `user_preferences` row for those studios — so the audience query treats missing prefs as opted-in (matches the column default `true`). v1 does **not** give super_admins a way to opt out of cross-studio notifications. Acceptable because the super_admin audience is 1–2 people who want this visibility. A global super_admin mute toggle is a follow-up.

**Cross-studio deep links (super_admin limitation):** notification `link` is `/calendar?appointmentId=...`. The calendar page reads `selected_studio_id` from cookies, so if a super_admin clicks a notification for studio B while currently switched to studio A, the calendar will load A's data and the appointmentId won't match. v1 accepts this — super_admin manually switches studios first. Follow-up: encode `studio_id` in the link and have the calendar page auto-switch.

**Per-assignee routing:** out of scope. The `appointments.assigned_user_id` field holds a GHL user ID string with no mapping to a Supabase auth user.

---

## Build order

| # | Task | Files | Status |
|---|---|---|---|
| 1 | Migration | `supabase/migrations/047_notifications.sql` | ✅ Done |
| 2 | Types + server actions | `lib/types.ts`, `app/actions.ts` | ✅ Done |
| 3 | Sticky top header | `components/app-shell.tsx` | ⏳ Next |
| 4 | Bell + popover component | `components/notifications/notification-bell.tsx` (new) | ⏳ |
| 5 | Realtime + toast | inside the bell component | ⏳ |
| 6 | Webhook insert | `app/api/webhooks/ghl-appointment/route.ts` | ⏳ |
| 7 | My Profile toggle UI | `components/settings/my-profile-form.tsx` | ⏳ |
| 8 | QA pass | — | ⏳ |

---

## QA matrix

| Scenario | Expected |
|---|---|
| Book appointment via our calendar UI | One notification row per opted-in user; **not two** |
| Book appointment in GHL UI directly | Notification fires |
| Simulate Retell-booked appointment (POST `AppointmentCreate` payload) | Notification fires |
| Replay the same payload (GHL retry) | No duplicate (idempotent via `notified_at`) |
| User has `notify_appointment_created = false` | No row created for them |
| User has `notify_appointment_toast = false` | Bell row appears, no toast |
| Super_admin not a member of the booking studio | Receives notification anyway |
| User is both super_admin and a regular member of the studio | Receives exactly one notification (de-duped) |
| Reschedule, cancel, status change | No notification (out of scope for v1) |
| Cross-device: mark read on laptop | Phone bell badge updates within seconds (Realtime) |
| Dark mode | Bell, popover, badge all use tokens, not hardcoded colors |
| Mobile | Bell visible in hamburger header, popover fits viewport |
| RLS | User A cannot SELECT user B's notifications even with raw query |

---

## Out of scope (v1)

- Email notifications (deferred — Resend infra is ready when we want it)
- Browser push (would require service worker)
- Per-assignee routing (requires GHL user ID → Supabase user mapping)
- Reschedule / cancel / status-change notifications (add later via new `type` values)
- Notification preferences for other event types (lead assigned, missed call, etc.)
- Notification grouping ("3 appointments booked")
- Notification archive / delete UI
- Super_admin global mute toggle (always-on in v1)
- Studio auto-switch on super_admin cross-studio notification link click

---

## Edge cases & gotchas surfaced during research

1. **Double-fire from our own UI:** the calendar UI's `createAppointment` writes to GHL first, GHL then fires the webhook back. Both paths converge on the webhook — only the webhook notifies, the server action does not. `notified_at` guards GHL retries against the same payload.

2. **No `source`/`bookedBy` in GHL payload:** can't distinguish AI-booked vs human-booked at the webhook layer reliably. Best inferable signal is `assigned_user_name` — if it matches the Retell AI agent's GHL user name, treat as AI-booked. Pure copy tweak in title/body, no schema change.

3. **Reschedule verb collision:** the webhook treats `AppointmentReschedule` and `AppointmentUpdate` the same (both emit `'Updated'`). Both are excluded from v1 notifications. CLAUDE.md mentions a `'Rescheduled'` verb but it's not actually distinguished today.

4. **Calendar shell already subscribes to `appointments`:** unrelated to this work, but worth noting — a toast there would duplicate the bell toast. We notify from the **notifications** subscription, not the appointments one.

5. **Realtime fan-out load:** at peak booking rates this is well under any concerning threshold. Studios book single-digit appointments per hour.
