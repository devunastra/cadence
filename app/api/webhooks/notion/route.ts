import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncOneNotionPageToSupabase, notionSyncMode } from '@/lib/notion'
import crypto from 'node:crypto'

/**
 * Notion webhook receiver (Notion → app, near-instant — subject to Notion's own delivery latency,
 * which is seconds-to-minutes; the 5-min polling cron is the eventual-consistency backstop).
 * 1) Verification handshake: on subscription creation Notion POSTs { verification_token } —
 *    stored in notion_webhook_verifications so it can be pasted back into Notion to verify.
 * 2) Events: verified via X-Notion-Signature = 'sha256=' + HMAC-SHA256(verification_token, rawBody)
 *    (format confirmed live 2026-06-01), then the changed page is synced via syncOneNotionPageToSupabase.
 *
 * Each event is also recorded to notion_webhook_debug (sig result + sync status) for monitoring the
 * early rollout. That table can be dropped once delivery is trusted (see build log §5 / migration 039).
 */
export async function POST(request: NextRequest) {
  const raw = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  let body: { verification_token?: string; entity?: { id?: string; type?: string }; type?: string } = {}
  let parseError = false
  try { body = JSON.parse(raw) } catch { parseError = true }

  const svc = createServiceClient()

  // 1) Verification handshake — capture the token so it can be pasted back into Notion.
  if (body?.verification_token) {
    console.log('[notion-webhook] VERIFICATION TOKEN (set as NOTION_WEBHOOK_SECRET):', body.verification_token)
    try { await svc.from('notion_webhook_verifications').insert({ token: body.verification_token }) } catch { /* non-fatal */ }
    try { await svc.from('notion_webhook_debug').insert({ kind: 'verification', headers, raw_body: raw }) } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true })
  }

  // 2) Verify Notion's signature (enforced). Scheme confirmed live 2026-06-01.
  const secret = process.env.NOTION_WEBHOOK_SECRET
  const provided = request.headers.get('x-notion-signature') ?? ''
  let sigMatch: boolean | null = null
  if (secret) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
    try {
      sigMatch = provided.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    } catch { sigMatch = false }
    if (!sigMatch) {
      try {
        await svc.from('notion_webhook_debug').insert({
          kind: 'event', sig_provided: provided || null, sig_match: false,
          body_type: body?.type ?? null, entity_id: body?.entity?.id ?? null,
          sync_status: 'rejected_signature', headers, raw_body: raw,
        })
      } catch { /* non-fatal */ }
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
    }
  }

  // 3) Sync the changed page.
  const pageId = body?.entity?.id
  let syncStatus: string | undefined
  let syncDetail: unknown = null
  if (!parseError && notionSyncMode() !== 'off' && pageId) {
    try {
      const r = await syncOneNotionPageToSupabase(svc, pageId)
      syncStatus = r.status
      syncDetail = r.detail ?? null
    } catch (e) {
      syncStatus = 'error'
      syncDetail = String(e)
    }
  }

  // 4) Record for early-rollout monitoring (best-effort).
  try {
    await svc.from('notion_webhook_debug').insert({
      kind: parseError ? 'parse_error' : 'event',
      sig_provided: provided || null,
      sig_match: sigMatch,
      body_type: body?.type ?? null,
      entity_id: pageId ?? null,
      entity_type: body?.entity?.type ?? null,
      sync_status: syncStatus ?? null,
      sync_detail: syncDetail,
      headers,
      raw_body: raw,
    })
  } catch { /* non-fatal */ }

  // 200 always (so Notion doesn't retry-storm).
  return NextResponse.json({ ok: true, sync_status: syncStatus ?? null })
}
