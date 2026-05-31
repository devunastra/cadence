// L0: link each Supabase lead to its Notion page (notion_page_id + notion_last_edited_time).
// SAFE BY DEFAULT: dry-run unless --apply. Matches by cleaned phone/email.
// Only writes the link columns (no business data). Logs nothing destructive.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const STUDIO = '71274499-7c29-4621-990f-b60669ed1de3'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const NOTION = env.NOTION_API_KEY, DB = env.NOTION_DB_LINCOLNSHIRE

const stripNotion = s => String(s ?? '').replace(/https?:\/\/(www\.)?(app\.)?notion\.(so|com)/gi, '').trim()
const normPhone = raw => { const d = stripNotion(raw).replace(/\D/g, ''); if (!d) return null; const x = (d.length === 11 && d[0] === '1') ? d.slice(1) : d; return x.length >= 10 ? x.slice(-10) : null }
const normEmail = raw => { const s = stripNotion(raw).toLowerCase(); return s.split(/\s+/).find(t => t.includes('@')) ?? null }
const nval = p => { if (!p) return null; const t = p.type, v = p[t]; if (t === 'phone_number' || t === 'email') return v || null; if (t === 'title' || t === 'rich_text') return ((v || []).map(x => x.plain_text).join('').trim()) || null; return null }

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
  const { data, error } = await supa.from('leads').select('id,name,phone,email,notion_page_id').eq('studio_id', STUDIO).range(from, from + 999)
  if (error) throw error
  leads.push(...data); if (data.length < 1000) break; from += 1000
}
const byPhone = new Map(), byEmail = new Map()
for (const l of leads) { const p = normPhone(l.phone); if (p && !byPhone.has(p)) byPhone.set(p, l); const e = normEmail(l.email); if (e && !byEmail.has(e)) byEmail.set(e, l) }

const notion = await pullNotion()
const plan = []                       // { lead_id, page_id, edited, name }
const leadToPage = new Map()          // detect a lead matched by >1 page
let alreadyLinked = 0, unmatched = 0, conflicts = 0
for (const page of notion) {
  const pr = page.properties
  const lead = (normPhone(nval(pr['Phone'])) && byPhone.get(normPhone(nval(pr['Phone'])))) ||
               (normEmail(nval(pr['Email'])) && byEmail.get(normEmail(nval(pr['Email'])))) || null
  if (!lead) { unmatched++; continue }
  if (lead.notion_page_id && lead.notion_page_id !== page.id) { conflicts++; continue } // already linked to a different page
  if (lead.notion_page_id === page.id) { alreadyLinked++; continue }
  if (leadToPage.has(lead.id)) { conflicts++; continue }   // two Notion pages -> same lead; skip the dup, flag
  leadToPage.set(lead.id, page.id)
  plan.push({ lead_id: lead.id, page_id: page.id, edited: page.last_edited_time, name: lead.name })
}

mkdirSync('.notion-audit', { recursive: true })
writeFileSync('.notion-audit/link-plan.json', JSON.stringify({ count: plan.length, plan }, null, 2))

if (APPLY) {
  for (const r of plan) {
    const { error } = await supa.from('leads')
      .update({ notion_page_id: r.page_id, notion_last_edited_time: r.edited, notion_last_synced_at: new Date().toISOString() })
      .eq('id', r.lead_id).eq('studio_id', STUDIO)
    if (error) throw new Error(`link ${r.lead_id}: ${error.message}`)
  }
}

console.log(APPLY ? '=== LINKS WRITTEN ===' : '=== DRY RUN (no writes) — pass --apply ===')
console.log('Notion pages:', notion.length, '| Supabase leads:', leads.length)
console.log('Will link (new):', plan.length)
console.log('Already linked:', alreadyLinked)
console.log('Conflicts skipped (lead matched by >1 page / mismatched existing link):', conflicts)
console.log('Unmatched Notion pages (no lead):', unmatched)
console.log('Plan saved -> .notion-audit/link-plan.json')
