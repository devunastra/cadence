/**
 * Syncs ghl_contact_id on the leads table by fetching all contacts from GHL
 * and matching them to Supabase leads by phone number (primary) or email (fallback).
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/sync-ghl-contact-ids.ts
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GHL_API_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { config } from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const GHL_API_KEY  = process.env.GHL_API_KEY!

if (!SUPABASE_URL || !SERVICE_KEY || !GHL_API_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GHL_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_HEADERS = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
}

/** Strip everything except digits, remove leading country code 1 */
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
}

/** Sleep for ms milliseconds */
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

/** Search GHL for a contact by query string (phone or email), returns first match id or null */
async function searchGHLContact(locationId: string, query: string): Promise<string | null> {
  const params = new URLSearchParams({ locationId, query, limit: '1' })
  const res = await fetch(`${GHL_BASE}/contacts/?${params}`, { headers: GHL_HEADERS })

  if (res.status === 429) {
    // Rate limited — wait 2s and retry once
    await sleep(2000)
    return searchGHLContact(locationId, query)
  }

  if (!res.ok) return null

  const json = await res.json() as { contacts?: Array<{ id: string }> }
  return json.contacts?.[0]?.id ?? null
}

async function main() {
  // 1. Get studios with a GHL location ID
  const { data: studios, error: studioErr } = await supabase
    .from('studios')
    .select('id, name, ghl_account_id')
    .not('ghl_account_id', 'is', null)

  if (studioErr) { console.error('Failed to fetch studios:', studioErr.message); process.exit(1) }
  if (!studios?.length) { console.log('No studios with a ghl_account_id found.'); return }

  for (const studio of studios) {
    console.log(`\n── Studio: ${studio.name} ──`)
    console.log(`   GHL location: ${studio.ghl_account_id}`)

    // 2. Fetch leads missing ghl_contact_id
    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('id, name, phone, email')
      .eq('studio_id', studio.id)
      .or('ghl_contact_id.is.null,ghl_contact_id.eq.')

    if (leadsErr) { console.error('Failed to fetch leads:', leadsErr.message); continue }
    if (!leads?.length) { console.log('  All leads already have ghl_contact_id — nothing to do.'); continue }

    console.log(`  ${leads.length} leads to process\n`)

    let matched = 0
    let unmatched = 0

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i]
      const phone = normalizePhone(lead.phone)
      const email = lead.email?.trim() ?? ''

      // Search by phone → email → name (name is least reliable, last resort)
      let ghlId: string | null = null
      if (phone) ghlId = await searchGHLContact(studio.ghl_account_id, phone)
      if (!ghlId && email) ghlId = await searchGHLContact(studio.ghl_account_id, email)
      if (!ghlId && !phone && !email && lead.name) ghlId = await searchGHLContact(studio.ghl_account_id, lead.name)

      if (ghlId) {
        // Try to assign the GHL ID — if another lead already holds it, clear that
        // lead first then reassign (email match is more reliable than phone match)
        const { error } = await supabase
          .from('leads')
          .update({ ghl_contact_id: ghlId })
          .eq('id', lead.id)

        if (error?.message?.includes('duplicate key')) {
          // Clear the ID from whichever lead incorrectly holds it, then reassign
          await supabase
            .from('leads')
            .update({ ghl_contact_id: null })
            .eq('ghl_contact_id', ghlId)
            .neq('id', lead.id)

          const { error: retryErr } = await supabase
            .from('leads')
            .update({ ghl_contact_id: ghlId })
            .eq('id', lead.id)

          if (retryErr) {
            console.error(`  [${i + 1}/${leads.length}] Retry failed for ${lead.name}: ${retryErr.message}`)
          } else {
            matched++
          }
        } else if (error) {
          console.error(`  [${i + 1}/${leads.length}] DB error for ${lead.name}: ${error.message}`)
        } else {
          matched++
        }
      } else {
        unmatched++
      }

      process.stdout.write(`\r  Progress: ${i + 1}/${leads.length} | matched: ${matched} | unmatched: ${unmatched}`)

      // Small delay to avoid hammering the API (100ms between requests)
      await sleep(100)
    }

    console.log(`\n\n  ✓ Matched and updated: ${matched}`)
    console.log(`  ✗ No match found:      ${unmatched}`)
  }

  console.log('\nSync complete.')
}

main().catch(console.error)
