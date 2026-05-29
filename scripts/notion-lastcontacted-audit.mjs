// READ-ONLY: compare Notion "Last Contacted" vs Supabase last_contacted for linked leads.
// Helps decide Notion-authoritative vs calls-authoritative. Writes nothing.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const STUDIO = '71274499-7c29-4621-990f-b60669ed1de3'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const NOTION = env.NOTION_API_KEY, DB = env.NOTION_DB_LINCOLNSHIRE
const ndate = p => (p && p.type === 'date') ? (p.date?.start ?? null) : null

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

// leads linked to notion + whether they have a call
let leads = [], from = 0
for (;;) {
  const { data, error } = await supa.from('leads').select('id,name,last_contacted,notion_page_id').eq('studio_id', STUDIO).not('notion_page_id', 'is', null).range(from, from + 999)
  if (error) throw error
  leads.push(...data); if (data.length < 1000) break; from += 1000
}
const { data: callRows } = await supa.from('calls').select('lead_id').eq('studio_id', STUDIO).not('lead_id', 'is', null)
const hasCall = new Set(callRows.map(c => c.lead_id))

const notion = await pullNotion()
const pageLC = new Map()
for (const pg of notion) pageLC.set(pg.id, ndate(pg.properties['Last Contacted']))

let notionHas = 0, notionNull = 0, differ = 0, calledLeads = 0, calledWithNotionLC = 0, calledWithoutNotionLC = 0
const toDay = s => (s ? String(s).slice(0, 10) : null)
for (const l of leads) {
  const nlc = pageLC.get(l.notion_page_id)
  if (nlc) notionHas++; else notionNull++
  if (toDay(nlc) !== toDay(l.last_contacted)) differ++
  if (hasCall.has(l.id)) {
    calledLeads++
    if (nlc) calledWithNotionLC++; else calledWithoutNotionLC++
  }
}
console.log('=== Last Contacted: Notion vs Supabase (READ-ONLY) ===')
console.log('Linked leads:', leads.length)
console.log('Notion HAS Last Contacted:', notionHas, '| Notion NULL:', notionNull)
console.log('Differ (by day) Notion vs Supabase:', differ)
console.log('--- called leads (have >=1 call) ---')
console.log('called & linked:', calledLeads)
console.log('  of those, Notion HAS Last Contacted:', calledWithNotionLC)
console.log('  of those, Notion has NONE (would go blank if pure-Notion):', calledWithoutNotionLC)
