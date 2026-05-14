---
name: pre-release
description: Pre-deployment checklist — build verification, security scan, dark mode check, RLS audit, dependency review, and migration readiness. Run before deploying to Netlify.
---

# Pre-Release Checklist

Run this before deploying to Netlify. Covers build health, security, visual consistency, and deployment readiness.

## Step 1: Build Verification

```bash
npm run build
```

- [ ] Build completes with zero errors
- [ ] No TypeScript `any` suppressions added in recent commits
- [ ] No `@ts-ignore` added in recent commits

```bash
# Check for recent suppressions
git diff main...HEAD | grep -E "@ts-ignore|: any[^_]" || echo "None found"
```

## Step 2: Git Status

```bash
git status
git log --oneline -10
```

- [ ] No uncommitted changes
- [ ] No untracked files that should be committed
- [ ] `.env*` and `.mcp.json` are NOT staged

## Step 3: Secret Scan

```bash
# Server-only secrets must not be NEXT_PUBLIC_
grep -r "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE\|NEXT_PUBLIC_GHL\|NEXT_PUBLIC_RETELL" --include="*.ts" --include="*.tsx" -l

# Check build output for leaked secrets
grep -r "SUPABASE_SERVICE_ROLE_KEY\|GHL_API_KEY\|RETELL_WEBHOOK_SECRET\|GHL_WEBHOOK_SECRET" .next/ --include="*.js" -l 2>/dev/null
```

- [ ] No server-only secrets in client code
- [ ] No secrets in build output
- [ ] `.env*` in `.gitignore`
- [ ] `.mcp.json` in `.gitignore`

## Step 4: Dependency Check

```bash
npm audit --production
npm outdated --long
```

- [ ] No critical CVEs in production dependencies
- [ ] Critical packages (`@supabase/supabase-js`, `next`, `react`) are current or have known-acceptable versions

## Step 5: RLS Quick Check

```bash
# Verify all tables have policies
grep -r "CREATE POLICY" --include="*.sql" -l | wc -l
grep -r "ENABLE ROW LEVEL SECURITY" --include="*.sql" -l | wc -l
```

- [ ] Every table with user data has RLS enabled
- [ ] Recent migrations include policies for any new tables/columns

## Step 6: Webhook Handlers

```bash
# Verify secret validation exists in all webhook handlers
for handler in app/api/webhooks/*/route.ts; do
  echo "=== $handler ==="
  grep -n "secret\|WEBHOOK_SECRET\|authorization" "$handler" || echo "WARNING: No secret validation found"
done
```

- [ ] All four webhook handlers validate shared secrets
- [ ] No new webhook handlers added without secret validation

## Step 7: Dark Mode Spot Check

```bash
# Check for hardcoded hex values in recent changes
git diff main...HEAD --include="*.tsx" --include="*.ts" | grep -E "#[0-9a-fA-F]{3,8}" || echo "None found"

# Check for dark: Tailwind color variants (should use CSS tokens)
git diff main...HEAD | grep -E "dark:(text|bg|border)-" || echo "None found"
```

- [ ] No new hardcoded hex values in components
- [ ] No new `dark:` Tailwind color variants (CSS custom properties handle dark mode)

## Step 8: Rate Limiting

- [ ] Login endpoint: 10 attempts / 15 min per IP
- [ ] Send message: 100 messages / hour per user
- [ ] General routes: 100 req / min per user

```bash
cat lib/rate-limit.ts
```

## Step 9: Netlify Deployment Readiness

- [ ] `netlify.toml` or Netlify plugin config is present and correct
- [ ] `@netlify/plugin-nextjs` is in dependencies
- [ ] Environment variables are set in Netlify dashboard (not just local `.env`)

## Output

```markdown
## Pre-Release Report

### Build
- [PASS/FAIL] `npm run build`
- [PASS/FAIL] No TypeScript suppressions

### Security
- [PASS/FAIL] No secrets in client code
- [PASS/FAIL] No secrets in build output
- [PASS/FAIL] npm audit clean
- [PASS/FAIL] RLS policies present for all tables
- [PASS/FAIL] Webhook handlers validate secrets

### Visual
- [PASS/FAIL] No hardcoded hex values
- [PASS/FAIL] No dark: color variants

### Deployment
- [PASS/FAIL] Git clean
- [PASS/FAIL] Netlify config present
- [PASS/FAIL] Rate limits in place

### Blockers
<List any FAIL items that must be fixed before deploy>

### Warnings
<Non-blocking items to address soon>

### Ready to Deploy?
YES / NO — <reason if no>
```
