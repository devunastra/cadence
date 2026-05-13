/**
 * This webhook endpoint is no longer the primary data source for Retell calls.
 * Call data is now synced via a Vercel Cron Job every 15 minutes:
 *   app/api/cron/sync-retell-calls/route.ts
 *
 * The archived webhook implementation is at:
 *   docs/archive/retell-webhook-route.ts
 *
 * This stub returns 200 to avoid errors if Retell still sends events here.
 */
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 })
}

export async function POST() {
  return NextResponse.json({ ok: true }, { status: 200 })
}
