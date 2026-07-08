// Server-side only — the browser must NEVER call Notion (same hard rule as lib/ghl.ts).
// App -> Notion sync (S1). Gated by env NOTION_SYNC_MODE:
//   'off'  (default) — do nothing
//   'log'  — compute the intended Notion write and record it to notion_sync_log, but DO NOT call Notion
//   'live' — actually PATCH/POST/archive the Notion page, and log the result
// All failures are non-fatal: Supabase is the source of truth; a Notion hiccup must never break a save.

import type { SupabaseClient } from '@supabase/supabase-js'
import { tzCalendarParts, studioMidnightFromStr } from './date-utils'

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

const pad = (n: number) => String(n).padStart(2, '0')

/** Studio-local YYYY-MM-DD for a UTC ISO stored in the DB (uses tzCalendarParts). */
function studioLocalDay(iso: string, tz: string): string {
  const { year, month, day } = tzCalendarParts(iso, tz)
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

/**
 * Convert a Notion date property value (any string) into the studio-local-midnight UTC ISO the app
 * stores. Mirrors the importer's studioMidnightIso: .slice(0,10) drops any time component, then
 * midnight in `tz`. Returns null for an empty value.
 */
function studioMidnightIso(rawStart: string | boolean | null, tz: string): string | null {
  if (!rawStart) return null
  return studioMidnightFromStr(String(rawStart).slice(0, 10), tz).toISOString()
}

/**
 * Notion date object for a date field, adjusted to the studio's timezone.
 * - last_contacted → date-only (studio-local calendar day)
 * - first_lesson   → datetime with time_zone so Notion shows the local wall-clock time
 */
function notionDateValue(field: string, iso: string, tz: string): { start: string; time_zone?: string } {
  if (field === 'last_contacted') return { start: studioLocalDay(iso, tz) }
  if (/T\d/.test(iso)) {
    // first_lesson is stored as the booking studio's wall-clock written as UTC
    // (the n8n appointment webhook sends naive ISO strings without a tz marker;
    // see lib/date-utils.ts displayTzForLeadField for the matching UI workaround).
    // Read the UTC components directly so the wall-clock we send to Notion
    // matches what the app shows. Revert both helpers together when n8n is
    // updated to send tz-aware timestamps.
    const sourceTz = field === 'first_lesson' ? 'UTC' : tz
    const { year, month, day, hour, minute } = tzCalendarParts(iso, sourceTz)
    return { start: `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00.000`, time_zone: tz }
  }
  return { start: iso.slice(0, 10) }
}

// fields: resolved values (enum fields already mapped to their option label string)
export function buildNotionProperties(fields: Record<string, string | boolean | null>, tz = 'UTC'): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'name') props['Name'] = { title: v ? [{ text: { content: String(v) } }] : [] }
    else if (k in SELECT_PROP) props[SELECT_PROP[k]] = { select: v ? { name: String(v) } : null }
    else if (k in TEXT_PROP) props[TEXT_PROP[k]] = { rich_text: v ? [{ text: { content: String(v) } }] : [] }
    else if (k in CHECKBOX_PROP) props[CHECKBOX_PROP[k]] = { checkbox: Boolean(v) }
    else if (k in DATE_PROP) props[DATE_PROP[k]] = { date: v ? notionDateValue(k, String(v), tz) : null }
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
  const { data: studioRow } = await client.from('studios').select('timezone').eq('id', opts.studioId).single()
  const tz = (studioRow as { timezone?: string } | null)?.timezone ?? 'UTC'
  const props = buildNotionProperties(opts.fields, tz)
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
  const { data: studioRow } = await client.from('studios').select('timezone').eq('id', opts.studioId).single()
  const tz = (studioRow as { timezone?: string } | null)?.timezone ?? 'UTC'
  const props = buildNotionProperties(opts.fields, tz)
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
  props: any, lead: any, labelToId: Map<string, string>, unmatched: Set<string>, tz: string,
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
      const day = String(nv).slice(0, 10)  // Notion's studio-local date
      const curDay = lead[field] ? studioLocalDay(String(lead[field]), tz) : null
      if (day !== curDay) { update[field] = studioMidnightFromStr(day, tz).toISOString(); detail[field] = { to: day } }
    } else { // title / text
      const cur = (lead[field] ?? null) as string | null
      const val = (nv ?? null) as string | null
      if (val !== cur) { update[field] = val; detail[field] = { to: val } }
    }
  }
  return { update, detail }
}

// Mirror an applied Notion→app update into activity_logs so board edits are auditable in
// Settings → Activity Log next to in-app edits. Same row shape app/actions.ts writes:
// enum UUIDs resolved to option labels, actor_email null, source 'notion' (rendered as
// "via Notion" by the UI). `lead` is the pre-update row, `update` the applied raw values.
function buildNotionActivityRow(
  studioId: string, lead: any, update: Record<string, string | boolean | null>, idToLabel: Map<string, string>,
): Record<string, unknown> | null {
  const resolve = (v: unknown) => (typeof v === 'string' && idToLabel.has(v)) ? idToLabel.get(v)! : v ?? null
  const changes = Object.entries(update).map(([field, nv]) => ({
    field, old_value: resolve(lead[field]), new_value: resolve(nv),
  }))
  if (changes.length === 0) return null
  return {
    studio_id: studioId,
    lead_id: lead.id,
    lead_name: (lead.name as string | null) ?? null,
    actor_email: null,
    event_type: 'update',
    changes,
    source: 'notion',
  }
}

const LEAD_SYNC_COLS = 'id,studio_id,notion_page_id,name,phone,email,comments,available,status,level,action,source,reason,partnership,showed,bought,old,texted,last_contacted'

/**
 * Sync a SINGLE Notion page into Supabase (used by the webhook for fast, near-instant updates).
 * Fetches the page, finds the linked lead, applies only changed fields. Non-fatal.
 */
export async function syncOneNotionPageToSupabase(client: SupabaseClient, pageId: string): Promise<{ status: 'updated' | 'nochange' | 'unlinked' | 'skipped' | 'error'; detail?: unknown }> {
  const mode = notionSyncMode()
  if (mode === 'off') return { status: 'skipped' }

  const { data: lead } = await client.from('leads').select(LEAD_SYNC_COLS).eq('notion_page_id', pageId).maybeSingle()
  if (!lead) return { status: 'unlinked' } // no linked lead (e.g. a brand-new Notion page) — handled separately
  const studioId = (lead as any).studio_id as string | undefined
  if (!studioId) return { status: 'error', detail: 'no studio' }

  const [{ data: opts }, { data: studioRow }] = await Promise.all([
    client.from('studio_field_options').select('id,field,value').eq('studio_id', studioId),
    client.from('studios').select('timezone').eq('id', studioId).single(),
  ])
  const labelToId = new Map<string, string>()
  const idToLabel = new Map<string, string>()
  for (const o of (opts ?? []) as { id: string; field: string; value: string }[]) {
    labelToId.set(`${o.field}:${o.value}`, o.id)
    idToLabel.set(o.id, o.value)
  }
  const tz = (studioRow as { timezone?: string } | null)?.timezone ?? 'UTC'

  const res = await notionFetch(`/pages/${pageId}`, { method: 'GET' })
  if (!res.ok) { await logSync(client, { studio_id: studioId, lead_id: (lead as any).id, notion_page_id: pageId, action: 'error', detail: { op: 'pull_one', status: res.status } }, 'notion_to_app'); return { status: 'error' } }
  const page = await res.json() as { properties: any }

  const unmatched = new Set<string>()
  const { update, detail } = buildLeadUpdateFromPage(page.properties, lead, labelToId, unmatched, tz)
  if (Object.keys(update).length === 0) return { status: 'nochange' }

  if (mode === 'log') {
    await logSync(client, { studio_id: studioId, lead_id: (lead as any).id, notion_page_id: pageId, action: 'skip', detail: { mode: 'log', would_update: detail } }, 'notion_to_app')
    return { status: 'updated', detail }
  }
  const { error } = await client.from('leads').update(update).eq('id', (lead as any).id).eq('studio_id', studioId)
  if (error) { await logSync(client, { studio_id: studioId, lead_id: (lead as any).id, notion_page_id: pageId, action: 'error', detail: { op: 'pull_one', message: error.message } }, 'notion_to_app'); return { status: 'error' } }
  await logSync(client, { studio_id: studioId, lead_id: (lead as any).id, notion_page_id: pageId, action: 'update', detail: { updated: detail } }, 'notion_to_app')
  // Awaited, not fire-and-forget — detached inserts get dropped when the serverless
  // invocation freezes after the webhook response.
  const activityRow = buildNotionActivityRow(studioId, lead, update, idToLabel)
  if (activityRow) { try { await client.from('activity_logs').insert(activityRow) } catch { /* logging is best-effort */ } }
  return { status: 'updated', detail }
}

// ───────────────── Ongoing auto-linking (notion_page_id) ─────────────────
// Match an unlinked Supabase lead to its Notion page by phone/email — the ONGOING version of the
// one-time L0 backfill (scripts/notion-link-backfill.mjs), so leads created after the backfill
// (e.g. GHL-sourced) get linked automatically. Reuses pages the pull already fetched (no extra
// Notion calls). Writes ONLY the link columns to Supabase — never writes Notion or GHL.
const stripNotionUrl = (s: unknown): string =>
  String(s ?? '').replace(/https?:\/\/(www\.)?(app\.)?notion\.(so|com)/gi, '').trim()
function normMatchPhone(raw: unknown): string | null {
  const d = stripNotionUrl(raw).replace(/\D/g, '')
  if (!d) return null
  const x = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return x.length >= 10 ? x.slice(-10) : null
}
function normMatchEmail(raw: unknown): string | null {
  const s = stripNotionUrl(raw).toLowerCase()
  return s.split(/\s+/).find((t) => t.includes('@')) ?? null
}
// E.164 normalization for a NEW lead's stored phone (mirrors the importer's normalizePhone +
// the app's normalizePhone): "+1XXXXXXXXXX" for a US 10/11-digit number, else null.
function normalizePhone(raw: unknown): string | null {
  const d = stripNotionUrl(raw).replace(/\D/g, '')
  if (!d) return null
  const x = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return x.length === 10 ? `+1${x}` : null
}
// Stored email for a NEW lead (mirrors the importer's normalizeEmail): lowercase, first @-bearing token.
function normalizeEmail(raw: unknown): string | null {
  const s = stripNotionUrl(raw).toLowerCase()
  return s.split(/\s+/).find((t) => t.includes('@')) ?? null
}
function readNotionContact(props: any, name: string): string | null {
  const p = props?.[name]
  if (!p) return null
  if (p.type === 'phone_number') return p.phone_number || null
  if (p.type === 'email') return p.email || null
  if (p.type === 'rich_text') return (p.rich_text ?? []).map((t: any) => t.plain_text).join('').trim() || null
  if (p.type === 'title') return (p.title ?? []).map((t: any) => t.plain_text).join('').trim() || null
  return null
}

/**
 * Link unlinked Supabase leads to their Notion page by phone/email — DEDUP-AWARE & conflict-safe.
 * Only links when the match is unambiguous on BOTH sides:
 *  - The contact (phone/email) must be GLOBALLY UNIQUE across all of the studio's leads — i.e. no other
 *    lead (linked OR unlinked) shares it. This skips duplicate people and couples/shared-phone cases
 *    (which previously caused wrong links); those are surfaced for manual dedupe, never auto-linked.
 *  - The Notion page must not already be linked to a lead (`linkedPageIds`) → no double-assignment.
 *  - If a page's phone and email resolve to two different leads, it's skipped (ambiguous).
 *  - The write is guarded by `.is('notion_page_id', null)` + the leads_notion_page_id_key unique index;
 *    a 0-row result or constraint hit is logged and skipped, NEVER thrown.
 *  - Writes ONLY notion_page_id + link timestamps to Supabase. NEVER writes Notion. 'log' mode = dry-run.
 * Returns the freshly-linked {pageId, leadId} pairs so the caller can sync their values in the same run.
 */
export async function linkUnlinkedLeads(
  client: SupabaseClient, studioId: string, pages: any[], linkedPageIds: Set<string>,
): Promise<{ linked: Array<{ pageId: string; leadId: string }>; ambiguous: number; conflicts: number }> {
  const mode = notionSyncMode()
  if (mode === 'off') return { linked: [], ambiguous: 0, conflicts: 0 }

  // Load ALL leads' contact + link state, so a lead is linked ONLY if its contact is globally unique.
  const all: Array<{ id: string; phone: string | null; email: string | null; notion_page_id: string | null }> = []
  let from = 0
  for (;;) {
    const { data } = await client.from('leads').select('id,phone,email,notion_page_id')
      .eq('studio_id', studioId).range(from, from + 999)
    for (const l of (data ?? []) as any[]) all.push(l)
    if (!data || data.length < 1000) break
    from += 1000
  }
  if (all.length === 0) return { linked: [], ambiguous: 0, conflicts: 0 }

  // Count each normalized phone/email across ALL leads; remember the single owner + whether it's linked.
  const phoneCount = new Map<string, number>(), emailCount = new Map<string, number>()
  const phoneOwner = new Map<string, { id: string; linked: boolean }>()
  const emailOwner = new Map<string, { id: string; linked: boolean }>()
  for (const l of all) {
    const linkedFlag = l.notion_page_id != null
    const p = normMatchPhone(l.phone)
    if (p) { phoneCount.set(p, (phoneCount.get(p) ?? 0) + 1); phoneOwner.set(p, { id: l.id, linked: linkedFlag }) }
    const e = normMatchEmail(l.email)
    if (e) { emailCount.set(e, (emailCount.get(e) ?? 0) + 1); emailOwner.set(e, { id: l.id, linked: linkedFlag }) }
  }
  // A lead is safe to auto-link only if it shares NEITHER phone NOR email with any other lead.
  // (Catches dups that share a phone but have distinct emails — which a per-key check would miss.)
  const sharedLeadIds = new Set<string>()
  for (const l of all) {
    const p = normMatchPhone(l.phone), e = normMatchEmail(l.email)
    if ((p && (phoneCount.get(p) ?? 0) > 1) || (e && (emailCount.get(e) ?? 0) > 1)) sharedLeadIds.add(l.id)
  }

  const claimed = new Set<string>()
  const linked: Array<{ pageId: string; leadId: string }> = []
  let ambiguous = 0, conflicts = 0
  const nowIso = new Date().toISOString()

  for (const page of pages) {
    if (linkedPageIds.has(page.id)) continue // page already owned by a lead → never re-link
    const pPhone = normMatchPhone(readNotionContact(page.properties, 'Phone'))
    const pEmail = normMatchEmail(readNotionContact(page.properties, 'Email'))
    // Resolve a candidate ONLY via a globally-unique contact (count === 1) whose owner is still unlinked.
    const phoneLead = pPhone && phoneCount.get(pPhone) === 1 && !phoneOwner.get(pPhone)!.linked ? phoneOwner.get(pPhone)!.id : null
    const emailLead = pEmail && emailCount.get(pEmail) === 1 && !emailOwner.get(pEmail)!.linked ? emailOwner.get(pEmail)!.id : null
    const sharedKey = (!!pPhone && (phoneCount.get(pPhone) ?? 0) > 1) || (!!pEmail && (emailCount.get(pEmail) ?? 0) > 1)
    if (phoneLead && emailLead && phoneLead !== emailLead) { ambiguous++; continue } // phone & email point to different leads
    const leadId = phoneLead || emailLead
    if (!leadId) { if (sharedKey) ambiguous++; continue } // no unique unlinked owner (shared/duplicate) → skip
    if (sharedLeadIds.has(leadId)) { ambiguous++; continue } // lead shares its OTHER contact with someone → dup-unsafe, skip
    if (claimed.has(leadId)) { ambiguous++; continue } // lead already matched by another page this run

    if (mode === 'log') {
      claimed.add(leadId)
      linked.push({ pageId: page.id, leadId })
      await logSync(client, { studio_id: studioId, lead_id: leadId, notion_page_id: page.id, action: 'skip', detail: { mode: 'log', op: 'link' } }, 'notion_to_app')
      continue
    }
    const { data: upd, error } = await client.from('leads')
      .update({ notion_page_id: page.id, notion_last_edited_time: page.last_edited_time, notion_last_synced_at: nowIso })
      .eq('id', leadId).eq('studio_id', studioId).is('notion_page_id', null)
      .select('id')
    if (error) {
      conflicts++
      await logSync(client, { studio_id: studioId, lead_id: leadId, notion_page_id: page.id, action: 'skip', detail: { op: 'link', error: error.message } }, 'notion_to_app')
      continue
    }
    if (!upd || upd.length === 0) continue // already linked by another process — skip silently
    claimed.add(leadId)
    linked.push({ pageId: page.id, leadId })
    await logSync(client, { studio_id: studioId, lead_id: leadId, notion_page_id: page.id, action: 'update', detail: { op: 'link' } }, 'notion_to_app')
  }
  return { linked, ambiguous, conflicts }
}

// ───────────────── Create-from-unmatched (INSERT-ONLY, per-studio gated) ─────────────────
// Mirrors scripts/import-notion-leads-schaumburg.mjs row building exactly: same enum props
// (level reads the EMPTY-NAME '' select), same checkboxes, same date handling, created_at from
// the page's created_time, created_by_email = 'import'; ghl_contact_id/tick intentionally unset.

// Apostrophe-normalize + NFC + collapse whitespace + lowercase — the importer's fuzzy key.
const aposNorm = (s: string): string =>
  s.replace(/’/g, "'").normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
// Explicit, deliberate label-drift remap (parity with the importer). NOT a silent guess.
const ENUM_REMAP: Record<string, Record<string, string>> = { level: { lost: 'Loss' } }
const ENUM_PROPS: Array<[string, string]> = [
  ['Status', 'status'], ['', 'level'], ['Action', 'action'],
  ['Source', 'source'], ['Reason', 'reason'], ['Partnership', 'partnership'],
]
const CHECKBOX_PROPS: Array<[string, string]> = [
  ['Showed', 'showed'], ['Bought', 'bought'], ['OLD', 'old'], ['Texted', 'texted'],
]

// Build an enum resolver from the pull's labelToId map: exact (case-sensitive) → remap → fuzzy.
// Unresolved → null (FK-safe). Same precedence as the importer's buildResolver.
function buildEnumResolver(labelToId: Map<string, string>): (field: string, label: string) => string | null {
  const fuzzy = new Map<string, string>()
  for (const [key, id] of labelToId) {
    const i = key.indexOf(':')
    if (i < 0) continue
    fuzzy.set(`${key.slice(0, i)}:${aposNorm(key.slice(i + 1))}`, id)
  }
  return (field, label) => {
    if (label == null) return null
    const raw = String(label)
    const e = labelToId.get(`${field}:${raw}`)
    if (e) return e
    const remapped = ENUM_REMAP[field]?.[aposNorm(raw)]
    if (remapped) {
      const r = labelToId.get(`${field}:${remapped}`)
      if (r) return r
    }
    return fuzzy.get(`${field}:${aposNorm(raw)}`) ?? null
  }
}

/**
 * INSERT-ONLY: create a Supabase lead for any Notion page that has no matching lead.
 * Per-studio gated by the caller (studios.notion_create_unmatched). Operates ONLY on the pages
 * the pull already fetched — NEVER calls Notion, NEVER updates/deletes an existing lead.
 *
 * Skips, in order, per page:
 *  - archived/trashed pages
 *  - pages already linked to a lead (linkedPageIds)
 *  - empty pages (no name AND no phone AND no email)
 *  - DEDUP GUARD: pages whose normalized phone OR email already belongs to ANY existing lead in
 *    this studio (catches unlinked dups the linker won't touch — shared/ambiguous contacts).
 *
 * 'log' mode = dry-run: counts what it WOULD create (under `created`) and logs it, inserts nothing.
 * 'live' mode = one row at a time, each guarded by try/catch + .select('id'); a unique-index hit on
 * notion_page_id is caught/logged, never thrown. All writes logged to notion_sync_log.
 */
export async function createUnmatchedLeads(
  client: SupabaseClient, studioId: string, pages: any[], linkedPageIds: Set<string>,
  tz: string, labelToId: Map<string, string>,
): Promise<{ created: number; skipped_dup: number; skipped_empty: number; skipped_archived: number; errors: number }> {
  const result = { created: 0, skipped_dup: 0, skipped_empty: 0, skipped_archived: 0, errors: 0 }
  const mode = notionSyncMode()
  if (mode === 'off') return result

  const resolve = buildEnumResolver(labelToId)

  // DEDUP GUARD: load ALL of this studio's leads' normalized phone + email ONCE (page through like
  // linkUnlinkedLeads). A page whose contact already exists (linked or not) is never duplicated.
  const existingPhones = new Set<string>()
  const existingEmails = new Set<string>()
  let from = 0
  for (;;) {
    const { data } = await client.from('leads').select('phone,email')
      .eq('studio_id', studioId).range(from, from + 999)
    for (const l of (data ?? []) as Array<{ phone: string | null; email: string | null }>) {
      const p = normMatchPhone(l.phone); if (p) existingPhones.add(p)
      const e = normMatchEmail(l.email); if (e) existingEmails.add(e)
    }
    if (!data || data.length < 1000) break
    from += 1000
  }

  for (const page of pages) {
    if (page.archived === true || page.in_trash === true) { result.skipped_archived++; continue }
    if (linkedPageIds.has(page.id)) continue // already owned by a lead → never duplicate

    const props = page.properties ?? {}
    const name = (readNotionContact(props, 'Name') ?? '').trim() || null
    const phone = normalizePhone(readNotionContact(props, 'Phone'))
    const email = normalizeEmail(readNotionContact(props, 'Email'))
    if (!name && !phone && !email) { result.skipped_empty++; continue }

    // DEDUP GUARD: normalized phone OR email already belongs to an existing lead → skip.
    const mPhone = normMatchPhone(phone), mEmail = normMatchEmail(email)
    if ((mPhone && existingPhones.has(mPhone)) || (mEmail && existingEmails.has(mEmail))) {
      result.skipped_dup++
      await logSync(client, { studio_id: studioId, lead_id: null, notion_page_id: page.id, action: 'skip', detail: { op: 'create', reason: 'dup_contact_exists' } }, 'notion_to_app')
      continue
    }

    // Build the row exactly like the importer (nulls stripped so DB defaults apply).
    const row: Record<string, unknown> = {
      studio_id: studioId,
      name, phone, email,
      comments: readNotionProp(props, 'Comments', 'text'),
      available: readNotionProp(props, 'Available', 'text'),
      notion_page_id: page.id,
      notion_last_edited_time: page.last_edited_time ?? null,
      notion_last_synced_at: new Date().toISOString(),
      notion_archived_at: null,
      created_by_email: 'import',
      created_at: page.created_time ?? null, // preserve Notion chronology (else collapses to now())
      // ghl_contact_id / tick: intentionally NOT set — let the DB defaults apply.
    }
    for (const [propName, field] of ENUM_PROPS) {
      const label = readNotionProp(props, propName, 'select')
      if (label == null || label === '') continue
      const id = resolve(field, String(label))
      if (id) row[field] = id // unresolved → leave null (FK-safe)
    }
    for (const [propName, field] of CHECKBOX_PROPS) row[field] = Boolean(readNotionProp(props, propName, 'checkbox'))
    row.last_contacted = studioMidnightIso(readNotionProp(props, 'Last Contacted', 'date'), tz)
    row.first_lesson = studioMidnightIso(readNotionProp(props, 'First Lesson', 'date'), tz)
    const insertRow = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null))

    if (mode === 'log') {
      result.created++ // count would-create for the dry-run report
      await logSync(client, { studio_id: studioId, lead_id: null, notion_page_id: page.id, action: 'skip', detail: { mode: 'log', op: 'create', name } }, 'notion_to_app')
      continue
    }

    try {
      const { data: ins, error } = await client.from('leads').insert(insertRow).select('id')
      if (error) {
        result.errors++
        await logSync(client, { studio_id: studioId, lead_id: null, notion_page_id: page.id, action: 'error', detail: { op: 'create', message: error.message } }, 'notion_to_app')
        continue
      }
      result.created++
      // Pre-register this contact so a duplicate Notion page later in the same run is skipped.
      if (mPhone) existingPhones.add(mPhone)
      if (mEmail) existingEmails.add(mEmail)
      const newLeadId = (ins?.[0] as { id?: string } | undefined)?.id ?? null
      await logSync(client, { studio_id: studioId, lead_id: newLeadId, notion_page_id: page.id, action: 'create', detail: { op: 'create', name } }, 'notion_to_app')
      try {
        await client.from('activity_logs').insert({
          studio_id: studioId, lead_id: newLeadId, lead_name: name,
          actor_email: null, event_type: 'create', source: 'notion',
        })
      } catch { /* logging is best-effort */ }
    } catch (e) {
      result.errors++
      await logSync(client, { studio_id: studioId, lead_id: null, notion_page_id: page.id, action: 'error', detail: { op: 'create', message: String(e) } }, 'notion_to_app')
    }
  }
  return result
}

/**
 * Pull Notion edits into Supabase for one studio's linked leads.
 * Echo suppression = value comparison: only writes a field when Notion ≠ Supabase, so a prior
 * app→Notion push that already matched never bounces back. Writes go DIRECT to the leads table
 * (bypassing updateLead) so they never re-trigger the app→Notion push. Non-fatal; logs everything.
 */
export async function syncNotionToSupabase(client: SupabaseClient, studioId: string): Promise<{ checked: number; changed: number; skipped: number; unmatched_selects: string[]; linked: number; link_ambiguous: number; link_conflicts: number; created: number; create_skipped_dup: number; create_skipped_empty: number; create_skipped_archived: number; create_errors: number }> {
  const mode = notionSyncMode()
  const empty = {
    checked: 0, changed: 0, skipped: 0, unmatched_selects: [] as string[],
    linked: 0, link_ambiguous: 0, link_conflicts: 0,
    created: 0, create_skipped_dup: 0, create_skipped_empty: 0, create_skipped_archived: 0, create_errors: 0,
  }
  if (mode === 'off') return empty

  const { data: studio } = await client.from('studios').select('notion_leads_db_id,timezone,notion_create_unmatched').eq('id', studioId).single()
  const dbId = (studio as { notion_leads_db_id: string | null; timezone?: string } | null)?.notion_leads_db_id
  const tz = (studio as { timezone?: string } | null)?.timezone ?? 'UTC'
  const createUnmatched = (studio as { notion_create_unmatched?: boolean } | null)?.notion_create_unmatched === true
  if (!dbId) return empty

  const { data: opts } = await client.from('studio_field_options').select('id,field,value').eq('studio_id', studioId)
  const labelToId = new Map<string, string>()
  const idToLabel = new Map<string, string>()
  for (const o of (opts ?? []) as { id: string; field: string; value: string }[]) {
    labelToId.set(`${o.field}:${o.value}`, o.id)
    idToLabel.set(o.id, o.value)
  }

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

  // Auto-link unlinked leads to their Notion page (ongoing backfill), then pull values for the
  // freshly-linked leads in this same run by adding them to leadByPage before the sync loop.
  const linkResult = await linkUnlinkedLeads(client, studioId, pages, new Set(leadByPage.keys()))
  if (mode !== 'log' && linkResult.linked.length > 0) {
    const ids = linkResult.linked.map((l) => l.leadId)
    const freshById = new Map<string, any>()
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await client.from('leads').select(cols).in('id', ids.slice(i, i + 500))
      for (const l of (data ?? []) as any[]) freshById.set(l.id, l)
    }
    for (const { pageId, leadId } of linkResult.linked) {
      const l = freshById.get(leadId)
      if (l) leadByPage.set(pageId, l)
    }
  }

  // Create-from-unmatched (INSERT-ONLY) — per-studio gated, AFTER linking so links take precedence.
  // leadByPage now contains every page that owns a lead (existing + freshly-linked); pass its keys
  // so an already-linked page is never duplicated.
  const createResult = createUnmatched
    ? await createUnmatchedLeads(client, studioId, pages, new Set(leadByPage.keys()), tz, labelToId)
    : { created: 0, skipped_dup: 0, skipped_empty: 0, skipped_archived: 0, errors: 0 }

  const unmatched = new Set<string>()
  const logRows: Array<Record<string, unknown>> = []
  const activityRows: Array<Record<string, unknown>> = []
  const pushLog = (lead_id: string, notion_page_id: string, action: SyncAction, detail: unknown) =>
    logRows.push({ studio_id: studioId, lead_id, notion_page_id, direction: 'notion_to_app', action, detail })
  let checked = 0, changed = 0, skipped = 0

  for (const page of pages) {
    const lead = leadByPage.get(page.id)
    if (!lead) continue
    checked++
    const { update, detail } = buildLeadUpdateFromPage(page.properties, lead, labelToId, unmatched, tz)
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
      const activityRow = buildNotionActivityRow(studioId, lead, update, idToLabel)
      if (activityRow) activityRows.push(activityRow)
      changed++
    }
  }

  // Batch-insert the sync log + activity log (best-effort).
  for (let i = 0; i < logRows.length; i += 500) {
    try { await client.from('notion_sync_log').insert(logRows.slice(i, i + 500)) } catch { /* non-fatal */ }
  }
  for (let i = 0; i < activityRows.length; i += 500) {
    try { await client.from('activity_logs').insert(activityRows.slice(i, i + 500)) } catch { /* non-fatal */ }
  }
  return {
    checked, changed, skipped, unmatched_selects: [...unmatched],
    linked: linkResult.linked.length, link_ambiguous: linkResult.ambiguous, link_conflicts: linkResult.conflicts,
    created: createResult.created, create_skipped_dup: createResult.skipped_dup,
    create_skipped_empty: createResult.skipped_empty, create_skipped_archived: createResult.skipped_archived,
    create_errors: createResult.errors,
  }
}
