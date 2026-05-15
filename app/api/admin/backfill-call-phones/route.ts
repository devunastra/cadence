import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * One-time backfill: fetch from_number / to_number from Retell for all calls
 * that have no caller_phone yet, and write them to the calls table.
 *
 * Protected by CRON_SECRET.
 * Run once: GET /api/admin/backfill-call-phones
 *           Authorization: Bearer <CRON_SECRET>
 */

const BATCH_SIZE = 50
const DELAY_MS = 100 // delay between Retell API calls to avoid rate limits

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Get all studios with a Retell API key
  const { data: studios, error: studiosError } = await supabase
    .from('studios')
    .select('id, retell_api_key')
    .not('retell_agent_id', 'is', null)
    .neq('retell_agent_id', '')

  if (studiosError || !studios?.length) {
    return NextResponse.json({ ok: true, message: 'No studios configured', updated: 0 })
  }

  const apiKeyByStudio: Record<string, string> = {}
  for (const s of studios) {
    if (s.retell_api_key) apiKeyByStudio[s.id] = s.retell_api_key
  }

  const studioIds = Object.keys(apiKeyByStudio)
  if (!studioIds.length) {
    return NextResponse.json({ ok: false, message: 'No Retell API keys available', updated: 0 })
  }

  // Fetch all calls missing caller_phone across configured studios
  const { data: calls, error: callsError } = await supabase
    .from('calls')
    .select('id, retell_call_id, studio_id')
    .is('caller_phone', null)
    .in('studio_id', studioIds)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (callsError) {
    return NextResponse.json({ ok: false, error: callsError.message }, { status: 500 })
  }

  if (!calls?.length) {
    return NextResponse.json({ ok: true, message: 'All calls already have phone data', updated: 0 })
  }

  let updated = 0
  let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < calls.length; i += BATCH_SIZE) {
    const batch = calls.slice(i, i + BATCH_SIZE)

    for (const call of batch) {
      const apiKey = apiKeyByStudio[call.studio_id]
      if (!apiKey) { skipped++; continue }

      try {
        const res = await fetch(`https://api.retellai.com/v2/get-call/${call.retell_call_id}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        })

        if (!res.ok) {
          errors.push(`${call.retell_call_id}: retell ${res.status}`)
          continue
        }

        const detail = await res.json()
        const callerPhone = detail.from_number ?? null
        const calledPhone = detail.to_number ?? null

        if (!callerPhone && !calledPhone) { skipped++; continue }

        const { error: updateError } = await supabase
          .from('calls')
          .update({ caller_phone: callerPhone, called_phone: calledPhone })
          .eq('id', call.id)

        if (updateError) {
          errors.push(`${call.retell_call_id}: db ${updateError.message}`)
        } else {
          updated++
        }

        // Rate limit delay
        await sleep(DELAY_MS)
      } catch (err) {
        errors.push(`${call.retell_call_id}: ${String(err)}`)
      }
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    total: calls.length,
    updated,
    skipped,
    ...(errors.length > 0 && { errors: errors.slice(0, 20) }),
  })
}
