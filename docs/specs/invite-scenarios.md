# Invite Scenarios — Reference

Full request / response / side-effect log for every scenario handled by `app/api/staff/invite/route.ts`. The summary matrix lives in [`client-onboarding-spec.md`](./client-onboarding-spec.md#invite-decision-matrix); this doc is the deep reference used during build.

Labels (a–j) match the scenario log used in conversation and in the route's inline comments.

---

## Scenario inputs

Two axes drive everything:

| Axis | Values |
|---|---|
| **Studio target** | Blank (`studioId` omitted) / Existing studio (`studioId` set) |
| **Invitee email state** | New (no `auth.users` row) / Existing (`auth.users` row found via `findUserByEmail`) |

Plus a tertiary axis for existing users hitting an existing studio:

| Pre-existing `studio_users` row | Branch |
|---|---|
| None | e / f |
| Same role as requested | d |
| Different role | i |

---

## Common request shape

```http
POST /api/staff/invite
Content-Type: application/json

{
  "email": "string",                 // required
  "role": "studio_owner" | "studio_staff" | "super_admin",  // required
  "studioId": "uuid"                 // omit for blank (a/c)
  "confirmRoleChange": true          // only used as second POST in scenario i
}
```

Authority rules (enforced before scenario branching):

- `studio_staff` cannot invite anyone → 403.
- `studio_owner` can only invite into their own studio → 403 otherwise.
- Only `super_admin` may grant `role: super_admin` → 403 otherwise.
- Only `super_admin` may send a blank-studio invite → 403 otherwise.

---

## Scenario a — New email + blank studio (super_admin only)

| | |
|---|---|
| **Preconditions** | Inviter is `super_admin`; `email` is not in `auth.users`; `studioId` omitted; `role` must be `studio_owner`. |
| **Auth.users write** | `auth.admin.generateLink({ type:'invite' })` — creates the user; metadata: `invited_by`, `onboarding_complete:false`, `studio_setup_complete:false`, `role_intent:'studio_owner'`. |
| **DB writes** | None yet. Studio + `studio_users` row are written by `completeStudioOnboarding` after the wizard. |
| **Email sent** | `sendStudioOwnerInvite` (branded Resend). CTA: `{siteUrl}/auth/callback?token_hash=…&type=invite`. |
| **User journey** | Email → /accept-invite (sets password) → /onboarding wizard → studio created → /leads. |
| **Response** | `200 { ok:true }` |

---

## Scenario b — New email + existing studio

| | |
|---|---|
| **Preconditions** | Inviter is `super_admin` or `studio_owner` of `studioId`; `email` is not in `auth.users`; studio exists and not soft-deleted. |
| **Auth.users write** | `auth.admin.generateLink({ type:'invite' })` — creates the user + one-time token (no Supabase email sent); metadata: `invited_by`, `onboarding_complete:false`. (No `role_intent`/`studio_setup_complete:false` → proxy does NOT redirect to /onboarding.) |
| **DB writes** | `studio_users` upsert with `(studio_id, user_id, role)` before the email send so the row is in place by the time they sign in. |
| **Email sent** | `sendCoStaffInvite` (branded Resend). Subject: *"You're invited to {studio} on Cadence"*. CTA: `{siteUrl}/auth/callback?token_hash=…&type=invite`. |
| **User journey** | Email → /accept-invite (sets password) → /leads with the studio in the switcher. |
| **Response** | `200 { ok:true }` (or `200 { ok:true, warning }` if email send failed — membership is kept; super_admin can resend). |

---

## Scenario c — Existing email + blank studio (super_admin only)

| | |
|---|---|
| **Preconditions** | Inviter is `super_admin`; `email` already exists in `auth.users`; `studioId` omitted. |
| **Auth.users write** | `auth.admin.updateUserById` — preserves existing metadata + sets `role_intent:'studio_owner'`, `studio_setup_complete:false`, refreshes `invited_by`. Password NOT reset. |
| **DB writes** | None yet (studio created by wizard). User's existing `studio_users` rows are untouched — they keep their other memberships. |
| **Email sent** | `sendExistingOwnerNewStudioInvite` (branded Resend). CTA: `{siteUrl}/login`. |
| **User journey** | Email → /login → proxy sees `studio_setup_complete:false` → redirects to /onboarding wizard → studio created → /leads. |
| **Response** | `200 { ok:true }` |

> **Why no password step:** account already exists; reusing `/accept-invite` would require resetting their password. The login email respects their existing credentials.

---

## Scenario d — Existing email + existing studio, already a member with the same role

| | |
|---|---|
| **Preconditions** | `auth.users` row exists; `studio_users` row exists with `role === requested role`. |
| **Auth.users write** | None. |
| **DB writes** | None — short-circuit before upsert. |
| **Email sent** | None — would just be noise. |
| **Response** | `200 { ok:true, already:true }` |
| **UI behavior** | Toast: *"Already a member — no change."* Email input cleared, no page reload. |

---

## Scenarios e / f — Existing email + existing studio, no current membership

`e` and `f` are merged because the behavior is identical regardless of whether the invitee has memberships elsewhere.

| | |
|---|---|
| **Preconditions** | `auth.users` row exists; no `studio_users` row for `(studioId, user_id)`. |
| **Auth.users write** | None (account already set up). |
| **DB writes** | `studio_users` upsert with `(studio_id, user_id, role)`. |
| **Email sent** | `sendStudioMembershipNotification` (branded). Subject: *"You've been added to {studio} on Cadence"*. |
| **Response** | `200 { ok:true }` (or `200 { ok:true, warning: '...' }` if the email failed — membership is not rolled back). |
| **User journey** | Next sign-in → studio appears in their switcher. |

---

## Scenario i — Existing email + existing studio, different role from current

Two-step flow because role changes are explicit, never silent. The route returns a conflict on the first POST and only acts after the second.

### First POST (no `confirmRoleChange`)

| | |
|---|---|
| **Preconditions** | `studio_users` row exists with `role !== requested role`. |
| **Side effects** | None. |
| **Response** | `409 { ok:false, requires_role_change_confirmation:true, current_role, new_role, studio_name }` |
| **UI behavior** | Shows `RoleChangeConfirmModal`. *"X is currently {currentRole} in {studio}. Change their role to {newRole}?"* |

### Second POST (`confirmRoleChange: true`)

| | |
|---|---|
| **DB writes** | `UPDATE studio_users SET role = $new WHERE id = $current.id`. |
| **Email sent** | `sendRoleChangedNotification` — subject: *"Your role at {studio} changed"*. |
| **Response** | `200 { ok:true, role_changed: { from, to } }` (or warning variant if email failed). |
| **UI behavior** | Toast *"Role updated to {newRole}."* + reload. |

> **Why explicit:** the previous behavior silently overwrote roles via `upsert(onConflict)` — risky for super_admin → studio_owner drops.

---

## Guardrails

These run before scenario branching and return immediately on failure.

| Code | Check | Status | Body |
|---|---|---|---|
| g | `email` matches inviter's email (case-insensitive) | 400 | `{ error: "You can't invite yourself." }` |
| — | `email` or `role` missing | 400 | `{ error: 'Missing required fields' }` |
| — | `role` not in allowlist | 400 | `{ error: 'Invalid role' }` |
| 1.6 | Non-super_admin + blank studio | 403 | `{ error: 'Only a super admin can invite a new studio owner.' }` |
| 1.7 | Blank studio + role !== studio_owner | 400 | `{ error: 'A new-studio invite must use the Owner role.' }` |
| 2.6/2.7 | studio_staff invites / studio_owner inviting outside their studio | 403 | `{ error: 'Forbidden' }` |
| 2.8 | Granting `super_admin` without being one | 403 | `{ error: 'Forbidden' }` |
| h | Target studio missing or `deleted_at IS NOT NULL` | 400 | `{ error: 'Studio not found.' }` |
| j | `generateLink` / `inviteUserByEmail` returns `email_exists` mid-flight | (no status) | Routes the request through the existing-user branch automatically — no error surfaced. |

---

## Decision tree (pseudo-code)

```
POST /api/staff/invite
├─ auth required → 401
├─ self-invite guard (g) → 400
├─ branch on studioId:
│
├── BLANK (no studioId):
│   ├─ require super_admin (1.6) → 403
│   ├─ require role = studio_owner (1.7) → 400
│   ├─ findUserByEmail(email)
│   │   ├─ exists  → reArmExistingOwnerForOnboarding ⇒ scenario c
│   │   └─ missing → generateLink({type:'invite'}) ⇒ scenario a
│   │       └─ email_exists race (j) → reArm ⇒ c
│
└── ASSIGNED (studioId set):
    ├─ require owner-of-studio OR super_admin (2.6/2.7) → 403
    ├─ require super_admin to grant super_admin (2.8) → 403
    ├─ load studios row (h) → 400 if missing/deleted
    ├─ findUserByEmail(email)
    │   ├─ missing → generateLink({type:'invite'}) + insert studio_users + sendCoStaffInvite ⇒ scenario b
    │   │           email_exists race (j) → re-resolve existing user, fall through
    │   └─ exists  → look up current studio_users row:
    │       ├─ none           → upsert + sendStudioMembershipNotification ⇒ e/f
    │       ├─ same role      → return {ok, already:true} ⇒ scenario d
    │       └─ different role → 409 with confirmation payload ⇒ scenario i (first POST)
    │                            confirmRoleChange:true ⇒ update + sendRoleChangedNotification (second POST)
```

---

## Email summary

| Scenario | Email helper | Subject |
|---|---|---|
| a | `sendStudioOwnerInvite` | *"You're invited to set up your studio on Cadence"* |
| b | `sendCoStaffInvite` | *"You're invited to {studio} on Cadence"* |
| c | `sendExistingOwnerNewStudioInvite` | *"Set up another studio on Cadence"* |
| d | — | (none) |
| e/f | `sendStudioMembershipNotification` | *"You've been added to {studio} on Cadence"* |
| g/h/1.6/2.x | — | (rejected before any send) |
| i | `sendRoleChangedNotification` | *"Your role at {studio} changed"* |
| j | Re-routes to c / d / e / f / i email behavior depending on existing-user state | |

All branded emails share `emailShell()` in `lib/email.ts`. From-address: `RESEND_FROM` (default `Cadence <onboarding@resend.dev>` — until P3 verified domain).

---

## Related files

| File | Role |
|---|---|
| `app/api/staff/invite/route.ts` | All scenario branching |
| `lib/email.ts` | 4 branded Resend templates + shared shell |
| `components/settings/my-staff-table.tsx` | UI: invite form, role-change modal, response handling |
| `app/(auth)/accept-invite/page.tsx` | Password setup (scenarios a, b) |
| `app/(auth)/onboarding/page.tsx` | Wizard (scenarios a, c) |
| `proxy.ts` | Onboarding gate — redirects to /onboarding when `studio_setup_complete:false` |
| `app/actions.ts` → `completeStudioOnboarding` | Studio creation on wizard submit |
