// ROLLBACK: restore status/level/action/phone/email for every lead from the backup snapshot.
// Reverts the reconciliation completely. SAFE BY DEFAULT: dry-run unless --apply.
//   node scripts/restore-leads-snapshot.mjs            (dry run)
//   node scripts/restore-leads-snapshot.mjs --apply    (restore)

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const STUDIO = '71274499-7c29-4621-990f-b60669ed1de3'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const snap = JSON.parse(readFileSync('.notion-audit/backup-leads-20260530.json', 'utf8'))
if (snap.studio_id !== STUDIO) { console.error('ABORT: backup studio mismatch'); process.exit(1) }

let n = 0
for (const l of snap.leads) {
  if (APPLY) {
    const { error } = await supa.from('leads')
      .update({ status: l.status, level: l.level, action: l.action, phone: l.phone, email: l.email })
      .eq('id', l.id).eq('studio_id', STUDIO)
    if (error) { console.error(`restore ${l.id}: ${error.message}`); process.exit(1) }
  }
  n++
}
console.log(APPLY ? `RESTORED ${n} leads from snapshot (${snap.taken})` : `DRY RUN — would restore ${n} leads. Pass --apply.`)
