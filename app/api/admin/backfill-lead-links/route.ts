import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * One-time backfill: fetch Retell dynamic variables for all calls that have
 * no lead_id and link them to the matching lead via email or phone.
 *
 * Protected by CRON_SECRET (same env var as the cron route).
 * Run once: GET /api/admin/backfill-lead-links
 *           Authorization: Bearer <CRON_SECRET>
 */

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
    return NextResponse.json({ ok: true, message: 'No studios configured', linked: 0 })
  }

  // Build a map of studio_id → api_key for quick lookup
  const apiKeyByStudio: Record<string, string> = {}
  for (const s of studios) {
    const key = s.retell_api_key
    if (key) apiKeyByStudio[s.id] = key
  }

  const studioIds = Object.keys(apiKeyByStudio)
  if (!studioIds.length) {
    return NextResponse.json({ ok: false, message: 'No Retell API keys available', linked: 0 })
  }

  // Fetch all unlinked calls across all configured studios
  const { data: unlinkedCalls, error: callsError } = await supabase
    .from('calls')
    .select('id, retell_call_id, studio_id')
    .is('lead_id', null)
    .in('studio_id', studioIds)
    .order('created_at', { ascending: false })

  if (callsError) {
    return NextResponse.json({ ok: false, error: callsError.message }, { status: 500 })
  }

  if (!unlinkedCalls?.length) {
    return NextResponse.json({ ok: true, message: 'All calls already linked', linked: 0 })
  }

  let linked = 0
  let skipped = 0
  const errors: string[] = []

  for (const call of unlinkedCalls) {
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
      const vars = detail.retell_llm_dynamic_variables ?? {}
      const email = typeof vars.email === 'string' ? vars.email.trim().toLowerCase() : null
      const phone = typeof vars.phone_number === 'string' ? vars.phone_number.trim() : null

      if (!email && !phone) { skipped++; continue }

      let leadId: string | null = null

      if (email) {
        const { data: byEmail } = await supabase
          .from('leads')
          .select('id')
          .eq('studio_id', call.studio_id)
          .ilike('email', email)
          .limit(1)
          .maybeSingle()
        if (byEmail) leadId = byEmail.id
      }

      if (!leadId && phone) {
        const { data: byPhone } = await supabase
          .from('leads')
          .select('id')
          .eq('studio_id', call.studio_id)
          .ilike('phone', `%${phone}%`)
          .limit(1)
          .maybeSingle()
        if (byPhone) leadId = byPhone.id
      }

      if (leadId) {
        const { error: updateError } = await supabase
          .from('calls')
          .update({ lead_id: leadId })
          .eq('id', call.id)

        if (updateError) {
          errors.push(`${call.retell_call_id}: db ${updateError.message}`)
        } else {
          linked++
        }
      } else {
        skipped++
      }
    } catch (err) {
      errors.push(`${call.retell_call_id}: ${String(err)}`)
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    total: unlinkedCalls.length,
    linked,
    skipped,
    ...(errors.length > 0 && { errors: errors.slice(0, 20) }),
  })
}
