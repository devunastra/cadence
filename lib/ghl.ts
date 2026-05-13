const GHL_BASE_URL = 'https://services.leadconnectorhq.com'

export async function ghlFetch(path: string, options: RequestInit = {}, apiKey?: string): Promise<Response> {
  const key = apiKey
  if (!key) throw new Error('GHL API key is not configured for this studio. Add it in Settings → Business Profile.')

  return fetch(`${GHL_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

function splitName(name: string): { firstName: string; lastName?: string } {
  const parts = name.trim().split(/\s+/)
  const firstName = parts[0] ?? ''
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined
  return { firstName, lastName }
}

/**
 * Creates a GHL contact and returns the new contact's ID, or null on failure.
 * GHL sync failures are non-fatal — Supabase is source of truth.
 */
export async function createGHLContact(
  locationId: string,
  lead: { name: string; phone?: string | null; email?: string | null },
  apiKey?: string,
): Promise<string | null> {
  const { firstName, lastName } = splitName(lead.name)
  const body: Record<string, string> = { locationId, firstName }
  if (lastName) body.lastName = lastName
  if (lead.phone) body.phone = lead.phone
  if (lead.email) body.email = lead.email

  try {
    const res = await ghlFetch('/contacts/', { 
      method: 'POST', 
      body: JSON.stringify(body),
      headers: { 'Version': '2021-07-28' }
    }, apiKey)
    if (!res.ok) {
      console.error('[createGHLContact] Failed:', res.status, await res.text())
      return null
    }
    const data = await res.json()
    return (data.contact?.id as string) ?? null
  } catch (err) {
    console.error('[createGHLContact] Exception:', err)
    return null
  }
}

/**
 * Updates name, phone, and/or email on an existing GHL contact.
 * Note: GHL "last activity" is auto-computed and cannot be set via API.
 * GHL sync failures are non-fatal — Supabase is source of truth.
 */
export async function updateGHLContact(
  contactId: string,
  lead: { name?: string | null; phone?: string | null; email?: string | null },
  apiKey?: string,
): Promise<void> {
  const payload: Record<string, string | undefined> = {}
  if (lead.name !== undefined) {
    const { firstName, lastName } = splitName(lead.name ?? '')
    payload.firstName = firstName
    if (lastName) payload.lastName = lastName
  }
  if (lead.phone !== undefined) payload.phone = lead.phone ?? undefined
  if (lead.email !== undefined) payload.email = lead.email ?? undefined

  try {
    await ghlFetch(`/contacts/${contactId}`, { 
      method: 'PUT', 
      body: JSON.stringify(payload),
      headers: { 'Version': '2021-07-28' }
    }, apiKey)
  } catch {
    // non-fatal
  }
}

/**
 * Deletes a GHL contact by ID.
 * GHL sync failures are non-fatal — Supabase is source of truth.
 */
export async function deleteGHLContact(contactId: string, apiKey?: string): Promise<void> {
  try {
    await ghlFetch(`/contacts/${contactId}`, { 
      method: 'DELETE',
      headers: { 'Version': '2021-07-28' }
    }, apiKey)
  } catch {
    // non-fatal
  }
}

/**
 * Converts a naive datetime string representing local time in a given IANA timezone
 * into a UTC ISO string (with Z suffix) suitable for GHL's API.
 *
 * GHL treats naive ISO strings as UTC, so we must always send UTC.
 * Example: "2026-04-21T14:00:00" in "America/Chicago" (CDT = UTC-5)
 *          → "2026-04-21T19:00:00Z"
 */
function localToUTCISO(naive: string, tz: string): string {
  // If the string already carries timezone info (Z suffix or +/-HH:MM offset),
  // parse it directly as a proper ISO timestamp — no local-to-UTC conversion needed.
  if (naive.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(naive)) {
    return new Date(naive).toISOString().substring(0, 19) + 'Z'
  }
  // naive local datetime string → convert to UTC accounting for tz offset
  const approxUTC = new Date(naive.replace(' ', 'T') + 'Z')
  const localStr = approxUTC.toLocaleString('sv-SE', { timeZone: tz })
  const localAsUTC = new Date(localStr.replace(' ', 'T') + 'Z')
  const offsetMs = approxUTC.getTime() - localAsUTC.getTime()
  return new Date(approxUTC.getTime() + offsetMs).toISOString().substring(0, 19) + 'Z'
}

/**
 * Updates a GHL calendar event's start/end time while preserving all other fields.
 * FATAL — throws on conflict or error so the caller can abort the Supabase update.
 *
 * startTime / endTime should be naive local datetime strings ("YYYY-MM-DDThh:mm:ss")
 * representing the studio's local timezone. They are converted to UTC before sending.
 */
export async function updateGHLAppointment(
  eventId: string,
  calendarId: string,
  startTime: string,
  endTime: string,
  locationId: string | null = null,
  extras: {
    title?: string | null
    contactId?: string | null
    appointmentStatus?: string | null
    assignedUserId?: string | null
    notes?: string | null
    address?: string | null
    timezone?: string   // IANA timezone of the studio, default 'America/Chicago'
  } = {},
  apiKey?: string,
): Promise<{ newId?: string }> {
  const tz = extras.timezone ?? 'America/Chicago'
  const utcStart = localToUTCISO(startTime, tz)
  const utcEnd   = localToUTCISO(endTime, tz)

  const body: Record<string, string> = { calendarId, startTime: utcStart, endTime: utcEnd }
  if (locationId) body.locationId = locationId
  if (extras.title)             body.title             = extras.title
  if (extras.contactId)         body.contactId         = extras.contactId
  if (extras.appointmentStatus) body.appointmentStatus = extras.appointmentStatus
  if (extras.assignedUserId)    body.assignedUserId    = extras.assignedUserId
  if (extras.notes)             body.description       = extras.notes  // GHL field is "description"
  if (extras.address)           body.address           = extras.address

  const res = await ghlFetch(`/calendars/events/appointments/${eventId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }, apiKey)
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const msg = (errBody as { message?: string }).message ?? `GHL error ${res.status}`
    throw new Error(msg)
  }

  // After a successful PUT, GHL may assign a new appointment ID.
  // Search GHL's events by contact + time window to find the current ID.
  const newId = await findGHLAppointmentId(locationId, extras.contactId ?? null, utcStart, apiKey)
  return newId && newId !== eventId ? { newId } : {}
}

/**
 * Updates only title/notes/status on a GHL appointment without touching the time slot.
 * Omitting startTime/endTime avoids slot-conflict validation entirely.
 */
export async function patchGHLAppointmentDetails(
  eventId: string,
  calendarId: string,
  updates: { title?: string | null; notes?: string | null; appointmentStatus?: string | null },
  apiKey?: string,
): Promise<void> {
  const body: Record<string, string> = { calendarId }
  if (updates.title != null)             body.title             = updates.title
  if (updates.notes != null)             body.description       = updates.notes  // GHL field is "description"
  if (updates.appointmentStatus != null) body.appointmentStatus = updates.appointmentStatus

  const res = await ghlFetch(`/calendars/events/appointments/${eventId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }, apiKey)
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const msg = (errBody as { message?: string }).message ?? `GHL error ${res.status}`
    throw new Error(msg)
  }
}

/**
 * Searches GHL calendar events for a specific contact + start time and returns the event ID.
 * Used after a reschedule to discover GHL's current ID for the appointment.
 */
async function findGHLAppointmentId(
  locationId: string | null,
  contactId: string | null,
  utcStart: string,   // ISO with Z
  apiKey?: string,
): Promise<string | undefined> {
  if (!locationId || !contactId) return undefined
  try {
    // Search a ±5-minute window around the rescheduled time
    const start = new Date(new Date(utcStart).getTime() - 5 * 60 * 1000).toISOString()
    const end   = new Date(new Date(utcStart).getTime() + 5 * 60 * 1000).toISOString()
    const params = new URLSearchParams({ locationId, contactId, startTime: start, endTime: end })
    const res = await ghlFetch(`/calendars/events?${params}`, {}, apiKey)
    if (!res.ok) return undefined
    const data = await res.json()
    const events: Array<{ id: string }> = data?.events ?? data?.appointments ?? []
    return events[0]?.id ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Deletes a GHL calendar event by ID.
 * Uses /calendars/events/{id} (not /appointments/) per GHL's delete API.
 * GHL sync failures are non-fatal — Supabase is source of truth.
 */
export async function deleteGHLAppointment(eventId: string, apiKey?: string): Promise<void> {
  try {
    await ghlFetch(`/calendars/events/${eventId}`, { method: 'DELETE' }, apiKey)
  } catch {
    // non-fatal
  }
}

/**
 * Creates a new GHL calendar appointment.
 * startTime / endTime are naive local datetime strings converted to UTC internally.
 * Returns the new appointment ID, or throws on error.
 */
export async function createGHLAppointment(opts: {
  calendarId: string
  locationId: string
  contactId: string
  startTime: string   // naive local ISO "YYYY-MM-DDThh:mm:ss"
  endTime: string
  title?: string | null
  notes?: string | null
  timezone?: string   // IANA, default 'America/Chicago'
  apiKey?: string
}): Promise<string> {
  const tz = opts.timezone ?? 'America/Chicago'
  const body: Record<string, string | boolean> = {
    calendarId:        opts.calendarId,
    locationId:        opts.locationId,
    contactId:         opts.contactId,
    startTime:         localToUTCISO(opts.startTime, tz),
    endTime:           localToUTCISO(opts.endTime, tz),
    title:             opts.title ?? 'Dance Appointment',
    appointmentStatus: 'confirmed',
    ignoreDateRange:   true,
    toNotify:          false,
  }
  if (opts.notes) body.description = opts.notes  // GHL field is "description"

  const res = await ghlFetch('/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify(body),
  }, opts.apiKey)
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const msg = (errBody as { message?: string }).message ?? `GHL error ${res.status}`
    throw new Error(msg)
  }
  const data = await res.json()
  const id = data?.appointment?.id ?? data?.event?.id ?? data?.id
  if (!id) throw new Error('GHL did not return an appointment ID')
  return id as string
}
