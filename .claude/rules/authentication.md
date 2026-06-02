# Authentication Rules — AMLS WebApp

## Auth Provider

Supabase Auth — email + password only. No OAuth, no magic links, no public signup.
Accounts are created by a `super_admin` only.

**Invite scenarios:** the `/api/staff/invite` route handles 10 scenarios (new vs existing email × blank vs existing studio × role state). Full reference with request/response shapes, DB writes, email per scenario, and decision tree: [`docs/specs/invite-scenarios.md`](../../docs/specs/invite-scenarios.md). **Read it before touching the invite route, the My Staff UI, or the `/accept-invite` and `/onboarding` flows.**

---

## Roles

| Role | Who | Permissions |
|------|-----|-------------|
| `super_admin` | Developers / Agency (Myrrh) | Everything. Bypasses RLS. Creates studios and accounts. **Only role that can delete a studio.** |
| `studio_owner` | Dance studio owners | Full access to their studios. Invite/manage staff (including removing co-owners — with a UI warning). Cannot delete studios. Inherits staff permissions. |
| `studio_staff` | Front desk, coaches | Edit leads, view analytics + calendar, use unibox. My Profile only in Settings. |

Role is stored in the `studio_users` table (`role` column) per studio — a user can have different roles in different studios.

---

## Destructive Actions

Locked behavior for the routes / UI surfaces that destroy data:

| Action | Who can trigger it | Server enforcement | UI surface |
|---|---|---|---|
| **Delete studio** (soft) | super_admin only | `app/actions.ts` `deleteStudio` throws Forbidden for non-super_admins | Trash icon in `Settings → Studios` hidden for non-super_admin (`StudiosForm` gates the column on `isSuperAdmin` prop) |
| **Remove staff from a studio** | super_admin or studio_owner of that studio | `app/api/staff/remove/route.ts` — checks requester's `studio_users` row, blocks non-super_admin from removing a super_admin | `My Staff` row trash icon. Hidden for self and for super_admin targets. Modal shows a stronger warning when the target is a `studio_owner` (title flips to "Remove a co-owner?") |
| **Change role** | super_admin globally; studio_owner on their own studio | `app/api/staff/update-role/route.ts` — service client for target lookup so RLS doesn't 404 super_admins on studios they're not in | Inline dropdown in `My Staff`. Triggers `sendRoleChangedNotification` email to the affected user. |
| **Auto-delete auth account on last-membership removal** | **Removed 2026-06-01.** Was too aggressive — one mis-click destroyed a real user's account with no Supabase-side recovery. Orphans now land on `/no-access` (a logged-in route in the `(auth)` group) with a sign-out button. Re-granting access is just an `INSERT` into `studio_users`. | n/a | `/no-access` page |

**The principle:** destructive actions on shared data (studios, multi-owner setups) escalate to super_admin. Self-service destruction stays for narrow cases (a user signing themselves out, an owner removing a staffer from their own studio). Auth accounts are never auto-purged.

---

## Row-Level Security (RLS)

**RLS is enforced at the database level — not in application code.**

- Every table has a `studio_id` column
- RLS policies ensure users only see rows where `studio_id` matches their assigned studios in `studio_users`
- The `super_admin` role bypasses RLS

**Before each phase goes live:** Run an RLS audit. Test:
- Can `studio_staff` read another studio's leads? (Must fail)
- Can `studio_staff` update Business Profile in Settings? (Must fail)
- Can `studio_owner` see all their own studio's data? (Must pass)

---

## Session Handling

- Supabase SSR client (`lib/supabase/server.ts`) reads session from cookies in server components and API routes
- Supabase browser client (`lib/supabase/client.ts`) manages session in client components
- Proxy (`proxy.ts`) protects all `(app)` routes — redirects unauthenticated users to `/login`

---

## Studio Context

- Users can belong to multiple studios
- The currently active studio is tracked in the sidebar studio switcher
- All queries are scoped to the active `studio_id`
- Studio membership and role stored in `studio_users` table

---

## Rate Limits

Enforced in `lib/rate-limit.ts`:

| Endpoint | Limit |
|----------|-------|
| Login | 10 attempts / 15 min per IP |
| Send message | 100 messages / hour per user |
| GHL Calendar API | 5-min server-side cache |
| General routes | 100 req / min per user |
