// READ-ONLY Notion <-> Supabase reconciliation audit for Lincolnshire (AMLS).
// Pulls all Notion pages + all Supabase leads, matches by phone/email,
// and reports where status / level / (call-less) action differ.
// Writes NOTHING to any database. Output report -> .notion-audit/report.json (gitignored, has PII).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const STUDIO = '71274499-7c29-4621-990f-b60669ed1de3'

// ---- load .env (no secret printed) ----
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const NOTION = env.NOTION_API_KEY
const DB = env.NOTION_DB_LINCOLNSHIRE

// ---- normalizers (handle the known data noise) ----
// The export glues a notion URL prefix straight onto values, e.g.
//   "https://www.notion.so2243089402"  /  "https://www.notion.sopaulj1287@gmail.com"
// Strip the notion scheme+host (no digits in it) so the real value survives.
const stripNotion = s => String(s ?? '').replace(/https?:\/\/(www\.)?(app\.)?notion\.(so|com)/gi, '').trim()
const normPhone = raw => {
  const d = stripNotion(raw).replace(/\D/g, '')   // notion host has no digits, so plain digit-extract is safe
  if (!d) return null
  const x = (d.length === 11 && d[0] === '1') ? d.slice(1) : d
  return x.length >= 10 ? x.slice(-10) : null
}
const normEmail = raw => {
  const s = stripNotion(raw).toLowerCase()
  const tok = s.split(/\s+/).find(t => t.includes('@'))
  return tok ?? null
}
const nval = p => {
  if (!p) return null
  const t = p.type, v = p[t]
  if (t === 'title' || t === 'rich_text') return ((v || []).map(x => x.plain_text).join('').trim()) || null
  if (t === 'select') return v?.name ?? null
  if (t === 'status') return v?.name ?? null
  if (t === 'phone_number' || t === 'email') return v || null
  return null
}

// ---- pull all Notion pages ----
async function pullNotion() {
  const out = []
  let cursor
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NOTION}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
    })
    const j = await res.json()
    if (j.object === 'error') throw new Error(`Notion: ${j.code} ${j.message}`)
    out.push(...j.results)
    cursor = j.has_more ? j.next_cursor : undefined
  } while (cursor)
  return out
}

async function main() {
  // ---- Supabase: field options, leads, lead_ids with calls ----
  const { data: opts } = await supa.from('studio_field_options').select('id,value').eq('studio_id', STUDIO)
  const optMap = Object.fromEntries(opts.map(o => [o.id, o.value]))

  let leads = [], from = 0
  for (;;) {
    const { data, error } = await supa.from('leads')
      .select('id,name,phone,email,status,level,action,notion_page_id')
      .eq('studio_id', STUDIO).range(from, from + 999)
    if (error) throw error
    leads.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  const { data: callRows } = await supa.from('calls').select('lead_id').eq('studio_id', STUDIO).not('lead_id', 'is', null)
  const hasCall = new Set(callRows.map(c => c.lead_id))

  // index leads by phone / email
  const byPhone = new Map(), byEmail = new Map()
  for (const l of leads) {
    const p = normPhone(l.phone); if (p && !byPhone.has(p)) byPhone.set(p, l)
    const e = normEmail(l.email); if (e && !byEmail.has(e)) byEmail.set(e, l)
  }

  const notion = await pullNotion()

  // ---- match + diff ----
  const rep = {
    counts: { notion_pages: notion.length, supabase_leads: leads.length, leads_with_calls: hasCall.size },
    matched: 0, unmatched_notion: 0,
    status_changes: [], level_changes: [], action_changes_callless: [],
    unmatched_notion_samples: [], action_skipped_has_call: 0,
  }
  const matchedLeadIds = new Set()

  for (const page of notion) {
    const pr = page.properties
    const nName = nval(pr['Name'])
    const nStatus = nval(pr['Status'])
    const nLevel = nval(pr[''])          // Level = empty-name select
    const nAction = nval(pr['Action'])
    const nPhone = nval(pr['Phone'])
    const nEmail = nval(pr['Email'])
    const p = normPhone(nPhone), e = normEmail(nEmail)
    const lead = (p && byPhone.get(p)) || (e && byEmail.get(e)) || null

    if (!lead) {
      rep.unmatched_notion++
      if (rep.unmatched_notion_samples.length < 40)
        rep.unmatched_notion_samples.push({ name: nName, phone: nPhone, email: nEmail, status: nStatus, level: nLevel })
      continue
    }
    rep.matched++
    matchedLeadIds.add(lead.id)

    const curStatus = optMap[lead.status] ?? null
    const curLevel = optMap[lead.level] ?? null
    const curAction = optMap[lead.action] ?? null

    if (nStatus && nStatus !== curStatus)
      rep.status_changes.push({ id: lead.id, name: lead.name, from: curStatus, to: nStatus })
    if (nLevel && nLevel !== curLevel)
      rep.level_changes.push({ id: lead.id, name: lead.name, from: curLevel, to: nLevel })
    if (nAction && nAction !== curAction) {
      if (hasCall.has(lead.id)) rep.action_skipped_has_call++   // call-derived, handled separately
      else rep.action_changes_callless.push({ id: lead.id, name: lead.name, from: curAction, to: nAction })
    }
  }
  rep.unmatched_supabase = leads.length - matchedLeadIds.size

  // validate every proposed value exists as an option (FK safety)
  const optValues = new Set(opts.map(o => o.value))
  const missingOpt = new Set()
  for (const c of [...rep.status_changes, ...rep.level_changes, ...rep.action_changes_callless])
    if (!optValues.has(c.to)) missingOpt.add(c.to)
  rep.missing_options = [...missingOpt]

  mkdirSync('.notion-audit', { recursive: true })
  writeFileSync('.notion-audit/report.json', JSON.stringify(rep, null, 2))

  // ---- summary to stdout ----
  console.log('=== Notion <-> Supabase reconciliation (READ-ONLY) ===')
  console.log('Notion pages:', rep.counts.notion_pages, '| Supabase leads:', rep.counts.supabase_leads)
  console.log('Matched:', rep.matched, '| Unmatched Notion pages:', rep.unmatched_notion, '| Unmatched Supabase leads:', rep.unmatched_supabase)
  console.log('--- proposed changes (Notion-authoritative) ---')
  console.log('STATUS changes:', rep.status_changes.length)
  console.log('LEVEL  changes:', rep.level_changes.length)
  console.log('ACTION changes (call-less only):', rep.action_changes_callless.length, '| skipped (has calls):', rep.action_skipped_has_call)
  console.log('Notion values missing from studio_field_options:', rep.missing_options.length ? rep.missing_options : 'none')
  const top = (arr, n=8) => arr.slice(0, n).map(c => `  ${c.name}: ${c.from ?? '(empty)'} -> ${c.to}`).join('\n')
  if (rep.status_changes.length) console.log('STATUS sample:\n' + top(rep.status_changes))
  if (rep.level_changes.length)  console.log('LEVEL sample:\n' + top(rep.level_changes))
  if (rep.action_changes_callless.length) console.log('ACTION sample:\n' + top(rep.action_changes_callless))
  console.log('Full report -> .notion-audit/report.json')
}

main().catch(e => { console.error('AUDIT FAILED:', e.message); process.exit(1) })
