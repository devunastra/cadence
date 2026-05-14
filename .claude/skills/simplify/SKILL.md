---
name: simplify
description: Review changed code for reuse opportunities, unnecessary complexity, dead code, and efficiency wins. Use after implementing a feature or before merging to tighten the diff.
---

# Simplify

Reviews recently changed code for simplification opportunities. Behavior-preserving only — refactoring, not rewriting.

## Step 1: Identify the Diff

Determine what changed. Use one of:

```bash
# Changes since last commit
git diff HEAD

# Changes on this branch vs main
git diff main...HEAD --stat

# Specific file
git diff main -- path/to/file.tsx
```

If the user specifies a file or component, scope to that. Otherwise, review the full diff.

## Step 2: Read the Changed Files

Read every file in the diff. For each file, also check:
- Does `app/actions.ts` already have a similar server action?
- Does `lib/` already have a utility that does the same thing?
- Is there duplicate logic between this change and existing code?

## Step 3: Check for Issues

Scan for these categories (skip any that don't apply):

### Dead Code
- [ ] Unused imports
- [ ] Unused variables, functions, types
- [ ] Commented-out code blocks
- [ ] CSS classes in `globals.css` that nothing references

### Redundant Logic
- [ ] Duplicate server actions in `app/actions.ts`
- [ ] Logic that already exists in `lib/date-utils.ts`, `lib/field-options.ts`, `lib/views.ts`, etc.
- [ ] Null checks where TypeScript guarantees non-null
- [ ] Try/catch that just rethrows
- [ ] Duplicated filter/sort debounce patterns across pages

### Unnecessary Complexity
- [ ] Abstractions with only one caller
- [ ] Helper functions used in one place
- [ ] Custom hooks wrapping a single `useState`
- [ ] `useMemo`/`useCallback` on cheap computations
- [ ] Error handling for impossible scenarios

### Performance
- [ ] Sequential `await`s that could be `Promise.all`
- [ ] Inline object/function props in lists (re-render churn)
- [ ] `'use client'` on components that don't need it
- [ ] Realtime subscriptions using `event: '*'` when only specific events matter
- [ ] Missing `studio_id` filter on Realtime subscriptions

### Styling
- [ ] Hardcoded hex values (should use CSS custom properties)
- [ ] `dark:` Tailwind color variants (should use CSS tokens)
- [ ] Inline `style={{}}` that could be Tailwind classes

### Verbose Patterns
- [ ] `if/else` that could be `??` or `||`
- [ ] Unnecessary intermediate variables
- [ ] Nested ternaries that could be early returns
- [ ] Manual loops that could be `.filter().map()`

## Step 4: Surface Findings

Present a punch list before making any changes:

```markdown
## Simplification Opportunities

| # | File:Line | Type | Issue | Proposed Fix | Risk |
|---|-----------|------|-------|--------------|------|
| 1 | `file.tsx:42` | Dead code | Unused import | Remove | None |
| 2 | `file.tsx:88` | Verbose | Sequential awaits | `Promise.all` | None |
| 3 | `actions.ts:200` | Redundant | Duplicate of existing `fetchLeads` | Reuse existing | Low — verify params match |
```

Wait for user confirmation before applying changes beyond trivial cleanup (unused imports, dead variables).

## Step 5: Apply Changes

- One logical group at a time
- Preserve exact behavior
- Don't touch RLS, auth, or webhook handler logic
- Don't change server action signatures

## Step 6: Verify

```bash
npm run build
```

Build must pass. If it fails, fix the root cause — don't revert the simplification and don't suppress with `any`.

## Step 7: Report

```markdown
## Simplification Report

### Changes Made
| # | Type | Before | After | Lines Saved |
|---|------|--------|-------|-------------|
| 1 | ... | ... | ... | -N |

### Total Impact
- Lines removed: X
- Files modified: Y

### Not Changed (and why)
- <things that look complex but have a reason>

### Verification
- [PASS/FAIL] `npm run build`
- [ ] No server action signatures changed
```
