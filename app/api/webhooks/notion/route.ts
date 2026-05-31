import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncOneNotionPageToSupabase, notionSyncMode } from '@/lib/notion'
import crypto from 'node:crypto'

/**
 * Notion webhook receiver (Notion → app, near-instant).
 * 1) Verification handshake: on subscription creation Notion POSTs { verification_token } —
 *    we log it so you can copy it from Netlify function logs, set it as NOTION_WEBHOOK_SECRET,
 *    and confirm the subscription in Notion.
 * 2) Events: verified via X-Notion-Signature (HMAC-SHA256 of the raw body with the token),
 *    then the changed page is synced into Supabase via syncOneNotionPageToSupabase.
 * Path is under /api/webhooks (already public in proxy.ts). Respects NOTION_SYNC_MODE.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text()
  let body: { verification_token?: string; entity?: { id?: string; type?: string }; type?: string } = {}
  try { body = JSON.parse(raw) } catch { /* non-JSON */ }

  // 1) Verification handshake — capture the token from logs, then set NOTION_WEBHOOK_SECRET.
  if (body?.verification_token) {
    console.log('[notion-webhook] VERIFICATION TOKEN (set as NOTION_WEBHOOK_SECRET):', body.verification_token)
    return NextResponse.json({ ok: true })
  }

  // 2) Verify Notion's signature once the secret is configured.
  const secret = process.env.NOTION_WEBHOOK_SECRET
  if (secret) {
    const provided = request.headers.get('x-notion-signature') ?? ''
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
    const ok = provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  if (notionSyncMode() === 'off') return NextResponse.json({ ok: true, mode: 'off' })

  // 3) Sync the changed page.
  const pageId = body?.entity?.type === 'page' ? body.entity.id : body?.entity?.id
  if (!pageId) return NextResponse.json({ ok: true, note: 'no page id in event', type: body?.type })

  try {
    const client = createServiceClient()
    const result = await syncOneNotionPageToSupabase(client, pageId)
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 }) // 200 so Notion doesn't spam retries
  }
}
