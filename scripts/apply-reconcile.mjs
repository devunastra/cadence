// Applies the reconciliation to Lincolnshire leads. SAFE BY DEFAULT: dry-run unless --apply.
// Steps handled here: 1 (contact cleanup), 3 (action call-less), 4 (status), 5 (level).
// Step 2 (call-linked action) is applied separately via SQL.
// Every write is by lead id, scoped to AMLS, logged to notion_sync_log. No deletes.
// Restore via scripts/restore-leads-snapshot.mjs from the backup file.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const STUDIO = '71274499-7c29-4621-990f-b60669ed1de3'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const report = JSON.parse(readFileSync('.notion-audit/report.json', 'utf8'))

const NOTION_PREFIX = /^https:\/\/www\.notion\.so\s*/i
const stripPrefix = v => {
  if (v == null) return { changed: false, value: v }
  const s = String(v)
  if (!NOTION_PREFIX.test(s)) return { changed: false, value: v }
  const cleaned = s.replace(NOTION_PREFIX, '').trim()
  return { changed: true, value: cleaned === '' ? null : cleaned }
}

const logs = []
const logRow = (lead_id, detail) => logs.push({ studio_id: STUDIO, lead_id, direction: 'notion_to_app', action: 'update', detail })

async function main() {
  // option value -> id map (per field), to set FK columns
  const { data: opts, error: oErr } = await supa.from('studio_field_options')
    .select('id,field,value').eq('studio_id', STUDIO)
  if (oErr) throw oErr
  const optId = new Map(opts.map(o => [`${o.field}:${o.value}`, o.id]))

  // pre-flight: every target value must resolve to an option id
  const fieldOf = { status_changes: 'status', level_changes: 'level', action_changes_callless: 'action' }
  const unresolved = []
  for (const [key, field] of Object.entries(fieldOf))
    for (const c of report[key]) if (!optId.has(`${field}:${c.to}`)) unresolved.push(`${field}:${c.to}`)
  if (unresolved.length) { console.error('ABORT — unresolved option values:', [...new Set(unresolved)]); process.exit(1) }

  // ---- Step 1: contact cleanup (strip notion prefix) ----
  let leads = [], from = 0
  for (;;) {
    const { data, error } = await supa.from('leads').select('id,phone,email')
      .eq('studio_id', STUDIO).range(from, from + 999)
    if (error) throw error
    leads.push(...data); if (data.length < 1000) break; from += 1000
  }
  let phoneFix = 0, emailFix = 0
  for (const l of leads) {
    const p = stripPrefix(l.phone), e = stripPrefix(l.email)
    if (!p.changed && !e.changed) continue
    const patch = {}
    if (p.changed) { patch.phone = p.value; phoneFix++ }
    if (e.changed) { patch.email = e.value; emailFix++ }
    if (APPLY) {
      const { error } = await supa.from('leads').update(patch).eq('id', l.id).eq('studio_id', STUDIO)
      if (error) throw new Error(`cleanup ${l.id}: ${error.message}`)
    }
    logRow(l.id, { kind: 'contact_cleanup', fields: Object.keys(patch) })
  }

  // ---- Steps 3/4/5: status, level, action(call-less) by id ----
  const counts = {}
  for (const [key, field] of Object.entries(fieldOf)) {
    counts[field] = 0
    for (const c of report[key]) {
      const id = optId.get(`${field}:${c.to}`)
      if (APPLY) {
        const { error } = await supa.from('leads').update({ [field]: id }).eq('id', c.id).eq('studio_id', STUDIO)
        if (error) throw new Error(`${field} ${c.id}: ${error.message}`)
      }
      logRow(c.id, { kind: 'reconcile', field, from: c.from, to: c.to })
      counts[field]++
    }
  }

  // ---- write the sync log ----
  if (APPLY && logs.length) {
    for (let i = 0; i < logs.length; i += 500) {
      const { error } = await supa.from('notion_sync_log').insert(logs.slice(i, i + 500))
      if (error) throw new Error(`sync_log: ${error.message}`)
    }
  }

  console.log(APPLY ? '=== APPLIED ===' : '=== DRY RUN (no writes) — pass --apply to execute ===')
  console.log('Step 1 contact cleanup: phones', phoneFix, '| emails', emailFix)
  console.log('Step 4 status :', counts.status)
  console.log('Step 5 level  :', counts.level)
  console.log('Step 3 action (call-less):', counts.action)
  console.log('notion_sync_log rows:', logs.length, APPLY ? '(inserted)' : '(would insert)')
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
