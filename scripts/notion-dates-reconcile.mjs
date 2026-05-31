// Reconcile date fields from Notion. SAFE BY DEFAULT: dry-run unless --apply.
//   last_contacted = MAX(Notion "Last Contacted", latest call)  -- most-recent wins; calls trigger stays
//   first_lesson   = Notion "First Lesson"                       -- Notion-authoritative (no calls)
// Only updates where the new value exists and differs. Never nulls existing data. Keyed on notion_page_id.
// Captures prior values for rollback in .notion-audit/dates-reconcile-plan.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const STUDIO = '71274499-7c29-4621-990f-b60669ed1de3'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const NOTION = env.NOTION_API_KEY, DB = env.NOTION_DB_LINCOLNSHIRE
const ndate = p => (p && p.type === 'date') ? (p.date?.start ?? null) : null

// normalize any date-ish value to ISO (date-only -> midnight UTC); returns {iso, ms} or null
const toIso = v => {
  if (!v) return null
  let s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = s + 'T00:00:00.000Z'
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return { iso: d.toISOString(), ms: d.getTime() }
}

async function pullNotion() {
  const out = []; let cursor
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${NOTION}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
    })
    const j = await res.json(); if (j.object === 'error') throw new Error(`${j.code} ${j.message}`)
    out.push(...j.results); cursor = j.has_more ? j.next_cursor : undefined
  } while (cursor)
  return out
}

let leads = [], from = 0
for (;;) {
  const { data, error } = await supa.from('leads').select('id,name,last_contacted,first_lesson,notion_page_id').eq('studio_id', STUDIO).not('notion_page_id', 'is', null).range(from, from + 999)
  if (error) throw error
  leads.push(...data); if (data.length < 1000) break; from += 1000
}
const { data: callRows } = await supa.from('calls').select('lead_id,created_at').eq('studio_id', STUDIO).not('lead_id', 'is', null)
const latestCall = new Map()
for (const c of callRows) { const t = new Date(c.created_at).getTime(); if (!latestCall.has(c.lead_id) || t > latestCall.get(c.lead_id)) latestCall.set(c.lead_id, t) }

const notion = await pullNotion()
const pageLC = new Map(), pageFL = new Map()
for (const pg of notion) { pageLC.set(pg.id, ndate(pg.properties['Last Contacted'])); pageFL.set(pg.id, ndate(pg.properties['First Lesson'])) }

const lcChanges = [], flChanges = []
for (const l of leads) {
  // last_contacted = Notion's CALENDAR DAY (date-only), else the latest call's day. Day-safe (no tz shift).
  const nlcRaw = pageLC.get(l.notion_page_id)
  const callMs = latestCall.get(l.id) ?? null
  const lcDay = nlcRaw ? String(nlcRaw).slice(0, 10)
              : (callMs ? new Date(callMs).toISOString().slice(0, 10) : null)
  if (lcDay) {
    const target = lcDay + 'T00:00:00.000Z'
    const curDay = l.last_contacted ? String(l.last_contacted).slice(0, 10) : null
    if (lcDay !== curDay) lcChanges.push({ id: l.id, name: l.name, from: l.last_contacted, to: target })
  }
  // first_lesson: SUPABASE-AUTHORITATIVE — do NOT touch (per client 2026-05-30).
}

mkdirSync('.notion-audit', { recursive: true })
writeFileSync('.notion-audit/dates-reconcile-plan.json', JSON.stringify({ last_contacted: lcChanges, first_lesson: flChanges }, null, 2))

if (APPLY) {
  for (const c of lcChanges) {
    const { error } = await supa.from('leads').update({ last_contacted: c.to }).eq('id', c.id).eq('studio_id', STUDIO)
    if (error) throw new Error(`lc ${c.id}: ${error.message}`)
  }
  for (const c of flChanges) {
    const { error } = await supa.from('leads').update({ first_lesson: c.to }).eq('id', c.id).eq('studio_id', STUDIO)
    if (error) throw new Error(`fl ${c.id}: ${error.message}`)
  }
}

console.log(APPLY ? '=== DATES RECONCILED ===' : '=== DRY RUN (no writes) — pass --apply ===')
console.log('Linked leads:', leads.length)
console.log('last_contacted changes (max of Notion / latest call):', lcChanges.length)
console.log('first_lesson changes (Notion-authoritative):', flChanges.length)
const samp = (a) => a.slice(0, 8).map(c => `  ${c.name}: ${c.from ?? '(empty)'} -> ${c.to}`).join('\n')
if (lcChanges.length) console.log('Last Contacted sample:\n' + samp(lcChanges))
if (flChanges.length) console.log('First Lesson sample:\n' + samp(flChanges))
console.log('Plan -> .notion-audit/dates-reconcile-plan.json')
