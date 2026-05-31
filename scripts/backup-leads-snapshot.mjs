// READ-ONLY backup: snapshot status/level/action/phone/email for every Lincolnshire lead
// BEFORE any reconciliation write. Output -> .notion-audit/backup-leads-20260530.json (gitignored, PII).
// Restore is generated from this file; nothing in the DB is touched here.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const STUDIO = '71274499-7c29-4621-990f-b60669ed1de3'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let leads = [], from = 0
for (;;) {
  const { data, error } = await supa.from('leads')
    .select('id,name,status,level,action,phone,email,created_at')
    .eq('studio_id', STUDIO).range(from, from + 999)
  if (error) throw error
  leads.push(...data)
  if (data.length < 1000) break
  from += 1000
}

mkdirSync('.notion-audit', { recursive: true })
const path = '.notion-audit/backup-leads-20260530.json'
writeFileSync(path, JSON.stringify({ studio_id: STUDIO, taken: '2026-05-30', count: leads.length, leads }, null, 2))
console.log(`Backed up ${leads.length} leads -> ${path}`)
