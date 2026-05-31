import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncNotionToSupabase, notionSyncMode } from '@/lib/notion'

/**
 * Notion → App sync (S2, polling entrypoint).
 * Pulls Notion edits into Supabase for every studio that has a linked Notion DB.
 * Respects NOTION_SYNC_MODE (off / log / live). Protected by CRON_SECRET.
 *
 * Trigger: POST /api/notion-sync   Authorization: Bearer <CRON_SECRET>
 * (Wire to pg_cron / a scheduler for polling; can also be run manually.)
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const mode = notionSyncMode()
  if (mode === 'off') {
    return NextResponse.json({ ok: true, mode, message: 'NOTION_SYNC_MODE is off — nothing pulled.' })
  }

  const client = createServiceClient()
  const { data: studios, error } = await client
    .from('studios')
    .select('id, name, notion_leads_db_id')
    .not('notion_leads_db_id', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Record<string, unknown> = {}
  for (const s of (studios ?? []) as { id: string; name: string | null }[]) {
    try {
      results[s.name ?? s.id] = await syncNotionToSupabase(client, s.id)
    } catch (e) {
      results[s.name ?? s.id] = { error: String(e) }
    }
  }

  return NextResponse.json({ ok: true, mode, results })
}
