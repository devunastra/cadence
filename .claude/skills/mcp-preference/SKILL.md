---
name: mcp-preference
description: MUST USE when invoking any Supabase MCP tool, or when the user mentions MCP, MCP server, .mcp.json, mcp config, mcp setup, mcp prefix, mcp tool, mcp authentication, mcp account, claude.ai mcp, plugin mcp, local mcp, supabase mcp, wrong mcp, wrong account, wrong project, mcp leak, cross-account leak, mcp preference. Enforces use of the local Supabase MCP server (.mcp.json) over the Claude Code plugin or Claude.ai account MCPs to prevent cross-project data leakage.
---

# MCP Server Preference

This skill ensures all MCP tool calls use the local Supabase server configured in `.mcp.json`, never the Claude Code plugin Supabase or any Claude.ai account MCP.

## Purpose

- Prevents using MCPs authenticated with the wrong Supabase project
- Ensures Supabase calls target the correct AMLS project ref (`npcpkffnswzvzmqolort`), not a different one
- Avoids data leakage between projects (reading/writing the wrong database, leaking lead data, studio info, or PII)
- Keeps developer tooling pinned to the credentials the project was built against

## Rule

**ALWAYS use the local Supabase MCP from `.mcp.json` (`mcp__supabase__*`). NEVER use the Claude Code plugin Supabase MCP (`mcp__plugin_supabase_supabase__*`) or any Claude.ai account Supabase MCP for project-scoped operations.**

## Prefix Mapping

| Service  | CORRECT (Local `.mcp.json`)  | WRONG (Plugin)                          | WRONG (Claude.ai Account)                |
|----------|------------------------------|------------------------------------------|------------------------------------------|
| Supabase | `mcp__supabase__*`           | `mcp__plugin_supabase_supabase__*`       | `mcp__claude_ai_Supabase__*` (if exists) |

### Current AMLS MCP State

- **Supabase:** local server in `.mcp.json` pointing to project `npcpkffnswzvzmqolort` — use `mcp__supabase__*`
- **n8n:** local server in `.mcp.json` for workflow automation — use `mcp__n8n-mcp__*`
- **Plugin Supabase:** do not use `mcp__plugin_supabase_supabase__*` — it may authenticate against a different project

## Correct Tool Names

Local Supabase MCP (configured in `.mcp.json`):

```
mcp__supabase__execute_sql
mcp__supabase__apply_migration
mcp__supabase__list_tables
mcp__supabase__list_migrations
mcp__supabase__get_logs
mcp__supabase__search_docs
mcp__supabase__generate_typescript_types
```

## Why This Matters

The Claude.ai account MCPs and the Claude Code plugin Supabase MCP may be authenticated with a different account or project than AMLS. Using them could:

- **Query or mutate the wrong Supabase database** — e.g. running `apply_migration` against another project's schema
- **Leak PII** between projects (AMLS contains lead data, phone numbers, email addresses, studio info, staff details)
- **Apply schema changes to the wrong environment** — particularly dangerous with `mcp__plugin_supabase_supabase__apply_migration`

The local MCP in `.mcp.json` is pinned to the AMLS Supabase project (`npcpkffnswzvzmqolort`) with a project-specific access token, so all operations stay scoped to this project.

## Instructions

### Step 1: Identify the Service

When the user asks for an MCP-backed operation (database query, migration, schema lookup), confirm it targets Supabase.

### Step 2: Check the Prefix

Before calling any `mcp__*` tool, verify the prefix matches the **CORRECT** column above:

- **Supabase** — `mcp__supabase__*` only. Refuse if the only available variant is `mcp__plugin_supabase_supabase__*` or `mcp__claude_ai_Supabase__*`; ask the user to add the correct local MCP first.
- **n8n** — `mcp__n8n-mcp__*` only.

### Step 3: Confirm Project Scope

For Supabase calls, the local MCP is hardcoded to project ref `npcpkffnswzvzmqolort`. If the user references a different project, stop and ask — don't redirect the call to a different MCP.

### Step 4: Refuse the Wrong Variant

If you're about to call `mcp__plugin_supabase_supabase__*` or `mcp__claude_ai_Supabase__*` on AMLS data, stop. Surface this skill's rule to the user and ask them to confirm the correct MCP is loaded.

## Local MCP Location

`.mcp.json` at the project root. Currently configured:
- **Supabase** — project ref `npcpkffnswzvzmqolort`
- **n8n** — workflow automation server

## When to Update `.mcp.json`

- Rotating the Supabase access token
- Switching to a different Supabase project (e.g. staging vs production)
- Adding a new MCP server

## Security Note

`.mcp.json` contains a Supabase access token and n8n credentials. It must be gitignored. Do not commit it. If you see it staged for commit during a `git add`, abort and inform the user.

## Quality Checklist

Before any MCP call:
- [ ] Prefix matches the **CORRECT (Local)** column for the service
- [ ] Not calling `mcp__plugin_supabase_supabase__*` for AMLS data
- [ ] Not calling `mcp__claude_ai_Supabase__*` for AMLS data
- [ ] For Supabase, project ref is `npcpkffnswzvzmqolort` (or user has confirmed otherwise)
- [ ] `.mcp.json` is not staged for commit
