// Action reconciliation — Notion-authoritative for ALL linked leads (client maintains Notion Action).
// Supersedes the earlier call-derived approach. SAFE BY DEFAULT: dry-run unless --apply.
// Keyed on notion_page_id (set by L0). Captures original action UUID for rollback.

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
const nval = p => { if (!p) return null; const t = p.type, v = p[t]; return t === 'select' ? (v?.name ?? null) : null }

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

const { data: opts } = await supa.from('studio_field_options').select('id,value').eq('studio_id', STUDIO).eq('field', 'action')
const valToId = new Map(opts.map(o => [o.value, o.id]))
const idToVal = new Map(opts.map(o => [o.id, o.value]))

let leads = [], from = 0
for (;;) {
  const { data, error } = await supa.from('leads').select('id,name,action,notion_page_id').eq('studio_id', STUDIO).not('notion_page_id', 'is', null).range(from, from + 999)
  if (error) throw error
  leads.push(...data); if (data.length < 1000) break; from += 1000
}

const notion = await pullNotion()
const pageAction = new Map()
for (const pg of notion) pageAction.set(pg.id, nval(pg.properties['Action']))

const changes = [], missingOpt = new Set()
for (const l of leads) {
  const notionAction = pageAction.get(l.notion_page_id)
  if (!notionAction) continue                        // Notion has no Action -> leave as-is
  const cur = l.action ? idToVal.get(l.action) ?? null : null
  if (notionAction === cur) continue
  if (!valToId.has(notionAction)) { missingOpt.add(notionAction); continue }
  changes.push({ id: l.id, name: l.name, from: cur, to: notionAction, from_action_id: l.action })
}

mkdirSync('.notion-audit', { recursive: true })
writeFileSync('.notion-audit/action-reconcile-plan.json', JSON.stringify({ count: changes.length, changes }, null, 2))

if (APPLY) {
  for (const c of changes) {
    const { error } = await supa.from('leads').update({ action: valToId.get(c.to) }).eq('id', c.id).eq('studio_id', STUDIO)
    if (error) throw new Error(`action ${c.id}: ${error.message}`)
  }
}

console.log(APPLY ? '=== ACTION RECONCILED (Notion-authoritative) ===' : '=== DRY RUN (no writes) — pass --apply ===')
console.log('Linked leads checked:', leads.length)
console.log('Action changes (Supabase -> Notion value):', changes.length)
console.log('Notion Action values missing from options:', missingOpt.size ? [...missingOpt] : 'none')
console.log('Sample:')
for (const c of changes.slice(0, 15)) console.log(`  ${c.name}: ${c.from ?? '(empty)'} -> ${c.to}`)
console.log('Plan saved -> .notion-audit/action-reconcile-plan.json')
