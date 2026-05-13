# Authentication Rules — AMLS WebApp

## Auth Provider

Supabase Auth — email + password only. No OAuth, no magic links, no public signup.
Accounts are created by a `super_admin` only.

---

## Roles

| Role | Who | Permissions |
|------|-----|-------------|
| `super_admin` | Developers / Agency (Myrrh) | Everything. Bypasses RLS. Creates studios and accounts. |
| `studio_owner` | Dance studio owners | Full access to their studios. Invite/manage staff. Inherits staff permissions. |
| `studio_staff` | Front desk, coaches | Edit leads, view analytics + calendar, use unibox. My Profile only in Settings. |

Role is stored in the `studio_users` table (`role` column) per studio — a user can have different roles in different studios.

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
