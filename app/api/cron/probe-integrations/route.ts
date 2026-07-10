/**
 * Cron endpoint that live-probes every non-deleted studio's integrations and
 * upserts the results into studio_integration_health.
 *
 * Triggered by Supabase pg_cron via pg_net (see migration 050 for the schedule
 * SQL to run in the Supabase Dashboard). Authenticated via an `x-cron-secret`
 * header matching CRON_SECRET (the same secret used by the analyze-single-call
 * edge function so operators only manage one).
 *
 * This route is listed in proxy.ts PUBLIC_PATHS so unauthenticated pg_net
 * requests aren't redirected to /login. The secret check below is the actual
 * gate.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { probeAndCacheStudios, type ProbeableStudio } from '@/lib/integration-health-writer'

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = req.headers.get('x-cron-secret')
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data: studios, error: studiosError } = await service
    .from('studios')
    .select('id, name, ghl_account_id, ghl_api_key, retell_api_key, retell_agent_id')
    .is('deleted_at', null)

  if (studiosError) {
    return NextResponse.json({ error: studiosError.message }, { status: 500 })
  }

  const list = (studios ?? []) as ProbeableStudio[]
  const entries = await probeAndCacheStudios(service, list)

  return NextResponse.json({
    probed: entries.length,
    at: new Date().toISOString(),
  })
}
