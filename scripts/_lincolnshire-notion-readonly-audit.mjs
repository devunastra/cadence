// TEMP, READ-ONLY. NO Supabase client, NO DB writes. Only Notion GET/query (reads) against the
// Lincolnshire leads DB, to size how many pages would be auto-created and how many look like junk.
// Mirrors the importer's contact normalization + the createUnmatchedLeads empty-skip, and adds a
// junk-name heuristic so we can see the risk before enabling notion_create_unmatched for Lincolnshire.
//
//   node scripts/_lincolnshire-notion-readonly-audit.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const NOTION_VERSION = '2022-06-28'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const NOTION = env.NOTION_API_KEY
const DB = env.NOTION_DB_LINCOLNSHIRE || 'd7c79e10b0fc4553903cec554bc0a1f5'
if (!NOTION) throw new Error('NOTION_API_KEY missing in .env')

const stripNotionUrl = (s) => String(s ?? '').replace(/https?:\/\/(www\.)?(app\.)?notion\.(so|com)/gi, '').trim()
function normalizePhone(raw) {
  const d = stripNotionUrl(raw).replace(/\D/g, ''); if (!d) return null
  const x = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return x.length === 10 ? `+1${x}` : null
}
function normalizeEmail(raw) {
  const s = stripNotionUrl(raw).toLowerCase()
  return s.split(/\s+/).find((t) => t.includes('@')) ?? null
}
function readContact(props, name) {
  const p = props?.[name]; if (!p) return null
  if (p.type === 'phone_number') return p.phone_number || null
  if (p.type === 'email') return p.email || null
  if (p.type === 'rich_text') return (p.rich_text ?? []).map((t) => t.plain_text).join('').trim() || null
  if (p.type === 'title') return (p.title ?? []).map((t) => t.plain_text).join('').trim() || null
  return null
}
// Heuristic: does this "name" look like junk (URL / no real letters)?
function looksJunky(name) {
  if (!name) return false
  const n = name.trim()
  if (/https?:\/\/|www\.|floatingrain|\.(com|org|net|php)\b/i.test(n)) return true
  if (!/[a-z]/i.test(n)) return true          // no letters at all
  if (n.length > 60) return true              // absurdly long "name"
  return false
}

async function pull(dbId) {
  const out = []; let cursor
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

const pages = await pull(DB)
let archived = 0, empty = 0, candidates = 0, junk = 0, noContact = 0, hasContact = 0
const junkSamples = [], noContactSamples = []
const candidatePageIds = []

for (const page of pages) {
  if (page.archived === true || page.in_trash === true) { archived++; continue }
  const props = page.properties ?? {}
  const name = (readContact(props, 'Name') ?? '').trim() || null
  const phone = normalizePhone(readContact(props, 'Phone'))
  const email = normalizeEmail(readContact(props, 'Email'))
  if (!name && !phone && !email) { empty++; continue }   // createUnmatchedLeads skips these
  candidates++
  candidatePageIds.push(page.id)
  if (looksJunky(name)) { junk++; if (junkSamples.length < 12) junkSamples.push(name) }
  if (!phone && !email) { noContact++; if (noContactSamples.length < 12) noContactSamples.push(name) }
  else hasContact++
}

console.log('Lincolnshire Notion DB     :', DB)
console.log('Total pages (raw)          :', pages.length)
console.log('  archived/in_trash        :', archived)
console.log('  empty (auto-skipped)     :', empty)
console.log('Candidate pages (non-empty):', candidates, '  <-- universe the create-path would consider')
console.log('  of which JUNK-looking name:', junk)
console.log('  of which no phone/email   :', noContact)
console.log('  of which have contact     :', hasContact)
console.log('\nJunk-name samples:')
for (const s of junkSamples) console.log('   -', JSON.stringify(s))
console.log('\nNo-contact (name-only) samples:')
for (const s of noContactSamples) console.log('   -', JSON.stringify(s))

mkdirSync('.notion-audit', { recursive: true })
writeFileSync('.notion-audit/lincolnshire-notion-candidate-pageids.json', JSON.stringify(candidatePageIds, null, 0))
console.log('\nWrote', candidatePageIds.length, 'candidate page ids -> .notion-audit/lincolnshire-notion-candidate-pageids.json (ids only)')
