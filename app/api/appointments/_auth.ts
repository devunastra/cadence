import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Shared-secret auth + studio guard for the local-booking API surface.
 *
 * These routes exist so n8n (acting for the Retell voice agent) can read
 * availability and book without GHL. They are machine-to-machine: there is no
 * user session, so they authenticate with a bearer secret exactly like the
 * webhook routes under app/api/webhooks/.
 *
 * Set N8N_APPOINTMENTS_SECRET in the server environment. If it is unset every
 * request fails closed with a 500 rather than silently accepting traffic.
 */
export function checkSecret(req: Request): NextResponse | null {
  const secret = process.env.N8N_APPOINTMENTS_SECRET
  if (!secret) {
    console.error('[appointments-api] N8N_APPOINTMENTS_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  const incoming = req.headers.get('authorization') ?? req.headers.get('x-appointments-secret')
  if (incoming !== secret && incoming !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export interface LocalStudio {
  id: string
  timezone: string | null
  appointment_duration_minutes: number | null
}

/**
 * Resolves a studio and refuses if it has a GHL calendar configured.
 *
 * This is the hard boundary that keeps the local booking path away from
 * GHL-backed studios. Lincolnshire and Schaumburg both have ghl_account_id and
 * ghl_calendar_id set, so any request naming them is rejected here — GHL stays
 * the single source of truth for those studios and cannot be bypassed, even by
 * a caller holding a valid secret.
 */
export async function resolveLocalStudio(
  studioId: string,
): Promise<{ studio?: LocalStudio; error?: NextResponse }> {
  if (!studioId) {
    return { error: NextResponse.json({ error: 'studio_id is required' }, { status: 400 }) }
  }

  const supabase = createServiceClient()
  const { data: studio } = await supabase
    .from('studios')
    .select('id, timezone, appointment_duration_minutes, ghl_account_id, ghl_calendar_id, deleted_at')
    .eq('id', studioId)
    .single()

  if (!studio || studio.deleted_at) {
    return { error: NextResponse.json({ error: 'Studio not found' }, { status: 404 }) }
  }

  if (studio.ghl_account_id && studio.ghl_calendar_id) {
    return {
      error: NextResponse.json(
        {
          error: 'studio_uses_ghl',
          message: 'This studio books through GHL. Local booking is only for studios without a GHL calendar.',
        },
        { status: 409 },
      ),
    }
  }

  return {
    studio: {
      id: studio.id,
      timezone: studio.timezone,
      appointment_duration_minutes: studio.appointment_duration_minutes,
    },
  }
}

/** Validates a "YYYY-MM-DD" date string. */
export function isValidDate(dateVal: unknown): dateVal is string {
  return typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)
}
