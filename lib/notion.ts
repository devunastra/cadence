// Server-side only — the browser must NEVER call Notion (same hard rule as lib/ghl.ts).
// App -> Notion sync (S1). Gated by env NOTION_SYNC_MODE:
//   'off'  (default) — do nothing
//   'log'  — compute the intended Notion write and record it to notion_sync_log, but DO NOT call Notion
//   'live' — actually PATCH/POST/archive the Notion page, and log the result
// All failures are non-fatal: Supabase is the source of truth; a Notion hiccup must never break a save.

import type { SupabaseClient } from '@supabase/supabase-js'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

export type NotionSyncMode = 'off' | 'log' | 'live'
export function notionSyncMode(): NotionSyncMode {
  const m = (process.env.NOTION_SYNC_MODE ?? 'off').toLowerCase()
  return m === 'log' || m === 'live' ? m : 'off'
}

// Supabase lead field -> Notion property name
const SELECT_PROP: Record<string, string> = {
  status: 'Status', level: '', action: 'Action', source: 'Source', reason: 'Reason', partnership: 'Partnership',
}
const TEXT_PROP: Record<string, string> = {
  phone: 'Phone', email: 'Email', comments: 'Comments', available: 'Available',
}
const CHECKBOX_PROP: Record<string, string> = {
  showed: 'Showed', bought: 'Bought', old: 'OLD', texted: 'Texted',
}
const DATE_PROP: Record<string, string> = {
  last_contacted: 'Last Contacted', first_lesson: 'First Lesson',
}

// Enum fields are stored as FK UUIDs in Supabase; the caller must resolve them to the option
// VALUE (label) before passing to this module (Notion selects use the option name).
export const NOTION_ENUM_FIELDS = new Set(Object.keys(SELECT_PROP))
export const NOTION_SYNCED_FIELDS = new Set<string>([
  'name', ...Object.keys(SELECT_PROP), ...Object.keys(TEXT_PROP), ...Object.keys(CHECKBOX_PROP), ...Object.keys(DATE_PROP),
])

function notionDateStart(field: string, iso: string): string {
  // last_contacted is a date-only field; first_lesson keeps its time when present.
  if (field === 'last_contacted') return iso.slice(0, 10)
  return /T\d/.test(iso) ? iso : iso.slice(0, 10)
}

// fields: resolved values (enum fields already mapped to their option label string)
export function buildNotionProperties(fields: Record<string, string | boolean | null>): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'name') props['Name'] = { title: v ? [{ text: { content: String(v) } }] : [] }
    else if (k in SELECT_PROP) props[SELECT_PROP[k]] = { select: v ? { name: String(v) } : null }
    else if (k in TEXT_PROP) props[TEXT_PROP[k]] = { rich_text: v ? [{ text: { content: String(v) } }] : [] }
    else if (k in CHECKBOX_PROP) props[CHECKBOX_PROP[k]] = { checkbox: Boolean(v) }
    else if (k in DATE_PROP) props[DATE_PROP[k]] = { date: v ? { start: notionDateStart(k, String(v)) } : null }
  }
  return props
}

type SyncAction = 'create' | 'update' | 'archive' | 'skip' | 'error'
async function logSync(client: SupabaseClient, row: {
  studio_id: string; lead_id: string | null; notion_page_id: string | null; action: SyncAction; detail: unknown
}, direction: 'app_to_notion' | 'notion_to_app' = 'app_to_notion') {
  try {
    await client.from('notion_sync_log').insert({ ...row, direction })
  } catch { /* logging is best-effort */ }
}

async function notionFetch(path: string, init: RequestInit): Promise<Response> {
  const key = process.env.NOTION_API_KEY
  if (!key) throw new Error('NOTION_API_KEY is not configured')
  return fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json', ...init.headers },
  })
}

/** Push a lead UPDATE to its linked Notion page. fields = resolved (enum -> label). Non-fatal. */
export async function syncLeadUpdateToNotion(client: SupabaseClient, opts: {
  leadId: string; studioId: string; notionPageId: string | null; fields: Record<string, string | boolean | null>
}): Promise<void> {
  const mode = notionSyncMode()
  if (mode === 'off') return
  const props = buildNotionProperties(opts.fields)
  if (Object.keys(props).length === 0) return
  const base = { studio_id: opts.studioId, lead_id: opts.leadId, notion_page_id: opts.notionPageId }
  if (!opts.notionPageId) { await logSync(client, { ...base, action: 'skip', detail: { reason: 'no_notion_page_id', would_set: Object.keys(props) } }); return }
  if (mode === 'log') { await logSync(client, { ...base, action: 'skip', detail: { mode: 'log', would_patch: props } }); return }
  try {
    const res = await notionFetch(`/pages/${opts.notionPageId}`, { method: 'PATCH', body: JSON.stringify({ properties: props }) })
    if (!res.ok) { await logSync(client, { ...base, action: 'error', detail: { op: 'update', status: res.status, body: (await res.text()).slice(0, 500) } }); return }
    await logSync(client, { ...base, action: 'update', detail: { patched: Object.keys(props) } })
  } catch (e) { await logSync(client, { ...base, action: 'error', detail: { op: 'update', message: String(e) } }) }
}

/** Create a Notion page for a new lead. Returns the new page id (live mode), else null. Non-fatal. */
export async function syncLeadCreateToNotion(client: SupabaseClient, opts: {
  leadId: string; studioId: string; notionDbId: string | null; fields: Record<string, string | boolean | null>
}): Promise<string | null> {
  const mode = notionSyncMode()
  if (mode === 'off') return null
  const props = buildNotionProperties(opts.fields)
  const base = { studio_id: opts.studioId, lead_id: opts.leadId, notion_page_id: null }
  if (!opts.notionDbId) { await logSync(client, { ...base, action: 'skip', detail: { reason: 'studio_has_no_notion_db' } }); return null }
  if (mode === 'log') { await logSync(client, { ...base, action: 'skip', detail: { mode: 'log', would_create: props } }); return null }
  try {
    const res = await notionFetch('/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: opts.notionDbId }, properties: props }) })
    if (!res.ok) { await logSync(client, { ...base, action: 'error', detail: { op: 'create', status: res.status, body: (await res.text()).slice(0, 500) } }); return null }
    const page = await res.json() as { id?: string }
    await logSync(client, { studio_id: opts.studioId, lead_id: opts.leadId, notion_page_id: page.id ?? null, action: 'create', detail: { created: Object.keys(props) } })
    return page.id ?? null
  } catch (e) { await logSync(client, { ...base, action: 'error', detail: { op: 'create', message: String(e) } }); return null }
}

/** Archive (soft-delete) the linked Notion page when a lead is deleted in the app. Non-fatal. */
export async function syncLeadArchiveToNotion(client: SupabaseClient, opts: {
  leadId: string | null; studioId: string; notionPageId: string | null
}): Promise<void> {
  const mode = notionSyncMode()
  if (mode === 'off' || !opts.notionPageId) return
  const base = { studio_id: opts.studioId, lead_id: opts.leadId, notion_page_id: opts.notionPageId }
  if (mode === 'log') { await logSync(client, { ...base, action: 'skip', detail: { mode: 'log', would_archive: true } }); return }
  try {
    const res = await notionFetch(`/pages/${opts.notionPageId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
    if (!res.ok) { await logSync(client, { ...base, action: 'error', detail: { op: 'archive', status: res.status, body: (await res.text()).slice(0, 500) } }); return }
    await logSync(client, { ...base, action: 'archive', detail: {} })
  } catch (e) { await logSync(client, { ...base, action: 'error', detail: { op: 'archive', message: String(e) } }) }
}

// ───────────────────────────── S2: Notion → App ─────────────────────────────
// Reverse map: Notion property -> Supabase field — only the fields the client maintains in Notion.
// EXCLUDED on purpose (Notion→app):
//   - name/phone/email  -> app/GHL-owned and cleaned; Notion copies are messy (URL-names, unformatted)
//   - comments/available -> free-text noise in Notion
//   - first_lesson       -> Supabase-authoritative (client's decision)
// INCLUDED: the enums (Notion-authoritative), checkboxes, and last_contacted.
type NotionKind = 'title' | 'select' | 'text' | 'checkbox' | 'date'
const NOTION_TO_FIELD: Record<string, { field: string; kind: NotionKind }> = {
  'Status': { field: 'status', kind: 'select' },
  '': { field: 'level', kind: 'select' },
  'Action': { field: 'action', kind: 'select' },
  'Source': { field: 'source', kind: 'select' },
  'Reason': { field: 'reason', kind: 'select' },
  'Partnership': { field: 'partnership', kind: 'select' },
  'Showed': { field: 'showed', kind: 'checkbox' },
  'Bought': { field: 'bought', kind: 'checkbox' },
  'OLD': { field: 'old', kind: 'checkbox' },
  'Texted': { field: 'texted', kind: 'checkbox' },
  'Last Contacted': { field: 'last_contacted', kind: 'date' },
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function readNotionProp(props: any, name: string, kind: NotionKind): string | boolean | null {
  const p = props?.[name]
  if (!p) return kind === 'checkbox' ? false : null
  if (kind === 'title') return (p.title ?? []).map((t: any) => t.plain_text).join('').trim() || null
  if (kind === 'text') return (p.rich_text ?? []).map((t: any) => t.plain_text).join('').trim() || null
  if (kind === 'select') return p.select?.name ?? null
  if (kind === 'checkbox') return Boolean(p.checkbox)
  if (kind === 'date') return p.date?.start ?? null
  return null
}

async function notionQueryAll(dbId: string): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  do {
    const res = await notionFetch(`/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
    })
    if (!res.ok) throw new Error(`notion query failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    const j = await res.json() as { results: any[]; has_more: boolean; next_cursor?: string }
    out.push(...j.results)
    cursor = j.has_more ? j.next_cursor : undefined
  } while (cursor)
  return out
}

// Build the Supabase update for one Notion page vs the current lead row (value-comparison).
// Only includes fields that actually differ. Enum labels resolved via labelToId (`${field}:${label}`).
function buildLeadUpdateFromPage(
  props: any, lead: any, labelToId: Map<string, string>, unmatched: Set<string>,
): { update: Record<string, string | boolean | null>; detail: Record<string, unknown> } {
  const update: Record<string, string | boolean | null> = {}
  const detail: Record<string, unknown> = {}
  for (const [propName, { field, kind }] of Object.entries(NOTION_TO_FIELD)) {
    const nv = readNotionProp(props, propName, kind)
    if (kind === 'select') {
      if (nv == null) continue // Notion-empty select: leave Supabase as-is
      const id = labelToId.get(`${field}:${nv}`)
      if (!id) { unmatched.add(`${field}:${nv}`); continue } // no matching option -> skip field
      if (id !== lead[field]) { update[field] = id; detail[field] = { to: nv } }
    } else if (kind === 'checkbox') {
      if (Boolean(nv) !== Boolean(lead[field])) { update[field] = Boolean(nv); detail[field] = { to: nv } }
    } else if (kind === 'date') {
      if (!nv) continue // don't clear from a Notion-empty date
      const day = String(nv).slice(0, 10)
      const curDay = lead[field] ? String(lead[field]).slice(0, 10) : null
      if (day !== curDay) { update[field] = day + 'T00:00:00.000Z'; detail[field] = { to: day } }
    } else { // title / text
      const cur = (lead[field] ?? null) as string | null
      const val = (nv ?? null) as string | null
      if (val !== cur) { update[field] = val; detail[field] = { to: val } }
    }
  }
  return { update, detail }
}

const LEAD_SYNC_COLS = 'id,notion_page_id,name,phone,email,comments,available,status,level,action,source,reason,partnership,showed,bought,old,texted,last_contacted'

/**
 * Sync a SINGLE Notion page into Supabase (used by the webhook for fast, near-instant updates).
 * Fetches the page, finds the linked lead, applies only changed fields. Non-fatal.
 */
export async function syncOneNotionPageToSupabase(client: SupabaseClient, pageId: string): Promise<{ status: 'updated' | 'nochange' | 'unlinked' | 'skipped' | 'error'; detail?: unknown }> {
  const mode = notionSyncMode()
  if (mode === 'off') return { status: 'skipped' }

  const { data: lead } = await client.from('leads').select(LEAD_SYNC_COLS).eq('notion_page_id', pageId).maybeSingle()
  if (!lead) return { status: 'unlinked' } // no linked lead (e.g. a brand-new Notion page) — handled separately
  const studioId = (lead as { id: string }) && (await client.from('leads').select('studio_id').eq('id', (lead as any).id).single()).data?.studio_id
  if (!studioId) return { status: 'error', detail: 'no studio' }

  const { data: opts } = await client.from('studio_field_options').select('id,field,value').eq('studio_id', studioId)
  const labelToId = new Map<string, string>()
  for (const o of (opts ?? []) as { id: string; field: string; value: string }[]) labelToId.set(`${o.field}:${o.value}`, o.id)

  const res = await notionFetch(`/pages/${pageId}`, { method: 'GET' })
  if (!res.ok) { await logSync(client, { studio_id: studioId, lead_id: (lead as any).id, notion_page_id: pageId, action: 'error', detail: { op: 'pull_one', status: res.status } }, 'notion_to_app'); return { status: 'error' } }
  const page = await res.json() as { properties: any }

  const unmatched = new Set<string>()
  const { update, detail } = buildLeadUpdateFromPage(page.properties, lead, labelToId, unmatched)
  if (Object.keys(update).length === 0) return { status: 'nochange' }

  if (mode === 'log') {
    await logSync(client, { studio_id: studioId, lead_id: (lead as any).id, notion_page_id: pageId, action: 'skip', detail: { mode: 'log', would_update: detail } }, 'notion_to_app')
    return { status: 'updated', detail }
  }
  const { error } = await client.from('leads').update(update).eq('id', (lead as any).id).eq('studio_id', studioId)
  if (error) { await logSync(client, { studio_id: studioId, lead_id: (lead as any).id, notion_page_id: pageId, action: 'error', detail: { op: 'pull_one', message: error.message } }, 'notion_to_app'); return { status: 'error' } }
  await logSync(client, { studio_id: studioId, lead_id: (lead as any).id, notion_page_id: pageId, action: 'update', detail: { updated: detail } }, 'notion_to_app')
  return { status: 'updated', detail }
}

/**
 * Pull Notion edits into Supabase for one studio's linked leads.
 * Echo suppression = value comparison: only writes a field when Notion ≠ Supabase, so a prior
 * app→Notion push that already matched never bounces back. Writes go DIRECT to the leads table
 * (bypassing updateLead) so they never re-trigger the app→Notion push. Non-fatal; logs everything.
 */
export async function syncNotionToSupabase(client: SupabaseClient, studioId: string): Promise<{ checked: number; changed: number; skipped: number; unmatched_selects: string[] }> {
  const mode = notionSyncMode()
  const empty = { checked: 0, changed: 0, skipped: 0, unmatched_selects: [] as string[] }
  if (mode === 'off') return empty

  const { data: studio } = await client.from('studios').select('notion_leads_db_id').eq('id', studioId).single()
  const dbId = (studio as { notion_leads_db_id: string | null } | null)?.notion_leads_db_id
  if (!dbId) return empty

  const { data: opts } = await client.from('studio_field_options').select('id,field,value').eq('studio_id', studioId)
  const labelToId = new Map<string, string>()
  for (const o of (opts ?? []) as { id: string; field: string; value: string }[]) labelToId.set(`${o.field}:${o.value}`, o.id)

  const cols = 'id,notion_page_id,name,phone,email,comments,available,status,level,action,source,reason,partnership,showed,bought,old,texted,last_contacted'
  const leadByPage = new Map<string, any>()
  let from = 0
  for (;;) {
    const { data } = await client.from('leads').select(cols).eq('studio_id', studioId).not('notion_page_id', 'is', null).range(from, from + 999)
    for (const l of (data ?? []) as any[]) leadByPage.set(l.notion_page_id, l)
    if (!data || data.length < 1000) break
    from += 1000
  }

  const pages = await notionQueryAll(dbId)
  const unmatched = new Set<string>()
  const logRows: Array<Record<string, unknown>> = []
  const pushLog = (lead_id: string, notion_page_id: string, action: SyncAction, detail: unknown) =>
    logRows.push({ studio_id: studioId, lead_id, notion_page_id, direction: 'notion_to_app', action, detail })
  let checked = 0, changed = 0, skipped = 0

  for (const page of pages) {
    const lead = leadByPage.get(page.id)
    if (!lead) continue
    checked++
    const { update, detail } = buildLeadUpdateFromPage(page.properties, lead, labelToId, unmatched)
    if (Object.keys(update).length === 0) { skipped++; continue }
    if (mode === 'log') {
      pushLog(lead.id, page.id, 'skip', { mode: 'log', would_update: detail })
      changed++
      continue
    }
    const { error } = await client.from('leads').update(update).eq('id', lead.id).eq('studio_id', studioId)
    if (error) {
      pushLog(lead.id, page.id, 'error', { op: 'pull', message: error.message })
    } else {
      await client.from('leads').update({ notion_last_edited_time: page.last_edited_time, notion_last_synced_at: new Date().toISOString() }).eq('id', lead.id)
      pushLog(lead.id, page.id, 'update', { updated: detail })
      changed++
    }
  }

  // Batch-insert the sync log (best-effort).
  for (let i = 0; i < logRows.length; i += 500) {
    try { await client.from('notion_sync_log').insert(logRows.slice(i, i + 500)) } catch { /* non-fatal */ }
  }
  return { checked, changed, skipped, unmatched_selects: [...unmatched] }
}
