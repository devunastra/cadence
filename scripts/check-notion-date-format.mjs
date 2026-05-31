// READ-ONLY: sample Notion "Last Contacted" / "First Lesson" raw date.start values
// to determine whether they carry a time component (date-only vs date+time).
import { readFileSync } from 'node:fs'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const NOTION = env.NOTION_API_KEY, DB = env.NOTION_DB_LINCOLNSHIRE
const ndate = p => (p && p.type === 'date') ? (p.date?.start ?? null) : null

const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${NOTION}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
  body: JSON.stringify({ page_size: 100 }),
})
const j = await res.json()
let lcWithTime = 0, lcDateOnly = 0, flWithTime = 0, flDateOnly = 0
const samples = []
for (const pg of j.results) {
  const lc = ndate(pg.properties['Last Contacted'])
  const fl = ndate(pg.properties['First Lesson'])
  if (lc) (lc.includes('T') ? lcWithTime++ : lcDateOnly++)
  if (fl) (fl.includes('T') ? flWithTime++ : flDateOnly++)
  if (samples.length < 8 && (lc || fl)) samples.push({ lc, fl })
}
console.log('Sampled', j.results.length, 'Notion pages')
console.log('Last Contacted: date-only', lcDateOnly, '| with-time', lcWithTime)
console.log('First Lesson  : date-only', flDateOnly, '| with-time', flWithTime)
console.log('samples:', JSON.stringify(samples, null, 2))
