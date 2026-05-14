---
name: spec
description: Produce a structured feature specification with role matrix, edge cases, UI states, and acceptance criteria. Use before implementation to fully specify a feature.
---

# Feature Spec

Produces a structured specification for a feature request. Ensures the feature is fully specified before implementation begins.

## Before You Start

Read these files to understand the project's scope and current state:
- `CLAUDE.md` — project overview, roles, pages, integrations, what's out of scope
- `implementation_plan.md` — full DB schema, API routes, feature breakdown
- `rules/authentication.md` — role definitions, RLS enforcement

## Step 1: Understand the Request

Restate the feature request in your own words. Identify:
- **Who** — which roles use this? (super_admin / studio_owner / studio_staff / all)
- **What** — what's the user-facing behavior?
- **Why** — what value does this provide?
- **Where** — which existing pages/components are affected?

## Step 2: Define the Smallest Shippable Increment

Strip the request to its core user value. Defer extras to "Out of Scope for MVP." Resist scope creep — if the request is actually three features, say so.

## Step 3: Role Matrix

| Action | super_admin | studio_owner | studio_staff |
|--------|-------------|--------------|--------------|
| View X | ... | ... | ... |
| Create X | ... | ... | ... |
| Edit X | ... | ... | ... |
| Delete X | ... | ... | ... |

## Step 4: Edge Case Discovery

Systematically consider each category:

1. **Network** — offline, slow connection, timeout mid-action
2. **Concurrency** — two users editing the same record, Realtime delivering stale data
3. **State** — hard refresh mid-form, deep link to deleted resource, stale filters
4. **Data** — empty states, max limits, special characters, null fields, dates in past
5. **Permissions** — wrong role accessing feature, cross-studio access attempts, RLS silent failures
6. **Browser** — Chrome/Safari/Firefox, mobile viewport, zoom, dark mode + high contrast
7. **Auth/Session** — token expired, signed out in another tab, studio membership revoked
8. **Webhooks** — double delivery, missing studio mapping, unexpected payload fields

Each edge case gets defined behavior or is marked "out of scope for MVP."

## Step 5: Specify UI States

| View / Component | Loading | Empty | Error | Success |
|------------------|---------|-------|-------|---------|
| ... | skeleton | message | toast + retry | renders |

## Step 6: Specify Affected Layers

- **DB:** new tables / columns / migrations
- **RLS:** policy changes, studio_id scoping
- **Server actions:** which actions in `app/actions.ts`
- **API routes:** webhook handlers or external calls
- **Components:** views/modals touched
- **Realtime:** subscriptions needed (and whether Realtime is actually necessary vs refetch-on-action)
- **Preferences:** filter/sort persistence in `user_preferences`
- **Activity logs:** which mutations need audit trail entries
- **Enum options:** new `studio_field_options` entries, or hardcoded values

## Step 7: Specify Filters (if applicable)

| Field | Filter Type | Default | Persisted? |
|-------|-------------|---------|------------|
| ... | multi-select / date range / text | ... | Yes/No |

## Step 8: Specify Realtime Behavior (if applicable)

- **Needs Realtime?** Yes / No — and why
- **What triggers updates?** webhook / another user / background process
- **What does the user see?** silent update / toast / badge increment
- **Subscription scope:** `studio_id` filter on which table

## Step 9: Data Migration (if applicable)

- **Existing records:** default value or null?
- **Backfill needed?** Yes / No
- **UI for unbackfilled records:** what shows for null values?

## Step 10: Spec Validation Checklist

- [ ] User flows documented (all three roles)
- [ ] Edge cases identified across 8 categories
- [ ] UI states specified (loading, empty, error, success)
- [ ] Backend requirements clear
- [ ] Cross-studio isolation addressed
- [ ] Acceptance criteria testable
- [ ] Dark mode in scope (CSS custom properties)
- [ ] Integration impact assessed (GHL/Retell)
- [ ] Activity log coverage specified
- [ ] Enum option decision made (customizable vs hardcoded)
- [ ] Realtime behavior specified
- [ ] Data migration/backfill scoped (if adding columns)
- [ ] Filter persistence considered

If any box is unchecked, surface it as an **Open Question**.

## Output Format

```markdown
## Spec: <Feature Name>

### Summary
<1-2 sentences>

### Users
| Role | What they see | What they can do |
|------|---------------|------------------|
| super_admin | ... | ... |
| studio_owner | ... | ... |
| studio_staff | ... | ... |

### Acceptance Criteria
- [ ] <testable criterion>

### UI States
<table from Step 5>

### Edge Cases
| # | Category | Scenario | Expected Behavior | Severity |
|---|----------|----------|-------------------|----------|

### Affected Layers
<from Step 6>

### Dependencies
- Depends on: ...
- Blocks: ...

### Out of Scope (MVP)
- <deferred item — why>

### Spec Validation
<checklist with MISSING items flagged>

### Open Questions
1. <question needing user decision>

### Recommended Next Step
→ `code-architect` for implementation plan → `senior-software-engineer` to build → `qa-tester` for test plan
```
