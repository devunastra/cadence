import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncOneNotionPageToSupabase, notionSyncMode } from '@/lib/notion'
import crypto from 'node:crypto'

/**
 * Notion webhook receiver (Notion → app, near-instant).
 * 1) Verification handshake: on subscription creation Notion POSTs { verification_token } —
 *    stored in notion_webhook_verifications so it can be pasted back into Notion to verify.
 * 2) Events: the changed page is synced into Supabase via syncOneNotionPageToSupabase.
 *
 * TEMPORARY DEBUG (2026-06-01, migration 039): every request is captured to notion_webhook_debug,
 * and the signature check is LOG-ONLY — it computes whether the HMAC matches but does NOT block,
 * so one redeploy reveals all failure modes at once (event delivery, signature format, payload
 * shape, sync result). REVERT to enforcing the signature once its format is confirmed (build log §5).
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

  // 2) Signature — LOG-ONLY during debug (does NOT block). Assumed scheme:
  //    HMAC-SHA256(verification_token, rawBody), hex, prefixed 'sha256='.
  const secret = process.env.NOTION_WEBHOOK_SECRET
  const provided = request.headers.get('x-notion-signature') ?? ''
  let sigExpected: string | null = null
  let sigMatch: boolean | null = null
  if (secret) {
    sigExpected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
    try {
      sigMatch = provided.length === sigExpected.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(sigExpected))
    } catch { sigMatch = false }
  }

  // 3) Sync the changed page (regardless of signature, during debug).
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

  // 4) Capture the full picture for diagnosis.
  try {
    await svc.from('notion_webhook_debug').insert({
      kind: parseError ? 'parse_error' : 'event',
      sig_provided: provided || null,
      sig_expected: sigExpected,
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

  // 200 always (so Notion doesn't retry-storm while we diagnose).
  return NextResponse.json({ ok: true, sig_match: sigMatch, sync_status: syncStatus ?? null })
}
