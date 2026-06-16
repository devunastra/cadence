// Usage: node scripts/import-retell-calls.mjs scripts/export_51bb34712ea311f290aa8db93.csv
import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'
import fs from 'fs'
import path from 'path'

// .env loader (house style) — secrets come from .env (gitignored), never hardcoded.
const env = {}
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const SUPABASE_URL              = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const STUDIO_ID                 = '71274499-7c29-4621-990f-b60669ed1de3'
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Supabase config missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Parse "m:ss" or "mm:ss" → total seconds
function parseDuration(str) {
  if (!str) return null
  const parts = str.trim().split(':')
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
  return null
}

// Parse "MM/DD/YYYY HH:MM" → ISO string
function parseTime(str) {
  if (!str) return null
  // e.g. "04/15/2026 00:30"
  const [datePart, timePart] = str.trim().split(' ')
  const [month, day, year] = datePart.split('/')
  return new Date(`${year}-${month}-${day}T${timePart}:00.000Z`).toISOString()
}

// Convert JSON transcript array → plain "Agent: ...\nUser: ..." text
function parseTranscript(raw) {
  if (!raw) return null
  try {
    const turns = JSON.parse(raw)
    const lines = []
    for (const turn of turns) {
      if (turn.role === 'agent' && turn.content) {
        lines.push(`Agent: ${turn.content}`)
      } else if (turn.role === 'user' && turn.content) {
        lines.push(`User: ${turn.content}`)
      }
    }
    return lines.length > 0 ? lines.join('\n') : null
  } catch {
    return raw // fallback: store as-is
  }
}

const VALID_DISCONNECT_REASONS = new Set([
  'agent_hangup', 'user_hangup', 'voicemail',
  'dial_no_answer', 'dial_busy', 'call_transfer',
])

const VALID_SENTIMENTS = new Set(['positive', 'neutral', 'negative', 'unknown'])

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('Usage: node scripts/import-retell-calls.mjs <path-to-csv>')
    process.exit(1)
  }

  const raw = fs.readFileSync(path.resolve(csvPath), 'utf8')
  const rows = parse(raw, { columns: true, bom: true, skip_empty_lines: true })

  console.log(`Parsed ${rows.length} rows from CSV`)
  console.log('Columns found:', Object.keys(rows[0]))

  const calls = rows.map(row => {
    const disconnectReason = (row['Disconnection Reason'] ?? '').toLowerCase().trim()
    const rawSentiment     = (row['User Sentiment'] ?? '').toLowerCase().trim()
    const sentiment        = VALID_SENTIMENTS.has(rawSentiment) ? rawSentiment : 'unknown'

    return {
      retell_call_id:      row['Call ID']?.trim(),
      studio_id:           STUDIO_ID,
      created_at:          parseTime(row['Time']),
      duration_seconds:    parseDuration(row['Call Duration']),
      disconnected_reason: VALID_DISCONNECT_REASONS.has(disconnectReason) ? disconnectReason : null,
      sentiment,
      outcome:             null, // not available in CSV export
      picked_up:           !['dial_no_answer', 'dial_busy'].includes(disconnectReason),
      transferred:         disconnectReason === 'call_transfer',
      voicemail:           disconnectReason === 'voicemail',
      direction:           row['Direction']?.toLowerCase().trim() || null,
      transcript:          parseTranscript(row['Transcript With Tool Calls']),
      transcript_summary:  null, // not in CSV export
      lead_id:             null,
    }
  }).filter(c => c.retell_call_id && c.created_at)

  console.log(`Prepared ${calls.length} valid call records`)

  // Upsert in batches of 50
  const BATCH = 50
  let inserted = 0
  for (let i = 0; i < calls.length; i += BATCH) {
    const batch = calls.slice(i, i + BATCH)
    const { error } = await supabase
      .from('calls')
      .upsert(batch, { onConflict: 'retell_call_id' })

    if (error) {
      console.error(`Batch ${i / BATCH + 1} error:`, error.message)
    } else {
      inserted += batch.length
      console.log(`Inserted batch ${i / BATCH + 1} (${inserted}/${calls.length})`)
    }
  }

  console.log(`Done. ${inserted} calls upserted.`)
}

main().catch(err => { console.error(err); process.exit(1) })
