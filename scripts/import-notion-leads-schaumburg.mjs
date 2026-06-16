// One-time Notion -> Supabase lead import for Arthur Murray Schaumburg.
//
// SAFE BY DEFAULT: dry-run unless --apply.
//   - Dry run  : reads Notion + Supabase, writes ONLY .notion-audit/schaumburg-import-plan.json. NO DB writes.
//   - --apply  : pre-count + backup snapshot -> .notion-audit/backup-leads-schaumburg-<date>.json,
//                then an INSERT-ONLY upsert (onConflict notion_page_id, ignoreDuplicates),
//                then a post-count assert.
//
// HARD SAFETY RAILS (project memory rules — non-negotiable):
//   - Notion is READ-ONLY here. Never PATCH/POST/modify a Notion page. GET / query only.
//   - Supabase is INSERT-ONLY. Never .update()/.delete() or otherwise modify an existing lead row.
//     The ONLY permitted write is the insert/upsert with ignoreDuplicates (= ON CONFLICT (notion_page_id) DO NOTHING).
//   - .notion-audit/ is gitignored and holds lead PII — never commit it.
//   - Service-role client with persistSession:false (bypasses RLS for the cross-studio seed). Never expose to a browser.
//   - NEVER print or echo a secret.
//
// Self-contained ESM (.mjs cannot import the .ts modules), so the helpers below are inlined copies of
// lib/notion.ts (stripNotionUrl, normalizePhone, readNotionContact, readNotionProp, labelToId builder)
// and lib/date-utils.ts (tzOffsetMsAt / studioMidnightFromStr / tzCalendarParts), with byte-equivalent
// behavior plus a case-insensitive + trimmed + apostrophe-normalized fallback resolver on top of the exact match.
//
// Usage:
//   node scripts/import-notion-leads-schaumburg.mjs            # dry run (default)
//   node scripts/import-notion-leads-schaumburg.mjs --apply    # perform the import

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ───────────────────────────── Constants ─────────────────────────────
const STUDIO = 'aeefb977-5d03-4e40-994a-327cb51b7918'        // Arthur Murray Schaumburg
// VALIDATED (live, HTTP 200 with the shared NOTION_API_KEY): the readable, populated 739-page
// "SCHAUMBURG INQUIRY MASTER LIST" is this id. It is the current .env NOTION_DB_SCHAUMBURG value too, but
// we HARDCODE it here (not read the env var) to eliminate any stale-id risk. The build-log id
// (…8184-8c81-…) 404s and is WRONG — do NOT use it.
const DB = '14a71c37-5730-80df-ab57-eabb597f5775'
const TZ = 'America/Chicago'
const APPLY = process.argv.includes('--apply')
const NOTION_VERSION = '2022-06-28'
const AUDIT_DIR = '.notion-audit'
const PLAN_PATH = `${AUDIT_DIR}/schaumburg-import-plan.json`

// ───────────────────────────── .env loader (house style) ─────────────────────────────
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
// Prefer the Schaumburg-specific token if present, else fall back to the shared app token.
const NOTION = env.NOTION_API_KEY_SCHAUMBURG || env.NOTION_API_KEY
if (!NOTION) throw new Error('Notion token missing: set NOTION_API_KEY_SCHAUMBURG or NOTION_API_KEY in .env')
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Supabase config missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')

const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ───────────────────────────── Inlined date helpers (lib/date-utils.ts) ─────────────────────────────
// tzOffsetMsAt + studioMidnightFromStr + tzCalendarParts: byte-equivalent copies, DST-correct.
function tzOffsetMsAt(tz, instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instant)
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const hh = p.hour === '24' ? '00' : p.hour   // ICU may render local midnight as "24:00" — normalize so the offset calc doesn't roll forward a day (mirrors tzCalendarParts)
  const localAsUtc = new Date(`${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}Z`).getTime()
  return localAsUtc - instant.getTime()
}

/** Returns the UTC Date for midnight on the YYYY-MM-DD date string in `tz`. */
function studioMidnightFromStr(dateStr, tz) {
  const midnightUtc = new Date(dateStr + 'T00:00:00Z').getTime()
  const offset1 = tzOffsetMsAt(tz, new Date(dateStr + 'T12:00:00Z'))
  const guess = new Date(midnightUtc - offset1)
  const offset2 = tzOffsetMsAt(tz, guess)
  if (offset1 === offset2) return guess
  return new Date(midnightUtc - offset2)
}

/** Calendar parts of a UTC instant as seen in `tz` (year, 0-based month, day, hour, minute). */
function tzCalendarParts(d, tz) {
  const date = typeof d === 'string' ? new Date(d) : d
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    year: parseInt(p.year, 10),
    month: parseInt(p.month, 10) - 1,
    day: parseInt(p.day, 10),
    hour: parseInt(p.hour === '24' ? '0' : p.hour, 10),
    minute: parseInt(p.minute, 10),
  }
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * Convert a Notion date property value into the studio-local-midnight UTC ISO the app stores.
 * Per the data-shape report, BOTH last_contacted and first_lesson are imported as studio-local midnight
 * on the .slice(0,10) calendar day — the 3 First-Lesson rows that carry a T-timestamp collapse to midnight
 * exactly like every other row (studioMidnightFromStr(value.slice(0,10), tz)). DST-correct.
 */
function studioMidnightIso(rawStart, tz) {
  if (!rawStart) return null
  return studioMidnightFromStr(String(rawStart).slice(0, 10), tz).toISOString()
}

// ───────────────────────────── Inlined Notion helpers (lib/notion.ts) ─────────────────────────────
/** Strip a notion.so/.com URL glued onto a value with no separator (Notion "URL-name" contamination). */
const stripNotionUrl = (s) =>
  String(s ?? '').replace(/https?:\/\/(www\.)?(app\.)?notion\.(so|com)/gi, '').trim()

/** E.164 normalization for US numbers. Returns "+1XXXXXXXXXX" or null. Mirrors the app's normalizePhone. */
function normalizePhone(raw) {
  const d = stripNotionUrl(raw).replace(/\D/g, '')
  if (!d) return null
  const x = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return x.length === 10 ? `+1${x}` : null
}

/** Email normalization: strip notion-url, lowercase, keep the first @-bearing token. Else null. */
function normalizeEmail(raw) {
  const s = stripNotionUrl(raw).toLowerCase()
  return s.split(/\s+/).find((t) => t.includes('@')) ?? null
}

/** Read a contact-ish Notion property (phone_number / email / rich_text / title). */
function readNotionContact(props, name) {
  const p = props?.[name]
  if (!p) return null
  if (p.type === 'phone_number') return p.phone_number || null
  if (p.type === 'email') return p.email || null
  if (p.type === 'rich_text') return (p.rich_text ?? []).map((t) => t.plain_text).join('').trim() || null
  if (p.type === 'title') return (p.title ?? []).map((t) => t.plain_text).join('').trim() || null
  return null
}

/** Read a typed Notion property. Mirrors lib/notion.ts readNotionProp. */
function readNotionProp(props, name, kind) {
  const p = props?.[name]
  if (!p) return kind === 'checkbox' ? false : null
  if (kind === 'title') return (p.title ?? []).map((t) => t.plain_text).join('').trim() || null
  if (kind === 'text') return (p.rich_text ?? []).map((t) => t.plain_text).join('').trim() || null
  if (kind === 'select') return p.select?.name ?? null
  if (kind === 'checkbox') return Boolean(p.checkbox)
  if (kind === 'date') return p.date?.start ?? null
  return null
}

// ───────────────────────────── Notion paginator (READ-ONLY) ─────────────────────────────
// POST /databases/{id}/query, page_size 100, loop on has_more/next_cursor. Query excludes Trash by default.
async function pullNotion(dbId) {
  const out = []
  let cursor
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NOTION}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
    })
    const j = await res.json()
    if (j.object === 'error') throw new Error(`Notion query failed: ${res.status} ${j.code} ${j.message ?? ''}`)
    out.push(...j.results)
    cursor = j.has_more ? j.next_cursor : undefined
  } while (cursor)
  return out
}

// ───────────────────────────── Enum resolver (labelToId + fallback) ─────────────────────────────
// Apostrophe-normalize: curly U+2019 -> straight U+0027, NFC, collapse whitespace, lowercase.
const apos = (s) => s.replace(/’/g, "'")
const normKey = (s) => apos(String(s)).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

// Explicit, deliberate remap (validated against live data). NOT a silent guess:
//   level "Lost" (4 rows) -> "Loss"   (Supabase seeded the option as "Loss"; label drift only, same semantic)
// Casing-only deltas ("phone call"->"Phone Call", source "Phone"->"phone") resolve via the case-insensitive
// fallback below — not here. Judgment-call gaps (source "Online" x730, action "Promising" x17, level "Gift")
// are intentionally NOT remapped: they fall through to unmatched + log, per the spec's leave-null default.
const REMAP = {
  level: { lost: 'Loss' },
}

function buildResolver(options) {
  const exact = new Map()   // `${field}:${value}` -> id          (parity with lib/notion.ts, case-sensitive)
  const fuzzy = new Map()   // `${field}:${normKey(value)}` -> id (case/trim/apostrophe fallback)
  for (const o of options) {
    exact.set(`${o.field}:${o.value}`, o.id)
    fuzzy.set(`${o.field}:${normKey(o.value)}`, o.id)
  }
  // resolve(field, label) -> { id, how } | null
  return function resolve(field, label) {
    if (label == null) return null
    const raw = String(label)
    // 1) exact (case-sensitive) — parity with the live sync
    const e = exact.get(`${field}:${raw}`)
    if (e) return { id: e, how: 'exact' }
    // 2) explicit remap table -> exact
    const remapped = REMAP[field]?.[normKey(raw)]
    if (remapped) {
      const r = exact.get(`${field}:${remapped}`)
      if (r) return { id: r, how: `remap:${remapped}` }
    }
    // 3) case/trim/apostrophe-normalized fallback
    const f = fuzzy.get(`${field}:${normKey(raw)}`)
    if (f) return { id: f, how: 'fuzzy' }
    return null
  }
}

// Notion select property name -> Supabase enum field. Level reads the EMPTY-NAME ('') select
// (lead-stage: Inquiry/Front/Middle/Back/Guest/Lost/Gift) — NOT the literal "Level" property (dance grade).
const ENUM_PROPS = [
  ['Status', 'status'],
  ['', 'level'],
  ['Action', 'action'],
  ['Source', 'source'],
  ['Reason', 'reason'],
  ['Partnership', 'partnership'],
]
const CHECKBOX_PROPS = [
  ['Showed', 'showed'],
  ['Bought', 'bought'],
  ['OLD', 'old'],
  ['Texted', 'texted'],
]

// ───────────────────────────── Supabase pre-flight reads ─────────────────────────────
async function loadFieldOptions() {
  const { data, error } = await supa
    .from('studio_field_options').select('id,field,value').eq('studio_id', STUDIO)
  if (error) throw error
  return data ?? []
}

async function loadExistingPageIds() {
  const set = new Set()
  let from = 0
  for (;;) {
    const { data, error } = await supa
      .from('leads').select('notion_page_id')
      .eq('studio_id', STUDIO).not('notion_page_id', 'is', null).range(from, from + 999)
    if (error) throw error
    for (const r of data) if (r.notion_page_id) set.add(r.notion_page_id)
    if (data.length < 1000) break
    from += 1000
  }
  return set
}

async function countStudioLeads() {
  const { count, error } = await supa
    .from('leads').select('id', { count: 'exact', head: true }).eq('studio_id', STUDIO)
  if (error) throw error
  return count ?? 0
}

async function snapshotExistingLeads() {
  const leads = []
  let from = 0
  for (;;) {
    const { data, error } = await supa
      .from('leads').select('id,notion_page_id,name')
      .eq('studio_id', STUDIO).range(from, from + 999)
    if (error) throw error
    leads.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return leads
}

// ───────────────────────────── Row builder ─────────────────────────────
function buildRow(page, resolve, unmatched) {
  const props = page.properties ?? {}

  // Contact junk cleaning + normalization (every value runs through stripNotionUrl first).
  const name = (readNotionContact(props, 'Name') ?? '').trim()
  const phone = normalizePhone(readNotionContact(props, 'Phone'))
  const email = normalizeEmail(readNotionContact(props, 'Email'))
  const comments = readNotionProp(props, 'Comments', 'text')
  // 'Available' is ABSENT in the Schaumburg schema (validated). readNotionProp returns null for a missing
  // property, so available stays null on every row — harmless, kept for parity with the field map.
  const available = readNotionProp(props, 'Available', 'text')

  const row = {
    studio_id: STUDIO,
    name: name || null,   // null is stripped later so the NOT NULL DEFAULT '' applies
    phone,
    email,
    comments,
    available,
    notion_page_id: page.id,
    notion_last_edited_time: page.last_edited_time ?? null,
    notion_last_synced_at: new Date().toISOString(),
    notion_archived_at: null,
    created_by_email: 'import',
    // Preserve original chronology from Notion's native page.created_time (else rows collapse to now()).
    created_at: page.created_time ?? null,
    // ghl_contact_id: intentionally NOT set (column is UNIQUE; leave null).
    // tick: intentionally NOT set (NOT NULL DEFAULT false — let the DB default apply by omitting the key).
  }

  // Enum selects -> option UUIDs. Level reads the empty-name '' select (lead-stage), NOT 'Level' (dance grade).
  for (const [propName, field] of ENUM_PROPS) {
    const label = readNotionProp(props, propName, 'select')
    if (label == null || label === '') continue
    const hit = resolve(field, label)
    if (hit) {
      row[field] = hit.id
    } else {
      // Leave the field null (FK-safe) and record the gap. Never auto-seed, never cross-map.
      unmatched.push({ page_id: page.id, field, notion_label: label, codepoints: [...label].map((c) => c.codePointAt(0)) })
    }
  }

  // Checkboxes.
  for (const [propName, field] of CHECKBOX_PROPS) {
    row[field] = Boolean(readNotionProp(props, propName, 'checkbox'))
  }

  // Dates -> studio-local midnight UTC ISO (.slice(0,10) drops any time component on the 3 dated First Lessons).
  row.last_contacted = studioMidnightIso(readNotionProp(props, 'Last Contacted', 'date'), TZ)
  row.first_lesson = studioMidnightIso(readNotionProp(props, 'First Lesson', 'date'), TZ)

  return row
}

/** Drop null-valued keys so NOT-NULL-DEFAULT columns (name, created_at) take their DB defaults. */
function stripNulls(row) {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null))
}

// ───────────────────────────── Main ─────────────────────────────
const fieldOptions = await loadFieldOptions()
const resolve = buildResolver(fieldOptions)
const existingPageIds = await loadExistingPageIds()

const pages = await pullNotion(DB)

const unmatched = []           // { page_id, field, notion_label, codepoints }
const skipped_empty = []       // { page_id, name }
const skipped_archived = []    // { page_id }
const skipped_existing = []    // { page_id } — already linked (idempotency skip-set)
const plannedRows = []         // rows to insert (after stripNulls)
const plannedMeta = []         // { page_id, name, phone, email } parallel to plannedRows, for collision scan

for (const page of pages) {
  // Archived / trashed pages: never seed.
  if (page.archived === true || page.in_trash === true) {
    skipped_archived.push({ page_id: page.id })
    continue
  }
  // Idempotency: skip pages already imported for this studio.
  if (existingPageIds.has(page.id)) {
    skipped_existing.push({ page_id: page.id })
    continue
  }

  const row = buildRow(page, resolve, unmatched)

  // Empty/junk: no name AND no phone AND no email -> skip (no contactable identity). Couples stay ONE lead.
  if (!row.name && !row.phone && !row.email) {
    skipped_empty.push({ page_id: page.id, name: readNotionContact(page.properties ?? {}, 'Name') })
    continue
  }

  plannedMeta.push({ page_id: page.id, name: row.name, phone: row.phone, email: row.email })
  plannedRows.push(stripNulls(row))
}

// Collision scan (do NOT auto-merge — just surface for manual review).
function collisions(key) {
  const byVal = new Map()
  for (const m of plannedMeta) {
    const v = m[key]
    if (!v) continue
    if (!byVal.has(v)) byVal.set(v, [])
    byVal.get(v).push(m.page_id)
  }
  const out = []
  for (const [value, page_ids] of byVal) if (page_ids.length > 1) out.push({ value, page_ids })
  return out
}
const phone_collisions = collisions('phone')
const email_collisions = collisions('email')

// Aggregate the unmatched gap list for the plan (label-level summary + per-page detail).
const gapSummary = new Map()
for (const u of unmatched) {
  const k = `${u.field}:${u.notion_label}`
  if (!gapSummary.has(k)) gapSummary.set(k, { field: u.field, notion_label: u.notion_label, count: 0, sample_page_ids: [] })
  const g = gapSummary.get(k)
  g.count++
  if (g.sample_page_ids.length < 5) g.sample_page_ids.push(u.page_id)
}

const plan = {
  generated_at: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  studio_id: STUDIO,
  timezone: TZ,
  notion_db: DB,
  notion_pages_total: pages.length,
  planned_count: plannedRows.length,
  skipped_existing_count: skipped_existing.length,
  skipped_empty_count: skipped_empty.length,
  skipped_archived_count: skipped_archived.length,
  unmatched_summary: [...gapSummary.values()],
  unmatched,
  skipped_empty,
  skipped_archived,
  skipped_existing,
  phone_collisions,
  email_collisions,
  planned_rows: plannedRows,
}

mkdirSync(AUDIT_DIR, { recursive: true })
writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2))

console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (no DB writes) — pass --apply ===')
console.log('Notion DB             :', DB)
console.log('Notion pages total    :', pages.length)
console.log('Planned inserts       :', plannedRows.length)
console.log('Skipped (already imp.):', skipped_existing.length)
console.log('Skipped (empty)       :', skipped_empty.length)
console.log('Skipped (archived)    :', skipped_archived.length)
console.log('Unmatched enum labels :', gapSummary.size, '(' + [...gapSummary.values()].map((g) => `${g.field}:${g.notion_label} x${g.count}`).join(', ') + ')')
console.log('Phone collisions      :', phone_collisions.length)
console.log('Email collisions      :', email_collisions.length)
console.log('Plan written          :', PLAN_PATH)

if (!APPLY) {
  console.log('\nDry run complete. Review the plan, then re-run with --apply to write.')
} else {
  // ─── Backup + pre-count, then INSERT-ONLY upsert, then post-count assert. ───
  const pre_count = await countStudioLeads()
  const backup = await snapshotExistingLeads()
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const backupPath = `${AUDIT_DIR}/backup-leads-schaumburg-${date}.json`
  writeFileSync(backupPath, JSON.stringify({ studio_id: STUDIO, taken: new Date().toISOString(), pre_count, count: backup.length, leads: backup }, null, 2))
  console.log('Pre-count             :', pre_count)
  console.log('Backup snapshot       :', backupPath, `(${backup.length} rows)`)

  if (plannedRows.length === 0) {
    console.log('Nothing to insert. Done.')
  } else {
    // INSERT-ONLY. plannedRows already excludes existing notion_page_ids (pre-flight skip-set), so a
    // plain INSERT is correct here AND idempotent on re-run (skip-set makes plannedRows empty next time).
    // We do NOT use upsert/ON CONFLICT: leads.notion_page_id has a PARTIAL unique index
    // (WHERE notion_page_id IS NOT NULL, migration 034) that PostgREST cannot use as a conflict target.
    // NEVER updates/deletes a row.
    let attempted = 0
    for (let i = 0; i < plannedRows.length; i += 500) {
      const chunk = plannedRows.slice(i, i + 500)
      const { error } = await supa
        .from('leads').insert(chunk)
      if (error) throw new Error(`insert chunk @${i}: ${error.message}`)
      attempted += chunk.length
    }
    const post_count = await countStudioLeads()
    const inserted = post_count - pre_count
    console.log('Attempted (planned)   :', attempted)
    console.log('Post-count            :', post_count)
    console.log('Net inserted          :', inserted)
    // Assert: on a clean (0-existing) studio every planned row inserts. On a re-run, conflicts are
    // swallowed (ignoreDuplicates) so net inserted <= attempted — never negative, never more than attempted.
    if (inserted < 0 || inserted > attempted) {
      throw new Error(`SAFETY ASSERT FAILED: net inserted ${inserted} outside [0, ${attempted}].`)
    }
    if (inserted !== attempted) {
      console.log(`Note: ${attempted - inserted} planned row(s) were already present (conflict-skipped) — expected on a re-run.`)
    }
    console.log('=== IMPORT COMPLETE ===')
  }
}
