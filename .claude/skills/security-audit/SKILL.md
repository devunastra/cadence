---
name: security-audit
description: Run a structured security audit — OWASP Web Top 10 + RLS + webhook validation + multi-tenant isolation. Use before releases, when touching RLS policies, or when reviewing auth/role changes.
---

# Security Audit

Structured security audit for the AMLS WebApp. Covers OWASP Web Top 10, Supabase RLS, webhook validation, multi-tenant isolation, and server-side enforcement.

## Before You Start

Read these files to understand the security model:
- `CLAUDE.md` — security requirements (non-negotiable), roles, integration patterns
- `rules/authentication.md` — role definitions, RLS enforcement, session handling, rate limits
- `rules/architecture.md` — server vs client boundaries, API route rules, env var conventions

## Step 1: Confirm Scope

Ask the user which audit scope they want:

| Scope | What it covers |
|-------|----------------|
| **Full** | All steps below, all tables, all routes |
| **Targeted** | Specific area (e.g., "just RLS for leads", "just webhook handlers") |
| **Pre-release** | All steps with extra attention to recent changes (`git log --oneline -20`) |

## Step 2: Secret Scanning

Search for hardcoded secrets and misplaced env vars:

```bash
# Server-only secrets that must NOT be NEXT_PUBLIC_
grep -r "SUPABASE_SERVICE_ROLE_KEY\|GHL_API_KEY\|RETELL_WEBHOOK_SECRET\|GHL_WEBHOOK_SECRET" --include="*.ts" --include="*.tsx" -l

# Check for NEXT_PUBLIC_ on server-only vars
grep -r "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE\|NEXT_PUBLIC_GHL\|NEXT_PUBLIC_RETELL" --include="*.ts" --include="*.tsx" -l

# Check .gitignore covers secrets
cat .gitignore | grep -E "\.env|\.mcp\.json"
```

**Expected:** Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` should be public. `.env*` and `.mcp.json` should be gitignored.

## Step 3: RLS Policy Completeness

For every table in the database, verify:

- [ ] SELECT policy exists with `studio_id` scoping
- [ ] INSERT policy exists with `studio_id` scoping
- [ ] UPDATE policy exists with `studio_id` scoping
- [ ] DELETE policy exists with `studio_id` scoping
- [ ] super_admin bypass is intentional
- [ ] studio_owner and studio_staff check `studio_users` membership
- [ ] No cross-studio data leakage via Realtime subscriptions

```bash
# Find all CREATE POLICY statements
grep -r "CREATE POLICY" --include="*.sql" -n

# Check for tables without policies
# Cross-reference against implementation_plan.md table list
```

**Key tables to verify:** `leads`, `studio_field_options`, `lead_views`, `activity_logs`, `calls`, `appointments`, `conversations`, `messages`, `appointment_events`, `studios`, `studio_users`, `user_preferences`

## Step 4: Role Enforcement

Verify role checks exist at both layers (defense in depth):

```bash
# UI role gates in components
grep -r "role\|studio_owner\|studio_staff\|super_admin" --include="*.tsx" -l

# Server action authorization
grep -r "studio_id\|studio_users" app/actions.ts -n
```

- [ ] Every server action that mutates data checks user's studio membership
- [ ] UI gates match RLS policies (hiding a button is not security, but it should still happen)
- [ ] Proxy (`proxy.ts`) redirects unauthenticated users to `/login`

## Step 5: Webhook Security

Check every handler in `app/api/webhooks/`:

| Handler | Secret Header | Idempotent Upsert | Studio Mapping |
|---------|--------------|-------------------|----------------|
| `ghl-contact` | [ ] | [ ] on `ghl_contact_id` | [ ] |
| `ghl-message` | [ ] | [ ] | [ ] |
| `ghl-appointment` | [ ] | [ ] on GHL appointment ID | [ ] |
| `retell-call` | [ ] | [ ] | [ ] |

```bash
# Check for secret validation in webhook handlers
grep -r "WEBHOOK_SECRET\|secret\|authorization" app/api/webhooks/ --include="*.ts" -n
```

## Step 6: Server-Side Enforcement

- [ ] GHL/Retell API calls only in `app/api/` routes — never in `components/` or `app/actions.ts`
- [ ] No `import.*ghl\|import.*retell` in client components

```bash
# Check for external API calls in client code
grep -r "ghl\|retell\|GoHighLevel" components/ --include="*.tsx" --include="*.ts" -l
grep -r "ghl\|retell\|GoHighLevel" app/actions.ts -n
```

## Step 7: API Route Authentication

Check non-webhook API routes for auth:

```bash
# List all API routes
find app/api -name "route.ts" -not -path "*/webhooks/*"
```

- [ ] Every non-webhook API route checks the user's Supabase session
- [ ] Routes returning studio-scoped data verify studio membership
- [ ] Admin-only routes (staff management) check role

## Step 8: Client Bundle Audit

```bash
# Build and check for leaked secrets
npm run build 2>&1 | tail -5
grep -r "SUPABASE_SERVICE_ROLE_KEY\|GHL_API_KEY\|RETELL_WEBHOOK_SECRET\|GHL_WEBHOOK_SECRET" .next/ --include="*.js" -l 2>/dev/null
```

## Step 9: Input Handling

- [ ] Supabase queries use parameterized methods (`.eq()`, `.in()`) — no raw SQL in app code
- [ ] No `dangerouslySetInnerHTML` without sanitization
- [ ] Webhook payloads validated before DB insertion

```bash
# Check for raw SQL or dangerous patterns
grep -r "dangerouslySetInnerHTML\|\.rpc(" --include="*.ts" --include="*.tsx" -n
grep -r "raw\|exec\|query(" --include="*.ts" -l
```

## Step 10: Rate Limiting and Dependencies

```bash
# Rate limits
cat lib/rate-limit.ts

# Dependency audit
npm audit --production
npm outdated --long
```

- [ ] Login: 10 attempts / 15 min per IP
- [ ] Send message: 100 messages / hour per user
- [ ] General routes: 100 req / min per user
- [ ] No critical CVEs in production dependencies

## Output Format

```markdown
## Security Audit Report

### Scope
<Full / Targeted (area) / Pre-release>

### Executive Summary
<1-2 sentences: overall posture, critical finding count>

### Findings

#### Critical
| # | OWASP | Location | Issue | Impact | Remediation |
|---|-------|----------|-------|--------|-------------|

#### High
| # | OWASP | Location | Issue | Impact | Remediation |
|---|-------|----------|-------|--------|-------------|

#### Medium / Low
| # | OWASP | Location | Issue | Impact | Remediation |
|---|-------|----------|-------|--------|-------------|

_(Omit empty sections)_

### Clean Areas
- <What was checked and passed>

### Recommendations (prioritized)
1. <most urgent>
2. <next>

### Commands Run
- <list of commands executed during audit>
```

## OWASP Quick Reference

| Code | Category | What to check in AMLS |
|------|----------|----------------------|
| A01 | Broken Access Control | RLS gaps, cross-studio leaks, role bypass |
| A02 | Cryptographic Failures | Secrets in client code |
| A03 | Injection | Raw SQL, XSS |
| A04 | Insecure Design | UI-only gates, missing webhook validation |
| A05 | Security Misconfiguration | Env vars, missing rate limits |
| A06 | Vulnerable Components | npm audit findings |
| A07 | Auth Failures | Session bugs, token expiry |
| A08 | Integrity Failures | Webhook tampering |
| A09 | Logging Failures | Missing activity logs |
| A10 | SSRF | Server-side requests to user-controlled URLs |
