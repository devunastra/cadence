// READ-ONLY: list every Notion property name + type for the Lincolnshire leads DB.
import { readFileSync } from 'node:fs'
const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DB_LINCOLNSHIRE}`, {
  headers: { Authorization: `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
})
const j = await res.json()
if (j.object === 'error') { console.error(j.code, j.message); process.exit(1) }
const rows = Object.entries(j.properties).map(([name, p]) => ({ name: JSON.stringify(name), type: p.type }))
rows.sort((a, b) => a.type.localeCompare(b.type))
for (const r of rows) console.log(`${r.type.padEnd(14)} ${r.name}`)
