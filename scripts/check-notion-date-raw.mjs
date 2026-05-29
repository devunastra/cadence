// READ-ONLY: dump raw Notion date.start for specific leads + Supabase stored value, to diagnose tz.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const STUDIO = '71274499-7c29-4621-990f-b60669ed1de3'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const NOTION = env.NOTION_API_KEY, DB = env.NOTION_DB_LINCOLNSHIRE
const draw = p => (p && p.type === 'date') ? (p.date?.start ?? null) : null
const names = ['Natalie Tomasik', 'Miriam Chan']

const out = []; let cursor
do {
  const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${NOTION}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
  })
  const j = await res.json(); if (j.object === 'error') throw new Error(`${j.code} ${j.message}`)
  out.push(...j.results); cursor = j.has_more ? j.next_cursor : undefined
} while (cursor)

const title = pg => { const t = pg.properties['Name']; return t?.title?.map(x => x.plain_text).join('') ?? '' }
for (const nm of names) {
  const pg = out.find(p => title(p) === nm)
  if (!pg) { console.log(nm, '-> NOT FOUND in Notion'); continue }
  const { data } = await supa.from('leads').select('last_contacted,first_lesson').eq('studio_id', STUDIO).eq('notion_page_id', pg.id).maybeSingle()
  console.log(`${nm}:`)
  console.log(`   Notion LC raw: ${JSON.stringify(draw(pg.properties['Last Contacted']))}  | Supabase LC: ${JSON.stringify(data?.last_contacted)}`)
  console.log(`   Notion FL raw: ${JSON.stringify(draw(pg.properties['First Lesson']))}  | Supabase FL: ${JSON.stringify(data?.first_lesson)}`)
}
