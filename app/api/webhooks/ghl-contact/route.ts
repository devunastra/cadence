import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, GENERAL_LIMIT } from '@/lib/rate-limit'

// Exported for unit testing
export function validateWebhookSecret(
  expected: string,
  received: string | null
): boolean {
  return received !== null && received === expected
}

// Exported for unit testing
export function mapGHLContactToLead(
  studioId: string,
  contact: Record<string, unknown>
) {
  const firstName = (contact.firstName as string | undefined) ?? ''
  const lastName  = (contact.lastName  as string | undefined) ?? ''
  const nameParts = [firstName, lastName].filter(Boolean).join(' ')
  // Fall back to top-level "name" field if GHL sends it
  const name = nameParts || (contact.name as string | undefined) || ''

  return {
    studio_id:      studioId,
    name:           name,
    phone:          (contact.phone  as string | undefined) ?? null,
    email:          (contact.email  as string | undefined) ?? null,
    source:         (contact.source as string | undefined) ?? null,
    ghl_contact_id: (contact.id     as string | undefined) ?? null,
  }
}

// GHL may use either naming convention depending on webhook version
const CREATE_EVENTS = new Set(['ContactCreate', 'contact.create'])
const UPDATE_EVENTS = new Set(['ContactUpdate', 'contact.update'])
const DELETE_EVENTS = new Set(['ContactDelete', 'contact.delete'])

export async function POST(request: NextRequest) {
  // 1. Validate shared secret
  const expectedSecret = process.env.GHL_WEBHOOK_SECRET
  if (!expectedSecret) {
    console.error('[ghl-contact] GHL_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const secret = request.headers.get('x-ghl-webhook-secret')
  if (!validateWebhookSecret(expectedSecret, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Rate limit by IP
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { allowed } = checkRateLimit(`webhook:ghl-contact:${ip}`, GENERAL_LIMIT)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const type = body.type as string | undefined
  const locationId = body.locationId as string | undefined
  // GHL may nest contact fields under "contact" or send them flat on the body root
  const contact = (body.contact as Record<string, unknown> | undefined) ?? body
  const contactId = contact.id as string | undefined

  if (!locationId) {
    return NextResponse.json({ error: 'Missing locationId' }, { status: 400 })
  }
  if (!contactId) {
    return NextResponse.json({ error: 'Missing contact id' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // 3. Find the studio by GHL location ID
  const { data: studio, error: studioError } = await supabase
    .from('studios')
    .select('id')
    .eq('ghl_account_id', locationId)
    .single()

  if (studioError || !studio) {
    console.error('Studio not found for locationId:', locationId)
    return NextResponse.json({ error: 'Studio not found' }, { status: 404 })
  }

  // 4. Route by event type

  if (DELETE_EVENTS.has(type ?? '')) {
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('ghl_contact_id', contactId)
    if (error) {
      console.error('Failed to delete lead:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  if (UPDATE_EVENTS.has(type ?? '')) {
    // Only sync the GHL-owned fields; never touch CRM fields managed in Supabase
    // (status, level, action, comments, etc.)
    const firstName = (contact.firstName as string | undefined) ?? ''
    const lastName  = (contact.lastName  as string | undefined) ?? ''
    const nameParts = [firstName, lastName].filter(Boolean).join(' ')
    const name = nameParts || (contact.name as string | undefined)

    const updates: Record<string, string | null> = {}
    if (name)                            updates.name  = name
    if ('phone' in contact)              updates.phone = (contact.phone as string | null) ?? null
    if ('email' in contact)              updates.email = (contact.email as string | null) ?? null

    const { error } = await supabase
      .from('leads')
      .update(updates)
      .eq('ghl_contact_id', contactId)
    if (error) {
      console.error('Failed to update lead:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // ContactCreate (or unknown type — treat as upsert to be safe)
  if (CREATE_EVENTS.has(type ?? '') || type === undefined) {
    const leadData = mapGHLContactToLead(studio.id, contact)
    const { error } = await supabase
      .from('leads')
      .upsert(leadData, { onConflict: 'ghl_contact_id' })
    if (error) {
      console.error('Failed to upsert lead:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
