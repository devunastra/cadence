'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createGHLContact, updateGHLContact, deleteGHLContact, deleteGHLAppointment, updateGHLAppointment, createGHLAppointment, patchGHLAppointmentDetails } from '@/lib/ghl'
import { getRetellPhoneNumber, updateRetellPhoneNumberInboundAgent } from '@/lib/retell'
import { NOTION_ENUM_FIELDS, NOTION_SYNCED_FIELDS, notionSyncMode, syncLeadUpdateToNotion, syncLeadCreateToNotion, syncLeadArchiveToNotion } from '@/lib/notion'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Lead, ScheduledCallback, StudioSlotConfig, OnboardingStudioInput } from '@/lib/types'
import type { FieldOption } from '@/lib/field-options'
import { reconcileSourceDetail } from '@/lib/source-kinds'
import type { SourceDetail } from '@/lib/source-kinds'

// Converts a naive studio-local ISO string ("2026-05-08T17:00:00") to a UTC ISO string
// by formatting that naive moment in the studio's timezone and computing the offset.
function naiveStudioLocalToUtcIso(naiveLocal: string, tz: string): string {
  const dt = new Date(naiveLocal + 'Z') // treat as UTC first to get a Date object
  // Find the UTC offset that `tz` has at that moment by formatting the UTC date in tz
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(dt)
  const p = Object.fromEntries(fmt.map(({ type, value }) => [type, value]))
  const localIso = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
  const utcMs = dt.getTime()
  const localAsUtcMs = new Date(localIso + 'Z').getTime()
  const offsetMs = localAsUtcMs - utcMs
  return new Date(new Date(naiveLocal + 'Z').getTime() - offsetMs).toISOString()
}

export async function setSelectedStudio(studioId: string) {
  const cookieStore = await cookies()
  cookieStore.set('selected_studio_id', studioId, { path: '/', maxAge: 31536000 })
}

async function getAuthorizedClient() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: memberships } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)

  const isSuper = memberships?.some(m => m.role === 'super_admin') ?? false
  return { client: isSuper ? createServiceClient() : supabase, user }
}

// Resolve a raw lead-update map into Notion-ready fields: keep only synced fields, and
// convert enum FK UUIDs (status/level/action/source/reason/partnership) into their option labels.
async function resolveNotionFields(
  client: SupabaseClient,
  raw: Record<string, string | boolean | null>,
): Promise<Record<string, string | boolean | null>> {
  const out: Record<string, string | boolean | null> = {}
  const enumIds: string[] = []
  for (const [k, v] of Object.entries(raw)) {
    if (!NOTION_SYNCED_FIELDS.has(k)) continue
    if (NOTION_ENUM_FIELDS.has(k)) { if (typeof v === 'string' && v) enumIds.push(v) }
    else out[k] = v
  }
  let valueById = new Map<string, string>()
  if (enumIds.length) {
    const { data } = await client.from('studio_field_options').select('id,value').in('id', enumIds)
    valueById = new Map((data ?? []).map((o: { id: string; value: string }) => [o.id, o.value]))
  }
  for (const [k, v] of Object.entries(raw)) {
    if (NOTION_SYNCED_FIELDS.has(k) && NOTION_ENUM_FIELDS.has(k)) {
      out[k] = typeof v === 'string' && v ? (valueById.get(v) ?? null) : null
    }
  }
  return out
}

export async function createLeadView(studioId: string, name: string, columns: string[]) {
  const { client, user } = await getAuthorizedClient()
  const { data, error } = await client
    .from('lead_views')
    .insert({ studio_id: studioId, name, columns, created_by: user.id })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as { id: string; name: string; columns: string[] }
}

// Note: 'tick' is intentionally excluded — the field exists in Notion but is not present in the dashboard schema
// Fields whose values are UUIDs referencing studio_field_options — must be resolved to labels before logging
const ENUM_LEAD_FIELDS = new Set(['status', 'level', 'action', 'source', 'reason', 'partnership'])

async function resolveOptionLabels(
  client: Awaited<ReturnType<typeof getAuthorizedClient>>['client'],
  uuids: (string | null | unknown)[],
): Promise<Record<string, string>> {
  const ids = uuids.filter((v): v is string => typeof v === 'string' && v.length === 36)
  if (ids.length === 0) return {}
  const { data } = await client.from('studio_field_options').select('id, value').in('id', ids)
  return Object.fromEntries((data ?? []).map((o: { id: string; value: string }) => [o.id, o.value]))
}

function resolveChangeValues(
  changes: { field: string; old_value: unknown; new_value: unknown }[],
  labelMap: Record<string, string>,
) {
  return changes.map(c => {
    if (!ENUM_LEAD_FIELDS.has(c.field)) return c
    return {
      ...c,
      old_value: (typeof c.old_value === 'string' && labelMap[c.old_value]) ? labelMap[c.old_value] : c.old_value,
      new_value: (typeof c.new_value === 'string' && labelMap[c.new_value]) ? labelMap[c.new_value] : c.new_value,
    }
  })
}

const BULK_UPDATABLE_LEAD_FIELDS = new Set([
  'status', 'level', 'action', 'source', 'reason', 'partnership',
  'showed', 'bought', 'old', 'comments', 'available', 'texted',
])

export async function bulkUpdateLeads(ids: string[], field: string, value: string | null) {
  if (ids.length === 0) return
  if (!BULK_UPDATABLE_LEAD_FIELDS.has(field)) throw new Error('Invalid field')
  const { client, user } = await getAuthorizedClient()

  // Fetch current values before update for activity log diff
  type BeforeRow = { id: string; studio_id: string; name: string | null; [key: string]: unknown }
  const { data: beforeRowsRaw } = await client
    .from('leads')
    .select('id, studio_id, name')
    .in('id', ids)
  // Fetch the specific field separately to avoid Supabase template-literal type errors
  const { data: fieldRows } = await client
    .from('leads')
    .select(`id, ${field}`)
    .in('id', ids)
  const fieldMap = Object.fromEntries(((fieldRows ?? []) as unknown as Record<string, unknown>[]).map(r => [r.id as string, r[field]]))
  const beforeRows: BeforeRow[] = (beforeRowsRaw ?? []).map((r: { id: string; studio_id: string; name: string | null }) => ({
    ...r, [field]: fieldMap[r.id] ?? null,
  }))

  const { error } = await client.from('leads').update({ [field]: value }).in('id', ids)
  if (error) throw new Error(error.message)

  // Push to Notion (app -> Notion) for each affected lead. Gated by NOTION_SYNC_MODE.
  if (notionSyncMode() !== 'off' && NOTION_SYNCED_FIELDS.has(field)) {
    const { data: rows } = await client.from('leads').select('id, studio_id, notion_page_id').in('id', ids)
    const fields = await resolveNotionFields(client, { [field]: value })
    for (const r of (rows ?? []) as { id: string; studio_id: string; notion_page_id: string | null }[]) {
      await syncLeadUpdateToNotion(client, { leadId: r.id, studioId: r.studio_id, notionPageId: r.notion_page_id, fields })
    }
  }

  // Log activity — one row per affected lead
  const changedRows = beforeRows.filter(row => row[field] !== value)
  if (changedRows.length > 0) {
    const uuids = changedRows.flatMap(row => [row[field], value])
    resolveOptionLabels(client, uuids).then(labelMap => {
      const oldResolved = (id: unknown) => (typeof id === 'string' && labelMap[id]) ? labelMap[id] : id ?? null
      const newResolved = typeof value === 'string' && labelMap[value] ? labelMap[value] : value ?? null
      const logs = changedRows.map(row => ({
        studio_id:   row.studio_id,
        lead_id:     row.id,
        lead_name:   row.name ?? null,
        actor_email: user.email ?? null,
        event_type:  'update',
        changes:     [{ field, old_value: oldResolved(row[field]), new_value: newResolved }],
      }))
      client.from('activity_logs').insert(logs).then(() => {}, () => {})
    }).catch(() => {})
  }
}

const GHL_SYNCED_FIELDS = new Set(['name', 'phone', 'email'])
// Note: last_contacted is excluded — GHL "last activity" is auto-computed and cannot be set via API

const UPDATABLE_LEAD_FIELDS = new Set([
  'name', 'phone', 'email', 'status', 'level', 'action', 'source', 'reason', 'partnership',
  'showed', 'bought', 'old', 'comments', 'available', 'last_contacted', 'first_lesson', 'texted',
])

export async function updateLead(id: string, updates: Record<string, string | boolean | null>): Promise<void> {
  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([k]) => UPDATABLE_LEAD_FIELDS.has(k))
  )
  if (Object.keys(sanitized).length === 0) return
  const { client, user } = await getAuthorizedClient()

  // Fetch current values before update for activity log diff
  const fieldKeys = Object.keys(sanitized)
  const selectCols = ['studio_id', 'name', ...fieldKeys].join(', ')
  const { data: beforeRaw } = await client.from('leads').select(selectCols).eq('id', id).single()
  const before = beforeRaw as unknown as Record<string, unknown> | null

  const { error } = await client.from('leads').update(sanitized).eq('id', id)
  if (error) throw new Error(error.message)

  const hasGHLField = Object.keys(updates).some(k => GHL_SYNCED_FIELDS.has(k))
  if (hasGHLField) {
    const { data: lead } = await client
      .from('leads')
      .select('ghl_contact_id, studio_id')
      .eq('id', id)
      .single()
    if (lead?.ghl_contact_id && lead.studio_id) {
      const { data: studio } = await client
        .from('studios')
        .select('ghl_api_key')
        .eq('id', lead.studio_id)
        .single()
      await updateGHLContact(lead.ghl_contact_id, {
        name:  'name'  in updates ? updates.name  as string | null : undefined,
        phone: 'phone' in updates ? updates.phone as string | null : undefined,
        email: 'email' in updates ? updates.email as string | null : undefined,
      }, studio?.ghl_api_key ?? undefined)
    }
  }

  // Push to Notion (app -> Notion). Resolves enum UUIDs -> option labels. Gated by NOTION_SYNC_MODE.
  if (notionSyncMode() !== 'off') {
    const notionRaw = Object.fromEntries(Object.entries(updates).filter(([k]) => NOTION_SYNCED_FIELDS.has(k)))
    if (Object.keys(notionRaw).length > 0) {
      const { data: leadRow } = await client.from('leads').select('notion_page_id, studio_id').eq('id', id).single()
      if (leadRow?.studio_id) {
        const fields = await resolveNotionFields(client, notionRaw)
        await syncLeadUpdateToNotion(client, { leadId: id, studioId: leadRow.studio_id, notionPageId: leadRow.notion_page_id, fields })
      }
    }
  }

  // Log activity diff
  if (before?.studio_id) {
    const rawChanges = fieldKeys
      .filter(field => before[field] !== sanitized[field])
      .map(field => ({ field, old_value: before[field] ?? null, new_value: sanitized[field] ?? null }))
    if (rawChanges.length > 0) {
      const uuids = rawChanges.flatMap(c => [c.old_value, c.new_value])
      resolveOptionLabels(client, uuids).then(labelMap => {
        const changes = resolveChangeValues(rawChanges, labelMap)
        client.from('activity_logs').insert({
          studio_id:   before.studio_id as string,
          lead_id:     id,
          lead_name:   (before.name as string | null) ?? null,
          actor_email: user.email ?? null,
          event_type:  'update',
          changes,
        }).then(() => {}, () => {})
      }).catch(() => {})
    }
  }
}

export async function deleteLeads(ids: string[]) {
  if (ids.length === 0) return
  const { client, user } = await getAuthorizedClient()

  // Fetch names + GHL IDs + Studio IDs before deleting
  const { data: toDelete } = await client
    .from('leads')
    .select('id, name, ghl_contact_id, studio_id, notion_page_id')
    .in('id', ids)

  // Fetch unique studio API keys needed for deletion
  const studioIds = [...new Set((toDelete ?? []).map(l => l.studio_id).filter(Boolean) as string[])]
  const { data: studios } = await client
    .from('studios')
    .select('id, ghl_api_key')
    .in('id', studioIds)
  const apiKeysByStudio = Object.fromEntries((studios ?? []).map(s => [s.id, s.ghl_api_key]))

  // Sync deletions to GHL before removing from Supabase
  await Promise.allSettled(
    (toDelete ?? [])
      .filter(l => l.ghl_contact_id && l.studio_id)
      .map(l => deleteGHLContact(l.ghl_contact_id!, apiKeysByStudio[l.studio_id!] ?? undefined))
  )

  // Archive the matching Notion pages (app -> Notion). Soft-delete only — never hard-delete in Notion.
  if (notionSyncMode() !== 'off') {
    await Promise.allSettled(
      (toDelete ?? [])
        .filter(l => l.notion_page_id && l.studio_id)
        .map(l => syncLeadArchiveToNotion(client, { leadId: l.id, studioId: l.studio_id!, notionPageId: l.notion_page_id }))
    )
  }

  const { error } = await client.from('leads').delete().in('id', ids)
  if (error) throw new Error(error.message)

  // Log one activity row per deleted lead
  const deleteLogs = (toDelete ?? [])
    .filter(l => l.studio_id)
    .map(l => ({
      studio_id:   l.studio_id,
      lead_id:     l.id,
      lead_name:   l.name || null,
      actor_email: user.email ?? null,
      event_type:  'delete',
    }))
  if (deleteLogs.length > 0) {
    client.from('activity_logs').insert(deleteLogs).then(() => {}, () => {})
  }
}

export async function deleteLeadView(viewId: string) {
  const { client } = await getAuthorizedClient()
  const { error } = await client.from('lead_views').delete().eq('id', viewId)
  if (error) throw new Error(error.message)
}

export async function updateLeadView(viewId: string, name: string, columns: string[]) {
  const { client } = await getAuthorizedClient()
  const { error } = await client
    .from('lead_views')
    .update({ name, columns })
    .eq('id', viewId)
  if (error) throw new Error(error.message)
  return { id: viewId, name, columns }
}

export async function createLead({
  studioId,
  name,
  phone,
  email,
  statusId,
  levelId,
  sourceId,
  reasonId,
  available,
  comments,
}: {
  studioId: string
  name: string
  phone?: string
  email?: string
  statusId?: string | null
  levelId?: string | null
  sourceId?: string | null
  reasonId?: string | null
  available?: string
  comments?: string
}): Promise<Lead> {
  const { client, user } = await getAuthorizedClient()
  const { data: inserted, error } = await client
    .from('leads')
    .insert({
      studio_id: studioId, name, phone, email,
      status: statusId ?? null,
      level: levelId ?? null,
      source: sourceId ?? null,
      reason: reasonId ?? null,
      available, comments,
      created_by_email: user.email ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  // Sync to GHL — create contact and store the returned ID
  const { data: studio } = await client
    .from('studios')
    .select('ghl_account_id, ghl_api_key')
    .eq('id', studioId)
    .single()
  if (studio?.ghl_account_id) {
    const ghlContactId = await createGHLContact(studio.ghl_account_id, { name, phone, email }, studio.ghl_api_key ?? undefined)
    if (ghlContactId) {
      await client.from('leads').update({ ghl_contact_id: ghlContactId }).eq('id', inserted.id)
    }
  }

  // Create the matching Notion page (app -> Notion); store its id for future sync. Gated by NOTION_SYNC_MODE.
  if (notionSyncMode() !== 'off') {
    const { data: studioN } = await client.from('studios').select('notion_leads_db_id').eq('id', studioId).single()
    const fields = await resolveNotionFields(client, {
      name, phone: phone ?? null, email: email ?? null, available: available ?? null, comments: comments ?? null,
      status: statusId ?? null, level: levelId ?? null, source: sourceId ?? null, reason: reasonId ?? null,
    })
    const pageId = await syncLeadCreateToNotion(client, { leadId: inserted.id, studioId, notionDbId: studioN?.notion_leads_db_id ?? null, fields })
    if (pageId) await client.from('leads').update({ notion_page_id: pageId, notion_last_synced_at: new Date().toISOString() }).eq('id', inserted.id)
  }

  // Fetch back with display names via joins
  const { data, error: fetchError } = await client
    .from('leads')
    .select(ENUM_JOIN_SELECT)
    .eq('id', inserted.id)
    .single()
  if (fetchError) throw new Error(fetchError.message)
  const lead = flattenLead(data as unknown as RawLeadRow)

  // Log the activity
  try {
    await client.from('activity_logs').insert({
      studio_id:   studioId,
      lead_id:     lead.id,
      lead_name:   lead.name,
      actor_email: user.email ?? null,
      event_type:  'create',
    })
  } catch { /* non-critical */ }

  return lead
}

export async function fetchLeadById(id: string): Promise<Lead | null> {
  const { client } = await getAuthorizedClient()
  const { data, error } = await client
    .from('leads')
    .select(ENUM_JOIN_SELECT)
    .eq('id', id)
    .single()
  if (error) return null
  return flattenLead(data as unknown as RawLeadRow)
}

export async function createStudio({
  name,
  city,
  state,
  street_address,
  postal_code,
  country,
  ghl_account_id,
  ghl_api_key,
  ghl_calendar_id,
  retell_agent_id,
  retell_api_key,
  timezone,
  sources,
}: {
  name: string
  city?: string
  state?: string
  street_address?: string
  postal_code?: string
  country?: string
  ghl_account_id?: string
  ghl_api_key?: string
  ghl_calendar_id?: string
  retell_agent_id?: string
  retell_api_key?: string
  timezone?: string
  /**
   * Optional custom lead-source list with per-source detail. When provided,
   * the seeded defaults are reconciled against this — defaults not in
   * `sources` are deleted, custom sources not in defaults are inserted, and
   * each row's metadata jsonb is set to the detail captured in the wizard.
   */
  sources?: SourceDetail[]
}): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: memberships } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)

  const isOwnerOrAbove = memberships?.some(m => m.role === 'super_admin' || m.role === 'studio_owner') ?? false
  if (!isOwnerOrAbove) throw new Error('Forbidden')

  const location = [city, state].filter(Boolean).join(', ')
  const serviceClient = createServiceClient()
  const insertRow: Record<string, unknown> = {
    name,
    city: city ?? '',
    state: state ?? '',
    street_address: street_address ?? '',
    postal_code: postal_code ?? '',
    country: country ?? '',
    location,
    ghl_account_id: ghl_account_id || '',
    ghl_api_key: ghl_api_key || null,
    ghl_calendar_id: ghl_calendar_id || null,
    retell_agent_id: retell_agent_id || '',
    retell_api_key: retell_api_key || null,
  }
  if (timezone) insertRow.timezone = timezone
  const { data: studio, error } = await serviceClient
    .from('studios')
    .insert(insertRow)
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Add the creator as studio_owner if they are not a super_admin
  const isSuperAdmin = memberships?.some(m => m.role === 'super_admin') ?? false
  if (!isSuperAdmin && studio) {
    await serviceClient.from('studio_users').insert({ studio_id: studio.id, user_id: user.id, role: 'studio_owner' })
  }

  // Seed default enum options (status / level / action / source / reason /
  // partnership) so the leads form has dropdown values to pick from on day one.
  // The onboarding wizard already does this; createStudio used to skip it,
  // which left Settings-created studios with empty dropdowns.
  if (studio) {
    const { error: seedError } = await serviceClient.rpc('seed_studio_field_options', { p_studio_id: studio.id })
    if (seedError) throw new Error(seedError.message)

    // If caller provided a custom source list, reconcile it against the seeded
    // defaults. Same idempotent pattern as completeStudioOnboarding.
    if (sources) {
      await reconcileStudioSources(serviceClient, studio.id, sources)
    }
  }

  revalidatePath('/', 'layout')
}

/**
 * Reconciles `studio_field_options.source` rows for a studio against the
 * caller's desired list. Deletes sources not in the list, updates metadata on
 * matched existing rows (so renames/value edits flow through), and inserts new
 * ones. Comparison is case-insensitive on `name`; preserves `sort_order` on
 * existing rows; appends new ones at the end.
 *
 * Shared between createStudio (fresh studio, seeded defaults present),
 * setStudioSources (existing studio — caller's responsibility to confirm
 * safe-to-delete), and completeStudioOnboarding (brand-new studio).
 */
async function reconcileStudioSources(
  serviceClient: SupabaseClient,
  studioId: string,
  desiredSources: SourceDetail[],
): Promise<void> {
  // Normalize: trim names, strip blanks, dedupe case-insensitively (keep first).
  const normalized: SourceDetail[] = []
  const seen = new Set<string>()
  for (const s of desiredSources) {
    const reconciled = reconcileSourceDetail(s)
    const key = reconciled.name.toLowerCase()
    if (!reconciled.name || seen.has(key)) continue
    seen.add(key)
    normalized.push(reconciled)
  }

  const { data: existing } = await serviceClient
    .from('studio_field_options')
    .select('id, value, sort_order')
    .eq('studio_id', studioId)
    .eq('field', 'source')

  const existingRows = (existing ?? []) as Array<{ id: string; value: string; sort_order: number | null }>
  const chosenLower = new Set(normalized.map(s => s.name.toLowerCase()))

  // Delete options the caller dropped.
  const toDelete = existingRows.filter(r => !chosenLower.has(r.value.toLowerCase())).map(r => r.id)
  if (toDelete.length > 0) {
    const { error } = await serviceClient
      .from('studio_field_options')
      .delete()
      .in('id', toDelete)
    if (error) throw new Error(error.message)
  }

  // Update metadata on already-existing sources so detail edits land.
  const existingByLower = new Map(existingRows.map(r => [r.value.toLowerCase(), r]))
  for (const s of normalized) {
    const match = existingByLower.get(s.name.toLowerCase())
    if (!match) continue
    const { error } = await serviceClient
      .from('studio_field_options')
      .update({ metadata: metadataFromDetail(s) })
      .eq('id', match.id)
    if (error) throw new Error(error.message)
  }

  // Insert sources not already present (case-insensitive match).
  const existingLower = new Set(existingRows.map(r => r.value.toLowerCase()))
  const baseSortOrder = existingRows.reduce((max, r) => Math.max(max, r.sort_order ?? 0), 0)
  const toInsert = normalized
    .filter(s => !existingLower.has(s.name.toLowerCase()))
    .map((s, i) => ({
      studio_id: studioId,
      field: 'source',
      value: s.name,
      sort_order: baseSortOrder + 1 + i,
      metadata: metadataFromDetail(s),
    }))
  if (toInsert.length > 0) {
    const { error } = await serviceClient
      .from('studio_field_options')
      .insert(toInsert)
    if (error) throw new Error(error.message)
  }
}

// Shape stored in studio_field_options.metadata for source rows. `kind: 'none'`
// is the explicit "no detail field" marker (Walk-In); everything else carries
// the user-typed value alongside the kind that was rendered for it.
function metadataFromDetail(s: SourceDetail): Record<string, unknown> {
  if (s.kind === 'none') return { kind: 'none' }
  return { kind: s.kind, value: s.value }
}

export async function updateStudio(id: string, updates: {
  name?: string
  city?: string
  state?: string
  street_address?: string
  postal_code?: string
  country?: string
  ghl_account_id?: string
  ghl_api_key?: string
  ghl_calendar_id?: string
  retell_agent_id?: string
  retell_api_key?: string
  timezone?: string
}): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // super_admin role is per-studio in studio_users, but the app treats it as global.
  // So allow the update if the user is a super_admin on ANY studio, or a studio_owner on THIS studio.
  const { data: memberships } = await supabase
    .from('studio_users')
    .select('role, studio_id')
    .eq('user_id', user.id)

  const isSuper = memberships?.some(m => m.role === 'super_admin') ?? false
  const isOwnerHere = memberships?.some(m => m.studio_id === id && m.role === 'studio_owner') ?? false
  if (!isSuper && !isOwnerHere) throw new Error('Forbidden')

  const serviceClient = createServiceClient()
  const { error } = await serviceClient
    .from('studios')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(error.message)

  revalidatePath('/', 'layout')
}

export async function setVoiceAgentEnabled(studioId: string, enabled: boolean): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: studioMembership } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
  const isOwnerOrAbove = studioMembership?.some(m => m.role === 'studio_owner' || m.role === 'super_admin') ?? false

  if (!isOwnerOrAbove) {
    const { data: anyMembership } = await supabase
      .from('studio_users')
      .select('role')
      .eq('user_id', user.id)
    const isSuper = anyMembership?.some(m => m.role === 'super_admin') ?? false
    if (!isSuper) throw new Error('Forbidden')
  }

  const serviceClient = createServiceClient()
  const { data: studio, error: readErr } = await serviceClient
    .from('studios')
    .select('voice_agent_enabled, retell_phone_number, retell_inbound_agent_id, retell_api_key')
    .eq('id', studioId)
    .single()
  if (readErr || !studio) throw new Error('Studio not found')
  if (studio.voice_agent_enabled === enabled) return

  const dbUpdates: Record<string, unknown> = {
    voice_agent_enabled: enabled,
    voice_agent_paused_at: enabled ? null : new Date().toISOString(),
    voice_agent_paused_by: enabled ? null : user.id,
  }

  // Inbound Retell block — only if a phone number is configured for this studio.
  // On pause: snapshot current inbound_agent_id (if not already stored), then clear it.
  // On resume: restore from the stored snapshot.
  // Rollback value lets us undo the Retell change if the DB write fails.
  let retellRollback: { phoneNumber: string; restoreTo: string | null; apiKey: string | null } | null = null

  if (studio.retell_phone_number) {
    try {
      if (!enabled) {
        // PAUSE
        if (!studio.retell_inbound_agent_id) {
          const current = await getRetellPhoneNumber(studio.retell_phone_number, studio.retell_api_key ?? undefined)
          const currentInboundId = current?.inbound_agents?.[0]?.agent_id
          if (currentInboundId) dbUpdates.retell_inbound_agent_id = currentInboundId
        }
        await updateRetellPhoneNumberInboundAgent(
          studio.retell_phone_number,
          null,
          studio.retell_api_key ?? undefined,
        )
        retellRollback = {
          phoneNumber: studio.retell_phone_number,
          restoreTo: studio.retell_inbound_agent_id ?? (dbUpdates.retell_inbound_agent_id as string | null | undefined) ?? null,
          apiKey: studio.retell_api_key,
        }
      } else if (studio.retell_inbound_agent_id) {
        // RESUME
        await updateRetellPhoneNumberInboundAgent(
          studio.retell_phone_number,
          studio.retell_inbound_agent_id,
          studio.retell_api_key ?? undefined,
        )
        dbUpdates.retell_inbound_agent_id = null
        retellRollback = {
          phoneNumber: studio.retell_phone_number,
          restoreTo: null,
          apiKey: studio.retell_api_key,
        }
      }
    } catch (e) {
      throw new Error(`Failed to update Retell inbound agent: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  const { error: updateErr } = await serviceClient
    .from('studios')
    .update(dbUpdates)
    .eq('id', studioId)

  if (updateErr) {
    if (retellRollback) {
      try {
        await updateRetellPhoneNumberInboundAgent(
          retellRollback.phoneNumber,
          retellRollback.restoreTo,
          retellRollback.apiKey ?? undefined,
        )
      } catch { /* rollback failed — surfaces in original error */ }
    }
    throw new Error(updateErr.message)
  }

  // Activity log — non-critical. Uses event_type 'update' so the existing log renderer
  // doesn't choke on unknown types; the lead_name field carries the human-readable label.
  serviceClient.from('activity_logs').insert({
    studio_id: studioId,
    lead_name: enabled ? 'AI Voice Agent (resumed)' : 'AI Voice Agent (paused)',
    actor_email: user.email ?? null,
    event_type: 'update',
  }).then(() => {}, () => {})

  revalidatePath('/leads')
}

export async function deleteStudio(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Restricted to super_admin only — studio_owner cannot delete their own
  // studio (decision 2026-06-01). Studio data is high-value (leads, calls,
  // appointments, conversations); multi-owner studios mean one owner deleting
  // affects co-owners without consent. Owners who want to close a studio
  // escalate to a super_admin.
  const { data: memberships } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)

  const isSuperAdmin = memberships?.some(m => m.role === 'super_admin') ?? false
  if (!isSuperAdmin) {
    throw new Error('Only a super admin can delete a studio. Contact your administrator.')
  }

  const serviceClient = createServiceClient()
  const { error } = await serviceClient
    .from('studios')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(error.message)

  revalidatePath('/', 'layout')
}

export async function removeAvatar(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const serviceClient = createServiceClient()
  await serviceClient.storage.from('avatars').remove([`${user.id}/avatar`])
  await serviceClient.from('studio_users').update({ avatar_url: null }).eq('user_id', user.id)
}

export async function uploadAvatar(formData: FormData): Promise<{ url: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const file = formData.get('file') as File
  if (!file) throw new Error('No file provided')

  const serviceClient = createServiceClient()
  const path = `${user.id}/avatar`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error } = await serviceClient.storage
    .from('avatars')
    .upload(path, buffer, { upsert: true, contentType: file.type })

  if (error) throw new Error(error.message)

  const { data: { publicUrl } } = serviceClient.storage.from('avatars').getPublicUrl(path)

  await serviceClient.from('studio_users').update({ avatar_url: publicUrl }).eq('user_id', user.id)

  return { url: publicUrl }
}

const ENUM_JOIN_SELECT = `
  id, studio_id, created_at, name, phone, email,
  last_contacted, first_lesson, comments, available,
  showed, bought, old, ghl_contact_id, created_by_email,
  status:studio_field_options!leads_status_fkey(id, value),
  level:studio_field_options!leads_level_fkey(id, value),
  action:studio_field_options!leads_action_fkey(id, value),
  source:studio_field_options!leads_source_fkey(id, value),
  reason:studio_field_options!leads_reason_fkey(id, value),
  partnership:studio_field_options!leads_partnership_fkey(id, value)
`.trim()

type RawLeadRow = Omit<Lead, 'status' | 'level' | 'action' | 'source' | 'reason' | 'partnership'> & {
  status:      { id: string; value: string } | null
  level:       { id: string; value: string } | null
  action:      { id: string; value: string } | null
  source:      { id: string; value: string } | null
  reason:      { id: string; value: string } | null
  partnership: { id: string; value: string } | null
}

function flattenLead(raw: RawLeadRow): Lead {
  return {
    ...raw,
    status:      raw.status?.value      ?? null,
    level:       raw.level?.value       ?? null,
    action:      raw.action?.value      ?? null,
    source:      raw.source?.value      ?? null,
    reason:      raw.reason?.value      ?? null,
    partnership: raw.partnership?.value ?? null,
  }
}

export async function fetchLeadsPage({
  studioId,
  page,
  pageSize,
  search,
  statusFilter,
  levelFilter,
  actionFilter,
  sourceFilter,
  reasonFilter,
  sortField = 'created_at',
  sortAscending = false,
}: {
  studioId: string | null
  page: number
  pageSize: number
  search: string
  statusFilter: string[]
  levelFilter: string[]
  actionFilter: string[]
  sourceFilter: string[]
  reasonFilter: string[]
  sortField?: string
  sortAscending?: boolean
}): Promise<{ leads: Lead[]; total: number }> {
  const { client } = await getAuthorizedClient()
  const from = page * pageSize
  const to = from + pageSize - 1

  const filterEntries: { field: string; values: string[] }[] = [
    { field: 'status', values: statusFilter },
    { field: 'level',  values: levelFilter },
    { field: 'action', values: actionFilter },
    { field: 'source', values: sourceFilter },
    { field: 'reason', values: reasonFilter },
  ].filter(e => e.values.length > 0)

  const filterIds: Record<string, string[]> = {}
  if (filterEntries.length > 0 && studioId) {
    const allValues = filterEntries.flatMap(e => e.values)
    const allFields = filterEntries.map(e => e.field)
    const { data: opts } = await client
      .from('studio_field_options')
      .select('field, value, id')
      .eq('studio_id', studioId)
      .in('field', allFields)
      .in('value', allValues)
    for (const opt of opts ?? []) {
      if (!filterIds[opt.field]) filterIds[opt.field] = []
      filterIds[opt.field].push(opt.id)
    }
  }

  let query = client.from('leads').select(ENUM_JOIN_SELECT, { count: 'exact' })

  if (studioId)                       query = query.eq('studio_id', studioId)
  if (search) {
    const words = search.trim().split(/\s+/)
    for (const word of words) query = query.ilike('name', `%${word}%`)
  }
  if (filterIds['status']?.length)    query = query.in('status', filterIds['status'])
  if (filterIds['level']?.length)     query = query.in('level',  filterIds['level'])
  if (filterIds['action']?.length)    query = query.in('action', filterIds['action'])
  if (filterIds['source']?.length)    query = query.in('source', filterIds['source'])
  if (filterIds['reason']?.length)    query = query.in('reason', filterIds['reason'])

  const VALID_LEAD_SORT_FIELDS = new Set([
    'created_at', 'name', 'phone', 'last_contacted', 'first_lesson',
    'status', 'level', 'action', 'source', 'reason',
  ])
  const safeSortField = VALID_LEAD_SORT_FIELDS.has(sortField) ? sortField : 'created_at'

  const { data, count, error } = await query
    .order(safeSortField, { ascending: sortAscending })
    .range(from, to)

  if (error) throw new Error(error.message)
  return {
    leads: (data ?? []).map(r => flattenLead(r as unknown as RawLeadRow)),
    total: count ?? 0,
  }
}

export async function fetchLeadsInit(studioId: string) {
  const { client } = await getAuthorizedClient()
  const [viewsResult, fieldOptsResult, prefs, pageFilters, leadsData] = await Promise.all([
    client.from('lead_views').select('*').eq('studio_id', studioId).order('created_at', { ascending: true }),
    client.from('studio_field_options').select('id, field, value, bg, text').eq('studio_id', studioId).order('sort_order', { ascending: true, nullsFirst: false }),
    getUserPreferences(studioId).catch(() => null),
    getPageFilters(studioId).catch(() => ({} as PageFilters)),
    fetchLeadsPage({ studioId, page: 0, pageSize: 50, search: '', statusFilter: [], levelFilter: [], actionFilter: [], sourceFilter: [], reasonFilter: [] }).catch(() => ({ leads: [] as Lead[], total: 0 })),
  ])
  const customViews = (viewsResult.data ?? []).map((v: { id: string; name: string; columns: string[] }) => ({
    id: v.id, name: v.name, columns: v.columns,
  }))
  const fieldOptions: Record<string, Array<{ id: string; value: string; bg: string | null; text: string | null }>> = {}
  for (const row of (fieldOptsResult.data ?? []) as { id: string; field: string; value: string; bg: string | null; text: string | null }[]) {
    if (!fieldOptions[row.field]) fieldOptions[row.field] = []
    if (fieldOptions[row.field].some(o => o.value === row.value)) continue
    fieldOptions[row.field].push({ id: row.id, value: row.value, bg: row.bg ?? null, text: row.text ?? null })
  }
  return { customViews, fieldOptions, prefs, pageFilters, leads: leadsData.leads, total: leadsData.total }
}

export async function getUserPreferences(studioId: string): Promise<{
  col_widths: Record<string, number>
  active_view_id: string
  theme: 'light' | 'dark'
  nav_collapsed: boolean
  notify_lead_created: boolean
  notify_lead_updated: boolean
  notify_lead_deleted: boolean
  notify_appointment_created: boolean
  notify_appointment_toast: boolean
} | null> {
  const { client, user } = await getAuthorizedClient()
  const { data, error } = await client
    .from('user_preferences')
    .select('col_widths, active_view_id, theme, nav_collapsed, notify_lead_created, notify_lead_updated, notify_lead_deleted, notify_appointment_created, notify_appointment_toast')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    col_widths: (data.col_widths ?? {}) as Record<string, number>,
    active_view_id: (data.active_view_id as string) ?? 'all',
    theme: ((data.theme as string) === 'dark' ? 'dark' : 'light'),
    nav_collapsed: !!(data.nav_collapsed),
    notify_lead_created: data.notify_lead_created !== false,
    notify_lead_updated: data.notify_lead_updated !== false,
    notify_lead_deleted: data.notify_lead_deleted !== false,
    notify_appointment_created: data.notify_appointment_created !== false,
    notify_appointment_toast: data.notify_appointment_toast !== false,
  }
}

// Returns all field options for a studio including their stored colors and sort order
export async function getStudioFieldOptions(studioId: string): Promise<Record<string, Array<{ id: string; value: string; bg: string | null; text: string | null }>>> {
  const { client } = await getAuthorizedClient()
  const { data, error } = await client
    .from('studio_field_options')
    .select('id, field, value, bg, text, sort_order')
    .eq('studio_id', studioId)
    .order('sort_order', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  const result: Record<string, Array<{ id: string; value: string; bg: string | null; text: string | null }>> = {}
  for (const row of data ?? []) {
    if (!result[row.field]) result[row.field] = []
    if (result[row.field].some(o => o.value === row.value)) continue
    result[row.field].push({ id: row.id, value: row.value, bg: row.bg ?? null, text: row.text ?? null })
  }
  return result
}

// Update the color for a single studio-level field option
export async function updateStudioFieldOptionColor(optionId: string, bg: string, text: string): Promise<void> {
  const { client } = await getAuthorizedClient()
  const { error } = await client
    .from('studio_field_options')
    .update({ bg, text })
    .eq('id', optionId)
  if (error) throw new Error(error.message)
}

// Persist a new sort order for a field's options (called after drag-and-drop reorder)
export async function updateStudioFieldOptionOrder(updates: Array<{ id: string; sortOrder: number }>): Promise<void> {
  const { client } = await getAuthorizedClient()
  await Promise.all(
    updates.map(({ id, sortOrder }) =>
      client.from('studio_field_options').update({ sort_order: sortOrder }).eq('id', id)
    )
  )
}

/**
 * Fetches enum field options for a studio (Status / Level / Action / Source /
 * Reason / Partnership rows). Goes through `getAuthorizedClient`, which returns
 * the service client for super_admin — so the browser-side leads table doesn't
 * silently lose options to RLS when the super_admin isn't a `studio_users`
 * member of the studio they're viewing. Same fix as updateStudio,
 * analyze-call-quality, and update-role.
 *
 * Returns a flat array of `{ id, field, value, bg, text }`; the caller groups
 * by `field`.
 */
/**
 * Read a studio's current lead-source list (`studio_field_options.source`)
 * with per-source detail (metadata jsonb), sorted as the user sees them in
 * the leads page. Goes through `getAuthorizedClient` so super_admin sees the
 * rows even on studios where they have no `studio_users` row.
 *
 * Rows with NULL metadata (legacy rows pre-migration 046) get their kind
 * re-derived from the source name and value defaulted to ''.
 */
export async function fetchStudioSources(studioId: string): Promise<SourceDetail[]> {
  const { client } = await getAuthorizedClient()
  const { data, error } = await client
    .from('studio_field_options')
    .select('value, sort_order, metadata')
    .eq('studio_id', studioId)
    .eq('field', 'source')
    .order('sort_order', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => {
    const meta = (r.metadata ?? null) as { value?: string } | null
    // Kind is always re-derived from the source name via the registry. The
    // persisted `kind` in metadata is informational — the registry is the
    // single source of truth for which input renders.
    return reconcileSourceDetail({
      name: r.value as string,
      value: meta?.value ?? '',
    })
  })
}

/**
 * Update a studio's lead-source list. Reconciles against the existing rows —
 * removes options no longer chosen, inserts new ones, preserves untouched
 * entries (so analytics references and existing-lead source values stay
 * stable). Reuses the `reconcileStudioSources` helper for the actual diff.
 *
 * Auth: super_admin (global) or studio_owner of the target studio.
 */
export async function setStudioSources(studioId: string, sources: SourceDetail[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Same auth shape as updateStudio — super_admin global, studio_owner per-studio.
  const { data: memberships } = await supabase
    .from('studio_users')
    .select('role, studio_id')
    .eq('user_id', user.id)
  const isSuper = memberships?.some(m => m.role === 'super_admin') ?? false
  const isOwnerHere = memberships?.some(m => m.studio_id === studioId && m.role === 'studio_owner') ?? false
  if (!isSuper && !isOwnerHere) throw new Error('Forbidden')

  const serviceClient = createServiceClient()
  await reconcileStudioSources(serviceClient, studioId, sources)
  revalidatePath('/', 'layout')
}

/**
 * Search leads for the New Appointment contact picker. Goes through
 * `getAuthorizedClient` so super_admins viewing a studio they don't have a
 * `studio_users` row in still see results (the browser client would RLS-filter
 * everything out → empty contact picker). Returns the minimal shape the modal
 * needs.
 */
export async function searchLeadsForAppointment(
  studioId: string,
  query: string,
  limit = 50,
): Promise<{ leads: Array<{ id: string; name: string; email: string | null; phone: string | null; ghl_contact_id: string | null }>; total: number }> {
  const { client } = await getAuthorizedClient()
  const words = query.trim().split(/\s+/).filter(Boolean)
  let q = client
    .from('leads')
    .select('id, name, email, phone, ghl_contact_id', { count: 'exact' })
    .eq('studio_id', studioId)
    .order('name', { ascending: true })
    .limit(limit)
  for (const word of words) q = q.ilike('name', `%${word}%`)
  const { data, count, error } = await q
  if (error) throw new Error(error.message)
  return {
    leads: (data ?? []) as Array<{ id: string; name: string; email: string | null; phone: string | null; ghl_contact_id: string | null }>,
    total: count ?? 0,
  }
}

export async function fetchStudioFieldOptions(studioId: string): Promise<
  Array<{ id: string; field: string; value: string; bg: string | null; text: string | null }>
> {
  const { client } = await getAuthorizedClient()
  const { data, error } = await client
    .from('studio_field_options')
    .select('id, field, value, bg, text')
    .eq('studio_id', studioId)
    .order('sort_order', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ id: string; field: string; value: string; bg: string | null; text: string | null }>
}

// Add a new option — returns the new row with its ID
export async function addStudioFieldOption(studioId: string, field: string, value: string): Promise<{ id: string; value: string }> {
  const { client } = await getAuthorizedClient()
  const { data: existing } = await client
    .from('studio_field_options')
    .select('id, value')
    .eq('studio_id', studioId)
    .eq('field', field)
    .eq('value', value)
    .maybeSingle()
  if (existing) return existing as { id: string; value: string }
  const { data, error } = await client
    .from('studio_field_options')
    .insert({ studio_id: studioId, field, value })
    .select('id, value')
    .single()
  if (error) throw new Error(error.message)
  return data as { id: string; value: string }
}

// Rename an option — updates 1 row by (studioId, field, oldValue), all leads referencing
// this ID instantly see the new name without any lead row updates
export async function renameStudioFieldOption(studioId: string, field: string, oldValue: string, newValue: string): Promise<void> {
  const { client } = await getAuthorizedClient()
  const { error } = await client
    .from('studio_field_options')
    .update({ value: newValue })
    .eq('studio_id', studioId)
    .eq('field', field)
    .eq('value', oldValue)
  if (error) throw new Error(error.message)
}

// Delete an option — leads with this option will have the field set to NULL (via ON DELETE SET NULL)
export async function deleteStudioFieldOption(optionId: string): Promise<void> {
  const { client } = await getAuthorizedClient()
  const { error } = await client
    .from('studio_field_options')
    .delete()
    .eq('id', optionId)
  if (error) throw new Error(error.message)
}

export async function saveThemePreference(theme: 'light' | 'dark'): Promise<void> {
  const { client, user } = await getAuthorizedClient()
  const cookieStore = await cookies()
  let studioId = cookieStore.get('selected_studio_id')?.value
  if (!studioId) {
    // Cookie not set yet (user has never switched studios) — fall back to DB
    const supabase = await createClient()
    const { data } = await supabase
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    studioId = data?.studio_id ?? undefined
  }
  if (!studioId) return
  const { error } = await client
    .from('user_preferences')
    .upsert(
      { user_id: user.id, studio_id: studioId, theme, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,studio_id' }
    )
  if (error) throw new Error(error.message)
}

export async function saveUserPreferences(
  studioId: string,
  colWidths: Record<string, number>,
  activeViewId: string,
  theme: 'light' | 'dark',
  navCollapsed?: boolean,
): Promise<void> {
  const { client, user } = await getAuthorizedClient()
  const { error } = await client
    .from('user_preferences')
    .upsert(
      {
        user_id: user.id,
        studio_id: studioId,
        col_widths: colWidths,
        active_view_id: activeViewId,
        theme,
        ...(navCollapsed !== undefined ? { nav_collapsed: navCollapsed } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,studio_id' }
    )
  if (error) throw new Error(error.message)
}

export async function saveNavCollapsed(collapsed: boolean): Promise<void> {
  const { client, user } = await getAuthorizedClient()
  const cookieStore = await cookies()
  let studioId = cookieStore.get('selected_studio_id')?.value
  if (!studioId) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    studioId = data?.studio_id ?? undefined
  }
  if (!studioId) return
  const { error } = await client
    .from('user_preferences')
    .upsert(
      { user_id: user.id, studio_id: studioId, nav_collapsed: collapsed, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,studio_id' }
    )
  if (error) throw new Error(error.message)
}

export async function saveNotificationPreferences(prefs: {
  notify_lead_created?: boolean
  notify_lead_updated?: boolean
  notify_lead_deleted?: boolean
  notify_appointment_created?: boolean
  notify_appointment_toast?: boolean
}): Promise<void> {
  const { client, user } = await getAuthorizedClient()
  const cookieStore = await cookies()
  let studioId = cookieStore.get('selected_studio_id')?.value
  if (!studioId) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('studio_users')
      .select('studio_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    studioId = data?.studio_id ?? undefined
  }
  if (!studioId) return
  const { error } = await client
    .from('user_preferences')
    .upsert(
      {
        user_id: user.id,
        studio_id: studioId,
        ...prefs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,studio_id' }
    )
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Notifications inbox (bell + popover in the top header).
// ---------------------------------------------------------------------------

export async function getNotifications(
  studioId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<import('@/lib/types').Notification[]> {
  const { client, user } = await getAuthorizedClient()
  let q = client
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 30)
  if (opts.unreadOnly) q = q.is('read_at', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as import('@/lib/types').Notification[]
}

export async function getUnreadNotificationCount(studioId: string): Promise<number> {
  const { client, user } = await getAuthorizedClient()
  const { count, error } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .is('read_at', null)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function markNotificationRead(id: string): Promise<void> {
  const { client, user } = await getAuthorizedClient()
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('read_at', null)
  if (error) throw new Error(error.message)
}

export async function markAllNotificationsRead(studioId: string): Promise<void> {
  const { client, user } = await getAuthorizedClient()
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .is('read_at', null)
  if (error) throw new Error(error.message)
}

export async function logLeadActivity(
  studioId: string,
  leadName: string,
  actorEmail: string | null,
  eventType: 'create' | 'update' | 'delete',
): Promise<void> {
  const { client } = await getAuthorizedClient()
  try {
    await client.from('activity_logs').insert({
      studio_id:   studioId,
      lead_name:   leadName,
      actor_email: actorEmail,
      event_type:  eventType,
    })
  } catch { /* non-critical */ }
}

export async function getActivityLogs(studioId: string): Promise<{
  id: string
  lead_id: string | null
  lead_name: string | null
  actor_email: string | null
  event_type: string | null
  changes: { field: string; old_value: unknown; new_value: unknown }[] | null
  source: string | null
  created_at: string
}[]> {
  const { client } = await getAuthorizedClient()
  const { data } = await client
    .from('activity_logs')
    .select('id, lead_id, lead_name, actor_email, event_type, changes, source, created_at')
    .eq('studio_id', studioId)
    .order('created_at', { ascending: false })
    .limit(500)
  return (data ?? []) as {
    id: string
    lead_id: string | null
    lead_name: string | null
    actor_email: string | null
    event_type: string | null
    changes: { field: string; old_value: unknown; new_value: unknown }[] | null
    source: string | null
    created_at: string
  }[]
}

export async function deleteActivityLog(id: string): Promise<void> {
  const { client } = await getAuthorizedClient()
  // RLS enforces owner-only delete — no extra round trips needed
  const { error } = await client.from('activity_logs').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── User Preferences ───────────────────────────────────────────────────────────

export async function getAnalyticsPreferences(studioId: string): Promise<{ direction: string; preset: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { direction: 'all', preset: '7d' }

  const { data } = await supabase
    .from('user_preferences')
    .select('analytics')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .maybeSingle()

  return {
    direction: (data?.analytics as Record<string, string> | null)?.direction ?? 'all',
    preset:    (data?.analytics as Record<string, string> | null)?.preset    ?? '7d',
  }
}

export async function saveAnalyticsPreferences(studioId: string, direction: string, preset: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: existing } = await supabase
    .from('user_preferences')
    .select('id')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('user_preferences')
      .update({ analytics: { direction, preset } })
      .eq('user_id', user.id)
      .eq('studio_id', studioId)
  } else {
    await supabase
      .from('user_preferences')
      .insert({ user_id: user.id, studio_id: studioId, analytics: { direction, preset } })
  }
}

// ── Page Filter Preferences ────────────────────────────────────────────────────

export interface PageFilters {
  leads?: {
    filters?: { status?: string[]; level?: string[]; action?: string[]; source?: string[]; reason?: string[] }
    sort?: { field: string; ascending: boolean }
  }
  transcripts?: {
    direction?: string; sentiment?: string[]; outcome?: string
    appointmentBooked?: string; disconnectedReason?: string[]
    qualityScore?: { op: string; value: string }
  }
  appointmentList?: {
    statusFilters?: string[]; dateFrom?: string; dateTo?: string
    sortField?: string; sortAscending?: boolean
  }
  callHistory?: {
    filters?: {
      direction?: string; sentiment?: string[]; result?: string[]
      dateFrom?: string; dateTo?: string
      callbackOnly?: boolean
    }
    sort?: { field: string; ascending: boolean }
  }
  qualityReview?: {
    filters?: {
      grade?: string; direction?: string; sentiment?: string[]; result?: string[]
      qualityScore?: { op: string; value: string }
      dateFrom?: string; dateTo?: string
    }
    sort?: { field: string; ascending: boolean }
  }
  followUps?: {
    filters?: {
      direction?: string; grade?: string; sentiment?: string[]
      dateFrom?: string; dateTo?: string
    }
    sort?: { field: string; ascending: boolean }
  }
}

export async function getPageFilters(studioId: string): Promise<PageFilters> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}
  const { data } = await supabase
    .from('user_preferences')
    .select('page_filters')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .maybeSingle()
  return (data?.page_filters as PageFilters) ?? {}
}

export async function savePageFilters(studioId: string, pageFilters: PageFilters): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { data: existing } = await supabase
    .from('user_preferences')
    .select('id, page_filters')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .maybeSingle()
  const merged = { ...(existing?.page_filters as PageFilters ?? {}), ...pageFilters }
  if (existing) {
    await supabase
      .from('user_preferences')
      .update({ page_filters: merged })
      .eq('user_id', user.id)
      .eq('studio_id', studioId)
  } else {
    await supabase
      .from('user_preferences')
      .insert({ user_id: user.id, studio_id: studioId, page_filters: merged })
  }
}

// ── Retell Sync ────────────────────────────────────────────────────────────────

const VALID_DISCONNECT_REASONS_SYNC = new Set([
  'agent_hangup', 'user_hangup', 'voicemail', 'voicemail_reached', 'dial_no_answer', 'dial_busy', 'call_transfer',
])
const UUID_REGEX_SYNC = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatTranscriptSync(transcript: any): string | null {
  if (!transcript) return null
  if (typeof transcript === 'string') return transcript
  if (!Array.isArray(transcript)) return null
  const lines: string[] = []
  for (const turn of transcript) {
    if (turn.role === 'agent' && turn.content) lines.push(`Agent: ${turn.content}`)
    else if (turn.role === 'user' && turn.content) lines.push(`User: ${turn.content}`)
  }
  return lines.length > 0 ? lines.join('\n') : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRetellCallSync(studioId: string, call: any) {
  const durationSeconds = call.end_timestamp && call.start_timestamp
    ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
    : null
  const disconnectionReason = (call.disconnection_reason ?? '').toLowerCase()
  const rawSentiment = call.call_analysis?.user_sentiment?.toLowerCase() ?? 'unknown'
  const sentiment = ['positive', 'neutral', 'negative', 'unknown'].includes(rawSentiment) ? rawSentiment : 'unknown'
  const leadId = call.metadata?.lead_id
  return {
    studio_id:           studioId,
    retell_call_id:      call.call_id,
    created_at:          new Date(call.start_timestamp).toISOString(),
    duration_seconds:    durationSeconds,
    sentiment,
    outcome:             call.call_analysis?.call_successful === true ? 'successful'
                           : call.call_analysis?.call_successful === false ? 'unsuccessful' : null,
    disconnected_reason: VALID_DISCONNECT_REASONS_SYNC.has(disconnectionReason) ? disconnectionReason : null,
    picked_up:           !['dial_no_answer', 'dial_busy'].includes(disconnectionReason),
    transferred:         disconnectionReason === 'call_transfer',
    voicemail:           disconnectionReason === 'voicemail' || disconnectionReason === 'voicemail_reached',
    direction:           call.direction ?? null,
    transcript_summary:  call.call_analysis?.call_summary ?? null,
    transcript:          formatTranscriptSync(call.transcript),
    lead_id:             leadId && UUID_REGEX_SYNC.test(leadId) ? leadId : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recording_url:       (call as any).recording_url ?? null,
    caller_phone:        call.from_number ?? null,
    called_phone:        call.to_number ?? null,
  }
}

export async function syncRetellCallsNow(studioId: string): Promise<{ synced: number; error?: string }> {
  // Auth + membership check — this action triggers live Retell API calls
  const authSupabase = await createClient()
  const { data: { user } } = await authSupabase.auth.getUser()
  if (!user) return { synced: 0, error: 'Unauthorized' }

  const { data: membership } = await authSupabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .maybeSingle()
  const { data: allMemberships } = await authSupabase.from('studio_users').select('role').eq('user_id', user.id)
  const isSuperAdmin = allMemberships?.some(m => m.role === 'super_admin') ?? false
  if (!membership && !isSuperAdmin) return { synced: 0, error: 'Unauthorized' }

  const supabase = createServiceClient()

  const { data: studio } = await supabase
    .from('studios')
    .select('retell_agent_id, retell_api_key')
    .eq('id', studioId)
    .single()

  if (!studio?.retell_agent_id) return { synced: 0, error: 'No Retell agent ID configured for this studio' }

  const apiKey = studio.retell_api_key
  if (!apiKey) return { synced: 0, error: 'No Retell API key set — add it in Business Profile settings' }

  // Start from the most recent call we already have (with 1-min overlap to avoid gaps)
  // Falls back to 7 days if no calls exist yet
  const { data: latest } = await supabase
    .from('calls')
    .select('created_at')
    .eq('studio_id', studioId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const afterTimestamp = latest?.created_at
    ? new Date(latest.created_at).getTime() - 60_000
    : Date.now() - 7 * 24 * 60 * 60 * 1000

  const res = await fetch('https://api.retellai.com/v2/list-calls', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter_criteria: { agent_id: [studio.retell_agent_id], after_start_timestamp: afterTimestamp },
      limit: 500,
      sort_order: 'descending',
    }),
  })

  if (!res.ok) return { synced: 0, error: `Retell API error: ${res.status}` }

  const data = await res.json()
  const calls: unknown[] = Array.isArray(data) ? data : (data.calls ?? [])
  if (!calls.length) return { synced: 0 }

  const rows = calls.map(c => mapRetellCallSync(studioId, c))
  const { error } = await supabase.from('calls').upsert(rows, { onConflict: 'retell_call_id' })
  if (error) return { synced: 0, error: error.message }

  // Link unlinked calls to leads via Retell dynamic variables (email / phone)
  const retellIds = rows.filter(r => !r.lead_id).map(r => r.retell_call_id)
  if (retellIds.length > 0) {
    const { data: unlinked } = await supabase
      .from('calls')
      .select('id, retell_call_id')
      .in('retell_call_id', retellIds)
      .is('lead_id', null)

    for (const call of unlinked ?? []) {
      try {
        const detailRes = await fetch(`https://api.retellai.com/v2/get-call/${call.retell_call_id}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        })
        if (!detailRes.ok) continue
        const detail = await detailRes.json()
        const vars = detail.retell_llm_dynamic_variables ?? {}
        const email = typeof vars.email === 'string' ? vars.email.trim().toLowerCase() : null
        const phone = typeof vars.phone_number === 'string' ? vars.phone_number.trim() : null

        if (!email && !phone) continue

        // Try email first, then phone
        let leadId: string | null = null
        if (email) {
          const { data: byEmail } = await supabase
            .from('leads')
            .select('id')
            .eq('studio_id', studioId)
            .ilike('email', email)
            .limit(1)
            .maybeSingle()
          if (byEmail) leadId = byEmail.id
        }
        if (!leadId && phone) {
          const { data: byPhone } = await supabase
            .from('leads')
            .select('id')
            .eq('studio_id', studioId)
            .ilike('phone', `%${phone}%`)
            .limit(1)
            .maybeSingle()
          if (byPhone) leadId = byPhone.id
        }

        if (leadId) {
          await supabase.from('calls').update({ lead_id: leadId }).eq('id', call.id)
        }
      } catch {
        // Non-fatal — skip this call
      }
    }
  }

  return { synced: rows.length }
}

// ── Call Analytics ─────────────────────────────────────────────────────────────

import type { CallAnalyticsData, Call } from '@/lib/types'
import { groupCallsByDay, groupDurationByDay } from '@/lib/date-utils'

export async function fetchCallsAnalytics(
  studioId: string,
  from: string,
  to: string,
): Promise<CallAnalyticsData> {
  const { client } = await getAuthorizedClient()
  const { data: studioRow } = await client.from('studios').select('timezone').eq('id', studioId).maybeSingle()
  const tz = studioRow?.timezone ?? 'America/Chicago'
  const { data, error } = await client
    .from('calls')
    .select('id,retell_call_id,created_at,duration_seconds,sentiment,outcome,disconnected_reason,picked_up,transferred,voicemail,direction,transcript_summary,lead_id,quality_score,appointment_booked')
    .eq('studio_id', studioId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  const calls = (data ?? []) as Omit<Call, 'transcript'>[]

  const totalCalls          = calls.length
  const totalDurationSeconds = calls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0)
  const appointmentsBooked  = calls.filter(c => c.appointment_booked).length
  const qualityCalls        = calls.filter(c => c.quality_score != null)
  const avgQualityScore     = qualityCalls.length
    ? Math.round(qualityCalls.reduce((s, c) => s + (c.quality_score ?? 0), 0) / qualityCalls.length * 10) / 10
    : null
  const successRate         = totalCalls ? calls.filter(c => c.outcome === 'successful').length / totalCalls : 0
  const pickupRate          = totalCalls ? calls.filter(c => c.picked_up).length / totalCalls : 0
  const volumeByDay         = groupCallsByDay(calls, tz)

  const sentimentCounts: Record<string, number> = {}
  const disconnectCounts: Record<string, number> = {}
  const outcomeCounts: Record<string, number> = {}
  for (const c of calls) {
    if (c.sentiment)            sentimentCounts[c.sentiment]              = (sentimentCounts[c.sentiment]              ?? 0) + 1
    if (c.disconnected_reason)  disconnectCounts[c.disconnected_reason]   = (disconnectCounts[c.disconnected_reason]   ?? 0) + 1
    if (c.outcome)              outcomeCounts[c.outcome]                  = (outcomeCounts[c.outcome]                  ?? 0) + 1
  }

  return {
    calls, volumeByDay, totalCalls, totalDurationSeconds,
    appointmentsBooked, avgQualityScore,
    successRate, pickupRate,
    sentimentCounts, disconnectCounts, outcomeCounts,
  }
}

export type TranscriptCallRow = Pick<Call,
  'id' | 'retell_call_id' | 'created_at' | 'duration_seconds' | 'outcome' | 'sentiment' |
  'transcript_summary' | 'lead_id' | 'direction' | 'disconnected_reason' | 'quality_score' |
  'appointment_booked' | 'recording_url'
> & { transcript?: string | null; lead_name: string | null; lead_phone: string | null }

export async function fetchCallTranscripts(
  studioId: string,
  from: string,
  to: string,
  page = 1,
  pageSize = 20,
  direction?: 'all' | 'inbound' | 'outbound'
): Promise<{ calls: TranscriptCallRow[]; total: number }> {
  const { client } = await getAuthorizedClient()
  const offset = (page - 1) * pageSize

  let query = client
    .from('calls')
    .select('id,retell_call_id,created_at,duration_seconds,outcome,sentiment,transcript_summary,lead_id,direction,disconnected_reason,quality_score,appointment_booked,recording_url', { count: 'exact' })
    .eq('studio_id', studioId)
    .gte('created_at', from)
    .lte('created_at', to)

  if (direction && direction !== 'all') {
    query = query.eq('direction', direction)
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (error) throw new Error(error.message)

  const rows = data ?? []
  const leadIds = [...new Set(rows.filter(c => c.lead_id).map(c => c.lead_id as string))]
  const leadNames: Record<string, string> = {}
  const leadPhones: Record<string, string> = {}
  if (leadIds.length) {
    const { data: leads } = await client.from('leads').select('id,name,phone').in('id', leadIds)
    for (const l of leads ?? []) {
      leadNames[l.id] = l.name
      if (l.phone) leadPhones[l.id] = l.phone
    }
  }

  return {
    calls: rows.map(c => ({
      ...c,
      lead_name:  c.lead_id ? (leadNames[c.lead_id]  ?? null) : null,
      lead_phone: c.lead_id ? (leadPhones[c.lead_id] ?? null) : null,
    })) as TranscriptCallRow[],
    total: count ?? 0,
  }
}

// ── Call History ──────────────────────────────────────────────────────────────

export type CallHistoryRow = Pick<Call,
  'id' | 'retell_call_id' | 'created_at' | 'duration_seconds' | 'outcome' | 'sentiment' |
  'transcript_summary' | 'lead_id' | 'direction' | 'disconnected_reason' | 'quality_score' |
  'appointment_booked' | 'recording_url' | 'picked_up' | 'transferred'
> & {
  transcript?: string | null
  lead_name: string | null
  lead_phone: string | null
  is_callback?: boolean
  last_missed_outbound_at?: string | null
  voicemail_left?: boolean | null
  booking_successful?: boolean | null
  booking_attempted?: boolean | null
  callback_requested?: boolean | null
}

export interface CallHistoryParams {
  studioId: string
  tab: 'all' | 'outbound' | 'inbound' | 'failed' | 'callbacks'
  search?: string
  filters?: {
    direction?: string
    sentiment?: string[]
    outcome?: string
    appointmentBooked?: string
    bookingAttempted?: string
    callbackRequested?: string
    disconnectedReason?: string[]
    qualityScore?: { op: string; value: string }
    dateFrom?: string
    dateTo?: string
    callbackOnly?: boolean
  }
  page?: number
  pageSize?: number
  sort?: { field: string; ascending: boolean }
}

export async function fetchCallHistory(params: CallHistoryParams): Promise<{ calls: CallHistoryRow[]; total: number }> {
  const { client } = await getAuthorizedClient()
  const {
    studioId, tab, search = '', filters = {},
    page = 1, pageSize = 50,
    sort = { field: 'created_at', ascending: false },
  } = params
  const offset = (page - 1) * pageSize

  // If searching by lead name/phone, resolve matching lead IDs first
  let searchLeadIds: string[] | null = null
  if (search.trim()) {
    const term = `%${search.trim()}%`
    const { data: matchingLeads } = await client
      .from('leads')
      .select('id')
      .eq('studio_id', studioId)
      .or(`name.ilike.${term},phone.ilike.${term}`)
      .limit(500)
    searchLeadIds = (matchingLeads ?? []).map(l => l.id)
    if (searchLeadIds.length === 0) return { calls: [], total: 0 }
  }

  // "Booking Attempted" filter — pre-query call_reviews for matching call IDs.
  // call_reviews is the source of truth for booking outcomes (calls.appointment_booked
  // is sometimes flipped true by n8n for attempts that didn't actually succeed).
  let bookingAttemptedCallIds: string[] | null = null
  if (filters.bookingAttempted === 'yes') {
    const { data: attemptedReviews } = await client
      .from('call_reviews')
      .select('call_id')
      .eq('studio_id', studioId)
      .eq('booking_attempted', true)
      .eq('booking_successful', false)
    bookingAttemptedCallIds = (attemptedReviews ?? []).map(r => r.call_id as string)
    if (bookingAttemptedCallIds.length === 0) return { calls: [], total: 0 }
  }

  // "Callback Requested" filter — pre-query call_reviews where caller asked for a
  // callback and the call didn't already result in a successful booking.
  let callbackRequestedCallIds: string[] | null = null
  if (filters.callbackRequested === 'yes') {
    const { data: callbackReviews } = await client
      .from('call_reviews')
      .select('call_id,booking_successful')
      .eq('studio_id', studioId)
      .eq('callback_requested', true)
    callbackRequestedCallIds = (callbackReviews ?? [])
      .filter(r => r.booking_successful !== true)
      .map(r => r.call_id as string)
    if (callbackRequestedCallIds.length === 0) return { calls: [], total: 0 }
  }

  // For callbacks tab or callbackOnly filter, find leads with missed outbound calls first
  let callbackLeadIds: Set<string> | null = null
  const needCallbackDetection = tab === 'callbacks' || tab === 'all' || tab === 'inbound' || filters.callbackOnly
  if (tab === 'callbacks' || filters.callbackOnly) {
    // Find lead IDs that have at least one missed outbound call in this studio
    const { data: missedOutbound } = await client
      .from('calls')
      .select('lead_id')
      .eq('studio_id', studioId)
      .eq('direction', 'outbound')
      .eq('picked_up', false)
      .not('lead_id', 'is', null)
    callbackLeadIds = new Set((missedOutbound ?? []).map(c => c.lead_id as string))
    if (callbackLeadIds.size === 0) return { calls: [], total: 0 }
  }

  let query = client
    .from('calls')
    .select('id,retell_call_id,created_at,duration_seconds,outcome,sentiment,transcript_summary,lead_id,direction,disconnected_reason,quality_score,appointment_booked,recording_url,picked_up,transferred', { count: 'exact' })
    .eq('studio_id', studioId)

  // Tab filters
  if (tab === 'outbound') {
    query = query.eq('direction', 'outbound')
  } else if (tab === 'inbound' || tab === 'callbacks') {
    query = query.eq('direction', 'inbound')
  } else if (tab === 'failed') {
    query = query.or('picked_up.eq.false,outcome.eq.unsuccessful,disconnected_reason.in.(voicemail,voicemail_reached,dial_no_answer,dial_busy)')
  }

  // For callbacks tab or filter, restrict to leads with missed outbound calls
  if (callbackLeadIds) {
    const ids = [...callbackLeadIds]
    if (ids.length > 0) query = query.in('lead_id', ids)
  }

  // Search by lead IDs
  if (searchLeadIds) {
    query = query.in('lead_id', searchLeadIds)
  }

  // Restrict to calls flagged "Booking Attempted" in their AI review
  if (bookingAttemptedCallIds) {
    query = query.in('id', bookingAttemptedCallIds)
  }

  // Restrict to calls flagged "Callback Requested" in their AI review
  if (callbackRequestedCallIds) {
    query = query.in('id', callbackRequestedCallIds)
  }

  // Additional filters
  if (filters.direction && filters.direction !== 'all') {
    query = query.eq('direction', filters.direction)
  }
  if (filters.sentiment && filters.sentiment.length > 0) {
    query = query.in('sentiment', filters.sentiment)
  }
  if (filters.outcome) {
    query = query.eq('outcome', filters.outcome)
  }
  if (filters.appointmentBooked) {
    query = query.eq('appointment_booked', filters.appointmentBooked === 'yes')
  }
  if (filters.disconnectedReason && filters.disconnectedReason.length > 0) {
    const reasons = filters.disconnectedReason.includes('voicemail') && !filters.disconnectedReason.includes('voicemail_reached')
      ? [...filters.disconnectedReason, 'voicemail_reached']
      : filters.disconnectedReason
    query = query.in('disconnected_reason', reasons)
  }
  if (filters.qualityScore?.value) {
    const val = parseFloat(filters.qualityScore.value)
    if (!isNaN(val)) {
      const op = filters.qualityScore.op
      if (op === '>=') query = query.gte('quality_score', val)
      else if (op === '<=') query = query.lte('quality_score', val)
      else if (op === '>') query = query.gt('quality_score', val)
      else if (op === '<') query = query.lt('quality_score', val)
      else if (op === '=') query = query.eq('quality_score', val)
    }
  }
  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo)
  }

  // Sort
  const sortCol = ['created_at', 'duration_seconds', 'quality_score'].includes(sort.field) ? sort.field : 'created_at'
  query = query.order(sortCol, { ascending: sort.ascending })

  // Paginate
  const { data, error, count } = await query.range(offset, offset + pageSize - 1)
  if (error) throw new Error(error.message)

  const rows = data ?? []
  const leadIds = [...new Set(rows.filter(c => c.lead_id).map(c => c.lead_id as string))]
  const leadNames: Record<string, string> = {}
  const leadPhones: Record<string, string> = {}
  if (leadIds.length) {
    const { data: leads } = await client.from('leads').select('id,name,phone').in('id', leadIds)
    for (const l of leads ?? []) {
      leadNames[l.id] = l.name
      if (l.phone) leadPhones[l.id] = l.phone
    }
  }

  // For callback detection on all/inbound tabs, find which inbound rows are callbacks
  let callbackLeadIdsForFlag: Set<string> | null = callbackLeadIds
  if (needCallbackDetection && !callbackLeadIds) {
    const inboundLeadIds = rows
      .filter(c => c.direction === 'inbound' && c.lead_id)
      .map(c => c.lead_id as string)
    if (inboundLeadIds.length > 0) {
      const { data: missedOutbound } = await client
        .from('calls')
        .select('lead_id')
        .eq('studio_id', studioId)
        .eq('direction', 'outbound')
        .eq('picked_up', false)
        .in('lead_id', inboundLeadIds)
      callbackLeadIdsForFlag = new Set((missedOutbound ?? []).map(c => c.lead_id as string))
    }
  }

  // For voicemail rows, fetch transcripts and detect whether agent actually left a message.
  // Heuristic: agent's total speech across all turns must be substantive (≥100 chars).
  // Don't use User: turn count — voicemail greetings get transcribed as User turns too,
  // which mis-flagged short hang-ups as "Left Voicemail" (e.g. agent just said "Hi X, this is ").
  const voicemailLeftMap: Record<string, boolean> = {}
  const voicemailIds = rows.filter(c => c.disconnected_reason === 'voicemail' || c.disconnected_reason === 'voicemail_reached').map(c => c.id)
  if (voicemailIds.length > 0) {
    const { data: vmRows } = await client
      .from('calls')
      .select('id,transcript,duration_seconds')
      .in('id', voicemailIds)
    for (const v of vmRows ?? []) {
      const t = v.transcript as string | null
      const dur = v.duration_seconds as number | null
      if (!t) { voicemailLeftMap[v.id] = false; continue }
      const agentText = t.split('\n')
        .filter(l => l.startsWith('Agent:'))
        .map(l => l.replace(/^Agent:\s*/, '').trim())
        .join(' ')
      voicemailLeftMap[v.id] = agentText.length >= 100 && (dur ?? 0) >= 10
    }
  }

  // Fetch AI-reviewed booking outcome for each call in the page (call_reviews is the
  // source of truth: calls.appointment_booked is sometimes flipped true on attempts
  // that didn't succeed). Falls back to calls.appointment_booked when no review exists.
  const reviewMap: Record<string, { attempted: boolean | null; successful: boolean | null; callback: boolean | null }> = {}
  const callIds = rows.map(c => c.id)
  if (callIds.length > 0) {
    const { data: reviews } = await client
      .from('call_reviews')
      .select('call_id,booking_attempted,booking_successful,callback_requested')
      .in('call_id', callIds)
    for (const r of reviews ?? []) {
      reviewMap[r.call_id as string] = {
        attempted: r.booking_attempted as boolean | null,
        successful: r.booking_successful as boolean | null,
        callback: r.callback_requested as boolean | null,
      }
    }
  }

  // For callbacks, fetch the last missed outbound date per lead
  const lastMissedMap: Record<string, string> = {}
  if ((tab === 'callbacks' || needCallbackDetection) && callbackLeadIdsForFlag && callbackLeadIdsForFlag.size > 0) {
    const cbIds = [...callbackLeadIdsForFlag]
    const { data: missedCalls } = await client
      .from('calls')
      .select('lead_id,created_at')
      .eq('studio_id', studioId)
      .eq('direction', 'outbound')
      .eq('picked_up', false)
      .in('lead_id', cbIds)
      .order('created_at', { ascending: false })
    for (const mc of missedCalls ?? []) {
      if (mc.lead_id && !lastMissedMap[mc.lead_id]) {
        lastMissedMap[mc.lead_id] = mc.created_at
      }
    }
  }

  return {
    calls: rows.map(c => {
      const isCallback = c.direction === 'inbound' && !!c.lead_id && !!(callbackLeadIdsForFlag?.has(c.lead_id))
      const review = reviewMap[c.id]
      return {
        ...c,
        lead_name:  c.lead_id ? (leadNames[c.lead_id]  ?? null) : null,
        lead_phone: c.lead_id ? (leadPhones[c.lead_id] ?? null) : null,
        is_callback: isCallback,
        last_missed_outbound_at: isCallback && c.lead_id ? (lastMissedMap[c.lead_id] ?? null) : null,
        voicemail_left: (c.disconnected_reason === 'voicemail' || c.disconnected_reason === 'voicemail_reached') ? (voicemailLeftMap[c.id] ?? false) : null,
        booking_attempted: review?.attempted ?? null,
        booking_successful: review?.successful ?? null,
        callback_requested: review?.callback ?? null,
      }
    }) as CallHistoryRow[],
    total: count ?? 0,
  }
}

export async function fetchCallsForLead(
  leadId: string,
  studioId: string,
): Promise<TranscriptCallRow[]> {
  const { client } = await getAuthorizedClient()
  const { data: lead } = await client.from('leads').select('name').eq('id', leadId).single()
  const leadName = lead?.name ?? null

  const { data, error } = await client
    .from('calls')
    .select('id,retell_call_id,created_at,duration_seconds,outcome,sentiment,transcript_summary,lead_id,direction,disconnected_reason,quality_score,appointment_booked,recording_url')
    .eq('studio_id', studioId)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map(c => ({ ...c, lead_name: leadName })) as TranscriptCallRow[]
}

export async function refreshSingleCallFromRetell(callId: string, studioId: string): Promise<TranscriptCallRow | null> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return null

  const supabase = createServiceClient()

  const { data: call } = await supabase
    .from('calls')
    .select('retell_call_id')
    .eq('id', callId)
    .single()

  if (!call?.retell_call_id) return null

  const { data: studio } = await supabase
    .from('studios')
    .select('retell_api_key')
    .eq('id', studioId)
    .single()

  const apiKey = studio?.retell_api_key
  if (!apiKey) return null

  const res = await fetch(`https://api.retellai.com/v2/get-call/${call.retell_call_id}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  if (!res.ok) return null

  const retellCall = await res.json()
  const row = mapRetellCallSync(studioId, retellCall)

  // Extract transcript_with_tool_calls from fresh Retell response
  const freshToolCalls = Array.isArray(retellCall.transcript_with_tool_calls) && retellCall.transcript_with_tool_calls.length > 0
    ? retellCall.transcript_with_tool_calls
    : null

  // Only update mutable fields — never overwrite id, studio_id, retell_call_id, created_at, or lead_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('calls') as any).update({
    duration_seconds:             row.duration_seconds,
    sentiment:                    row.sentiment,
    outcome:                      row.outcome,
    disconnected_reason:          row.disconnected_reason,
    picked_up:                    row.picked_up,
    transferred:                  row.transferred,
    voicemail:                    row.voicemail,
    direction:                    row.direction,
    transcript_summary:           row.transcript_summary,
    transcript:                   row.transcript,
    recording_url:                row.recording_url,
    transcript_with_tool_calls:   freshToolCalls,
    caller_phone:                 row.caller_phone,
    called_phone:                 row.called_phone,
  }).eq('id', callId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated } = await (supabase.from('calls') as any)
    .select('id,retell_call_id,created_at,duration_seconds,outcome,sentiment,transcript_summary,transcript,lead_id,direction,disconnected_reason,quality_score,appointment_booked,recording_url,transcript_with_tool_calls')
    .eq('id', callId)
    .single()

  if (!updated) return null

  let lead_name: string | null = null
  let lead_phone: string | null = null
  if (updated.lead_id) {
    const { data: lead } = await supabase.from('leads').select('name,phone').eq('id', updated.lead_id).single()
    lead_name  = lead?.name  ?? null
    lead_phone = lead?.phone ?? null
  }

  return { ...updated, lead_name, lead_phone, transcript: updated.transcript ?? null } as TranscriptCallRow
}

export async function fetchCallTranscriptText(callId: string): Promise<string | null> {
  const { client } = await getAuthorizedClient()
  const { data, error } = await client.from('calls').select('transcript').eq('id', callId).single()
  if (error) throw new Error(error.message)
  return data?.transcript ?? null
}

// ── Enriched transcript types ──────────────────────────────────────────────────

export type RetellTranscriptItem =
  | { role: 'agent'; content: string; words: { word: string; start: number; end: number }[]; metadata?: { response_id: number } }
  | { role: 'user';  content: string; words: { word: string; start: number; end: number }[] }
  | { role: 'node_transition'; former_node_id: string; former_node_name: string; new_node_id: string; new_node_name: string; time_sec: number; transition_type: string }
  | { role: 'tool_call_invocation'; tool_call_id: string; name: string; arguments: string; time_sec: number; type: string }
  | { role: 'tool_call_result';     tool_call_id: string; successful: boolean; content: string; time_sec: number }

/** Fetches both plain transcript text AND the enriched transcript_with_tool_calls array in one query. */
export async function fetchCallTranscriptFull(callId: string): Promise<{
  transcript: string | null
  transcriptWithToolCalls: RetellTranscriptItem[] | null
}> {
  const { client } = await getAuthorizedClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from('calls') as any)
    .select('transcript, transcript_with_tool_calls')
    .eq('id', callId)
    .single()
  if (error) throw new Error(error.message)
  return {
    transcript: data?.transcript ?? null,
    transcriptWithToolCalls: Array.isArray(data?.transcript_with_tool_calls)
      ? (data.transcript_with_tool_calls as RetellTranscriptItem[])
      : null,
  }
}

// ── Calendar ─────────────────────────────────────────────────────────────────

import type { Appointment } from '@/lib/types'

export async function findLeadsByContactIds(
  contactIds: string[],
  studioId: string,
): Promise<Record<string, Lead>> {
  if (!contactIds.length) return {}
  const supabase = await createClient()
  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('studio_id', studioId)
    .in('ghl_contact_id', contactIds)
  const map: Record<string, Lead> = {}
  for (const row of data ?? []) {
    if (row.ghl_contact_id) map[row.ghl_contact_id] = row as Lead
  }
  return map
}

export async function getCalendarAppointments(
  studioId: string,
  startTime: string,
  endTime: string,
): Promise<Appointment[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .eq('studio_id', studioId)
    .is('deleted_at', null)
    .gte('start_time', startTime)
    .lte('start_time', endTime)
    .order('start_time', { ascending: true })
  return (data ?? []) as Appointment[]
}

/**
 * Reschedules an appointment: updates GHL first (fatal on conflict), then Supabase.
 * newStartTime / newEndTime are naive local ISO strings e.g. "2026-04-21T15:30:00"
 */
export async function rescheduleAppointment(
  appointmentId: string,
  newStartTime: string,
  newEndTime: string,
): Promise<{ error?: string; newId?: string }> {
  // Auth check
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createServiceClient()

  // Fetch full appointment so we can preserve all fields in the GHL PUT
  const { data: appt } = await supabase
    .from('appointments')
    .select('calendar_id, studio_id, title, contact_id, contact_name, status, assigned_user_id, notes, address')
    .eq('id', appointmentId)
    .single()

  if (!appt?.calendar_id) return { error: 'Appointment not found' }

  // Verify user has membership for this studio
  const { data: membership } = await authClient
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('studio_id', appt.studio_id)
    .single()
  // super_admin may not have a per-studio membership row — check all memberships
  const { data: allMemberships } = await authClient.from('studio_users').select('role').eq('user_id', user.id)
  const isSuperAdmin = allMemberships?.some(m => m.role === 'super_admin') ?? false
  if (!membership && !isSuperAdmin) return { error: 'Unauthorized' }

  const { data: studio } = await supabase
    .from('studios')
    .select('ghl_account_id, ghl_api_key, timezone')
    .eq('id', appt.studio_id)
    .single()

  const locationId = studio?.ghl_account_id ?? null

  // GHL first — will throw if the slot is taken or any other error
  // Pass all existing fields so GHL doesn't reset them to defaults
  let ghlNewId: string | undefined
  try {
    const result = await updateGHLAppointment(appointmentId, appt.calendar_id, newStartTime, newEndTime, locationId, {
      title:             appt.title,
      contactId:         appt.contact_id,
      appointmentStatus: appt.status,
      assignedUserId:    appt.assigned_user_id,
      notes:             appt.notes,
      address:           appt.address,
      timezone:          studio?.timezone ?? undefined,
    }, studio?.ghl_api_key ?? undefined)
    ghlNewId = result.newId
  } catch (e) {
    return { error: (e as Error).message }
  }

  // GHL succeeded — update Supabase.
  // If GHL assigned a new ID after rescheduling, update the primary key so
  // future deletes target the correct GHL record.
  const updates: Record<string, string> = {
    start_time: newStartTime,
    end_time: newEndTime,
    updated_at: new Date().toISOString(),
  }
  if (ghlNewId) updates.id = ghlNewId

  const { error } = await supabase
    .from('appointments')
    .update(updates)
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  // Emit appointment event so conversations chip updates in real-time.
  // newStartTime is a naive studio-local string — convert to UTC ISO before storing in timestamptz.
  const newStartUtc = naiveStudioLocalToUtcIso(newStartTime, studio?.timezone ?? 'America/Chicago')
  await supabase.from('appointment_events').insert({
    studio_id: appt.studio_id,
    appointment_id: ghlNewId ?? appointmentId,
    contact_id: appt.contact_id ?? null,
    verb: 'Updated',
    new_start_time: newStartUtc,
  })

  supabase.from('activity_logs').insert({
    studio_id:   appt.studio_id,
    lead_name:   (appt as Record<string, unknown>).contact_name as string ?? null,
    actor_email: user.email ?? null,
    event_type:  'appointment_rescheduled',
    source:      'app',
    changes:     [{ field: 'start_time', old_value: null, new_value: newStartTime }],
  }).then(() => {}, () => {})

  return { newId: ghlNewId }
}

export async function deleteAppointment(appointmentId: string): Promise<{ error?: string }> {
  // Auth check
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createServiceClient()

  // Fetch studio_id, contact_id, and contact_name before deleting
  const { data: appt } = await supabase
    .from('appointments')
    .select('studio_id, contact_id, contact_name')
    .eq('id', appointmentId)
    .single()

  if (!appt) return { error: 'Appointment not found' }

  const { data: studio } = await supabase
    .from('studios')
    .select('ghl_api_key')
    .eq('id', appt.studio_id)
    .single()

  // Verify user has membership for this studio
  const { data: membership } = await authClient
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('studio_id', appt.studio_id)
    .maybeSingle()
  const { data: allMemberships } = await authClient.from('studio_users').select('role').eq('user_id', user.id)
  const isSuperAdmin = allMemberships?.some(m => m.role === 'super_admin') ?? false
  if (!membership && !isSuperAdmin) return { error: 'Unauthorized' }

  const { error } = await supabase.from('appointments').update({
    deleted_at: new Date().toISOString(),
    status: 'cancelled',
    updated_at: new Date().toISOString(),
  }).eq('id', appointmentId)
  if (error) return { error: error.message }

  // Mirror deletion to GHL (non-fatal)
  await deleteGHLAppointment(appointmentId, studio?.ghl_api_key ?? undefined)

  // Emit appointment event
  if (appt) {
    await supabase.from('appointment_events').insert({
      studio_id: appt.studio_id,
      appointment_id: appointmentId,
      contact_id: appt.contact_id ?? null,
      verb: 'Deleted',
    })
    supabase.from('activity_logs').insert({
      studio_id:   appt.studio_id,
      lead_name:   (appt as Record<string, unknown>).contact_name as string ?? null,
      actor_email: user.email ?? null,
      event_type:  'appointment_deleted',
      source:      'app',
    }).then(() => {}, () => {})
  }

  return {}
}

/** Returns "HH:MM" start times of non-cancelled appointments on the given date for a studio. */
export async function fetchBookedSlotsForDate(studioId: string, date: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('appointments')
    .select('start_time')
    .eq('studio_id', studioId)
    .gte('start_time', `${date}T00:00:00`)
    .lte('start_time', `${date}T23:59:59`)
    .neq('status', 'cancelled')
  return (data ?? []).map((a: { start_time: string }) => a.start_time.substring(11, 16))
}

/** Updates title and/or notes on an appointment in GHL + Supabase. */
export async function updateAppointmentDetails(
  appointmentId: string,
  updates: { title?: string | null; notes?: string | null },
): Promise<{ error?: string }> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createServiceClient()

  const { data: appt } = await supabase
    .from('appointments')
    .select('calendar_id, studio_id, contact_id, contact_name')
    .eq('id', appointmentId)
    .single()

  if (!appt?.calendar_id) return { error: 'Appointment not found' }

  const { data: studio } = await supabase
    .from('studios')
    .select('ghl_api_key')
    .eq('id', appt.studio_id)
    .single()

  try {
    await patchGHLAppointmentDetails(appointmentId, appt.calendar_id, updates, studio?.ghl_api_key ?? undefined)
  } catch (e) {
    return { error: (e as Error).message }
  }

  const { error } = await supabase
    .from('appointments')
    .update({
      ...(updates.title !== undefined  && { title: updates.title }),
      ...(updates.notes !== undefined  && { notes: updates.notes }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  // Emit appointment event
  await supabase.from('appointment_events').insert({
    studio_id: appt.studio_id,
    appointment_id: appointmentId,
    contact_id: appt.contact_id ?? null,
    verb: 'Updated',
  })

  const detailChanges = [
    ...(updates.title !== undefined ? [{ field: 'title', old_value: null, new_value: updates.title ?? null }] : []),
    ...(updates.notes !== undefined ? [{ field: 'notes', old_value: null, new_value: updates.notes ?? null }] : []),
  ]
  supabase.from('activity_logs').insert({
    studio_id:   appt.studio_id,
    lead_name:   (appt as Record<string, unknown>).contact_name as string ?? null,
    actor_email: user.email ?? null,
    event_type:  'appointment_updated',
    source:      'app',
    changes:     detailChanges.length > 0 ? detailChanges : null,
  }).then(() => {}, () => {})

  return {}
}

export async function saveCalendarSettings(
  studioId: string,
  config: StudioSlotConfig,
  calStartHour: number,
  calEndHour: number,
): Promise<{ error?: string }> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  // Role check: must be studio_owner or super_admin for this studio
  const { data: membership } = await authClient
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .single()

  const { data: allMemberships } = await authClient.from('studio_users').select('role').eq('user_id', user.id)
  const isSuperAdmin = allMemberships?.some(m => m.role === 'super_admin') ?? false
  const role = membership?.role ?? null

  if (!isSuperAdmin && role !== 'studio_owner') {
    return { error: 'You do not have permission to edit calendar settings.' }
  }

  // Use service client so super_admins not in studio_users can still write
  const supabase = createServiceClient()

  // Validate
  if (!Number.isInteger(config.appointment_duration_minutes) || config.appointment_duration_minutes < 1) {
    return { error: 'Appointment duration must be at least 1 minute.' }
  }
  if (!Number.isInteger(config.appointment_min_advance_weeks) || config.appointment_min_advance_weeks < 1) {
    return { error: 'Minimum advance weeks must be at least 1.' }
  }
  if (!Number.isInteger(calStartHour) || calStartHour < 0 || calStartHour > 23) {
    return { error: 'Invalid calendar start hour.' }
  }
  if (!Number.isInteger(calEndHour) || calEndHour < 1 || calEndHour > 24) {
    return { error: 'Invalid calendar end hour.' }
  }
  if (calStartHour >= calEndHour) {
    return { error: 'Calendar start hour must be before end hour.' }
  }

  // Validate slot structure
  const validDow = new Set(['0', '1', '2', '3', '4', '5', '6'])
  const timeRegex = /^\d{2}:\d{2}$/
  for (const [dow, times] of Object.entries(config.appointment_slots)) {
    if (!validDow.has(dow) || !Array.isArray(times)) return { error: 'Invalid slot data.' }
    if (times.some(t => typeof t !== 'string' || !timeRegex.test(t))) return { error: 'Invalid time format in slots.' }
  }

  const { error } = await supabase
    .from('studios')
    .update({
      appointment_duration_minutes:  config.appointment_duration_minutes,
      appointment_min_advance_weeks: config.appointment_min_advance_weeks,
      appointment_slots:             config.appointment_slots,
      calendar_start_hour:           calStartHour,
      calendar_end_hour:             calEndHour,
    })
    .eq('id', studioId)

  if (error) return { error: error.message }
  return {}
}

/** Search leads by name for the contact typeahead in the create-appointment modal. */
export async function searchLeadsByName(
  studioId: string,
  query: string,
): Promise<{ id: string; name: string; ghl_contact_id: string | null }[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('leads')
    .select('id, name, ghl_contact_id')
    .eq('studio_id', studioId)
    .ilike('name', `%${query}%`)
    .order('name')
    .limit(300)
  return data ?? []
}

/** Creates a new appointment in GHL and upserts it into Supabase. */
export async function createAppointment(opts: {
  studioId: string
  contactId: string   // GHL contact ID — may be empty string if lead not yet in GHL
  leadId?: string     // ALMS lead UUID — used to auto-create GHL contact if contactId is missing
  contactName: string
  startTime: string   // naive local "YYYY-MM-DDThh:mm:ss"
  endTime: string
  title?: string
  notes?: string
}): Promise<{ error?: string; appointment?: import('@/lib/types').Appointment }> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createServiceClient()

  const { data: studio } = await supabase
    .from('studios')
    .select('ghl_account_id, ghl_calendar_id, ghl_api_key, timezone')
    .eq('id', opts.studioId)
    .single()

  if (!studio) return { error: 'Studio not found' }
  if (!studio.ghl_account_id) return { error: 'This studio is not connected to GHL. Set the GHL Location ID in Settings → Business Profile.' }
  if (!studio.ghl_calendar_id) return { error: 'No GHL calendar configured for this studio. Set the GHL Calendar ID in Settings → Business Profile.' }

  // Auto-create GHL contact if the lead has not been synced yet
  let resolvedContactId = opts.contactId
  if (!resolvedContactId && opts.leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('name, phone, email')
      .eq('id', opts.leadId)
      .single()
    if (lead) {
      const newGhlId = await createGHLContact(
        studio.ghl_account_id,
        { name: lead.name, phone: lead.phone, email: lead.email },
        studio.ghl_api_key ?? undefined,
      )
      if (newGhlId) {
        resolvedContactId = newGhlId
        await supabase.from('leads').update({ ghl_contact_id: newGhlId }).eq('id', opts.leadId)
      }
    }
  }

  if (!resolvedContactId) {
    return { error: 'Could not resolve GHL contact for this lead. Check that the studio has a valid GHL API key.' }
  }

  let ghlId: string
  try {
    ghlId = await createGHLAppointment({
      calendarId: studio.ghl_calendar_id,
      locationId: studio.ghl_account_id,
      contactId:  resolvedContactId,
      startTime:  opts.startTime,
      endTime:    opts.endTime,
      title:      opts.title ?? 'Dance Appointment',
      notes:      opts.notes,
      timezone:   studio.timezone,
      apiKey:     studio.ghl_api_key ?? undefined,
    })
  } catch (e) {
    return { error: (e as Error).message }
  }

  const now = new Date().toISOString()
  const row = {
    id:           ghlId,
    studio_id:    opts.studioId,
    title:        opts.title ?? 'Dance Appointment',
    start_time:   opts.startTime,
    end_time:     opts.endTime,
    status:       'confirmed',
    calendar_id:  studio.ghl_calendar_id,
    contact_id:   resolvedContactId,
    contact_name: opts.contactName,
    notes:        opts.notes ?? null,
    created_at:   now,
    updated_at:   now,
  }

  const { data: appt, error } = await supabase
    .from('appointments')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single()

  if (error) return { error: error.message }

  await supabase.from('appointment_events').insert({
    studio_id:      opts.studioId,
    appointment_id: ghlId,
    contact_id:     resolvedContactId,
    verb:           'Created',
  })

  supabase.from('activity_logs').insert({
    studio_id:   opts.studioId,
    lead_name:   opts.contactName,
    actor_email: user.email ?? null,
    event_type:  'appointment_created',
    source:      'app',
  }).then(() => {}, () => {})

  return { appointment: appt as import('@/lib/types').Appointment }
}

export async function fetchAppointmentList(
  studioId: string,
  filters: {
    search?: string
    statusFilters?: string[]
    dateFrom?: string
    dateTo?: string
  },
  sortField: 'start_time' | 'title' | 'status' = 'start_time',
  sortAscending = true,
  page = 1,
  pageSize = 20,
): Promise<{ appointments: import('@/lib/types').Appointment[]; total: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('appointments')
    .select('*', { count: 'exact' })
    .eq('studio_id', studioId)
    .is('deleted_at', null)

  if (filters.dateFrom) query = query.gte('start_time', `${filters.dateFrom}T00:00:00`)
  if (filters.dateTo) query = query.lte('start_time', `${filters.dateTo}T23:59:59`)
  if (filters.statusFilters?.length) query = query.in('status', filters.statusFilters)
  if (filters.search) {
    // Escape PostgREST filter metacharacters before embedding in the or() string
    const s = filters.search.trim().replace(/[%_\\*,()"]/g, '\\$&')
    query = query.or(`title.ilike.%${s}%,contact_name.ilike.%${s}%`)
  }

  query = query.order(sortField, { ascending: sortAscending })
  query = query.range((page - 1) * pageSize, page * pageSize - 1)

  const { data, count, error } = await query
  if (error) return { appointments: [], total: 0 }
  return { appointments: (data ?? []) as import('@/lib/types').Appointment[], total: count ?? 0 }
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: 'confirmed' | 'showed' | 'noshow' | 'cancelled' | 'invalid',
): Promise<{ error?: string }> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createServiceClient()

  const { data: appt } = await supabase
    .from('appointments')
    .select('calendar_id, studio_id, contact_id, contact_name')
    .eq('id', appointmentId)
    .single()

  if (!appt?.calendar_id) return { error: 'Appointment not found' }

  const { data: studio } = await supabase
    .from('studios')
    .select('ghl_api_key')
    .eq('id', appt.studio_id)
    .single()

  try {
    await patchGHLAppointmentDetails(appointmentId, appt.calendar_id, { appointmentStatus: status }, studio?.ghl_api_key ?? undefined)
  } catch {
    // GHL sync failure is non-fatal for status updates
  }

  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }

  const { error } = await supabase
    .from('appointments')
    .update(updates)
    .eq('id', appointmentId)

  if (error) return { error: error.message }

  const verbMap: Record<string, string> = {
    confirmed: 'Confirmed',
    showed:    'Showed',
    noshow:    'No Show',
    cancelled: 'Cancelled',
    invalid:   'Invalid',
  }
  await supabase.from('appointment_events').insert({
    studio_id:      appt.studio_id,
    appointment_id: appointmentId,
    contact_id:     appt.contact_id ?? null,
    verb:           verbMap[status] ?? 'Updated',
  })

  supabase.from('activity_logs').insert({
    studio_id:   appt.studio_id,
    lead_name:   (appt as Record<string, unknown>).contact_name as string ?? null,
    actor_email: user.email ?? null,
    event_type:  'appointment_updated',
    source:      'app',
    changes:     [{ field: 'status', old_value: null, new_value: status }],
  }).then(() => {}, () => {})

  return {}
}

// ── Call Reviews (Transcript Analyzer) ──────────────────────────────────

export async function fetchCallReviewsForCalls(
  callIds: string[]
): Promise<Record<string, { grade: 'Pass' | 'Fail'; summary: string | null }>> {
  if (callIds.length === 0) return {}
  const { client } = await getAuthorizedClient()
  const { data } = await client
    .from('call_reviews')
    .select('call_id, grade, summary')
    .in('call_id', callIds)
  const map: Record<string, { grade: 'Pass' | 'Fail'; summary: string | null }> = {}
  for (const row of data ?? []) {
    map[row.call_id] = { grade: row.grade, summary: row.summary }
  }
  return map
}

export async function fetchCallReviewFull(callId: string) {
  const { client } = await getAuthorizedClient()
  const { data, error } = await client
    .from('call_reviews')
    .select('*')
    .eq('call_id', callId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchUnreviewedCallIds(
  studioId: string
): Promise<string[]> {
  const { client } = await getAuthorizedClient()
  const { data: allCalls } = await client
    .from('calls')
    .select('id')
    .eq('studio_id', studioId)
    .not('transcript', 'is', null)
    .neq('voicemail', true)
    .gt('duration_seconds', 15)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!allCalls || allCalls.length === 0) return []

  const callIds = allCalls.map(c => c.id)
  const { data: reviewed } = await client
    .from('call_reviews')
    .select('call_id')
    .in('call_id', callIds)

  const reviewedSet = new Set((reviewed ?? []).map(r => r.call_id))
  return callIds.filter(id => !reviewedSet.has(id))
}

export async function triggerCallAnalysis(
  studioId: string,
  callIds: string[],
  force = false
): Promise<{ analyzed: number; skipped: number; errors: Array<{ callId: string; error: string }> }> {
  const { client, user } = await getAuthorizedClient()

  const { data: membership } = await client
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('studio_id', studioId)
    .in('role', ['super_admin', 'studio_owner'])
    .maybeSingle()

  if (!membership) throw new Error('Access denied')

  // Use a regular user client for session — service client won't have one
  const userClient = await createClient()
  const { data: { session } } = await userClient.auth.getSession()
  if (!session) throw new Error('No active session')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const response = await fetch(`${supabaseUrl}/functions/v1/analyze-call-quality`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ studio_id: studioId, call_ids: callIds, force }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error ?? `HTTP ${response.status}`)
  }

  return response.json()
}

// ── Call Quality Review ──────────────────────────────────────────────────────

export type QualityReviewRow = {
  review_id: string
  call_id: string
  grade: 'Pass' | 'Fail'
  summary: string | null
  agent_mistakes: string[]
  user_repeats: number
  booking_attempted: boolean | null
  booking_successful: boolean | null
  follow_up_needed: boolean
  follow_up_reason: string | null
  callback_requested: boolean
  voicemail_left: boolean | null
  topics_discussed: string[]
  trigger_type: 'manual' | 'cron'
  review_created_at: string
  // call fields
  call_created_at: string
  duration_seconds: number | null
  direction: 'inbound' | 'outbound' | null
  sentiment: string | null
  outcome: string | null
  quality_score: number | null
  appointment_booked: boolean | null
  recording_url: string | null
  lead_id: string | null
  retell_call_id: string
  picked_up: boolean | null
  transferred: boolean | null
  disconnected_reason: string | null
  transcript_summary: string | null
  // resolved
  lead_name: string | null
}

export interface QualityReviewParams {
  studioId: string
  filters?: {
    grade?: string
    direction?: string
    sentiment?: string[]
    result?: string[]
    qualityScore?: { op: string; value: string }
    dateFrom?: string
    dateTo?: string
    followUpNeeded?: boolean
    callbackRequested?: boolean
  }
  page?: number
  pageSize?: number
  sort?: { field: string; ascending: boolean }
}

export interface QualityKpis {
  totalReviewed: number
  totalEligible: number
  passCount: number
  failCount: number
  avgUserRepeats: number
  followUpNeededCount: number
  bookingAttempted: number
  bookingSuccessful: number
  topAgentMistakes: { mistake: string; count: number }[]
  topTopics: { topic: string; count: number }[]
}

export async function fetchQualityReviews(
  params: QualityReviewParams
): Promise<{ rows: QualityReviewRow[]; total: number }> {
  const { client } = await getAuthorizedClient()
  const {
    studioId, filters = {},
    page = 1, pageSize = 50,
    sort = { field: 'review_created_at', ascending: false },
  } = params
  const offset = (page - 1) * pageSize

  // 1. Query call_reviews with grade filter
  let reviewQuery = client
    .from('call_reviews')
    .select('id, call_id, grade, summary, agent_mistakes, user_repeats, booking_attempted, booking_successful, follow_up_needed, follow_up_reason, callback_requested, topics_discussed, trigger_type, created_at')
    .eq('studio_id', studioId)

  if (filters.grade && filters.grade !== 'all') {
    reviewQuery = reviewQuery.eq('grade', filters.grade)
  }
  if (filters.followUpNeeded) {
    reviewQuery = reviewQuery.eq('follow_up_needed', true)
  }
  if (filters.callbackRequested) {
    reviewQuery = reviewQuery.eq('callback_requested', true)
  }

  const { data: allReviews, error: revErr } = await reviewQuery
    .order('created_at', { ascending: false })
    .limit(2000)
  if (revErr) throw new Error(revErr.message)
  if (!allReviews || allReviews.length === 0) return { rows: [], total: 0 }

  // 2. Fetch matched calls
  const callIds = allReviews.map(r => r.call_id)
  const { data: calls } = await client
    .from('calls')
    .select('id, retell_call_id, created_at, duration_seconds, direction, sentiment, outcome, quality_score, appointment_booked, recording_url, lead_id, picked_up, transferred, disconnected_reason, transcript_summary, transcript')
    .in('id', callIds)
  const callMap = new Map((calls ?? []).map(c => [c.id, c]))

  // Detect whether agent actually left a voicemail message (same heuristic as fetchCallHistory).
  const voicemailLeftMap: Record<string, boolean> = {}
  for (const c of calls ?? []) {
    if (c.disconnected_reason !== 'voicemail' && c.disconnected_reason !== 'voicemail_reached') continue
    const t = c.transcript as string | null
    const dur = c.duration_seconds as number | null
    if (!t) { voicemailLeftMap[c.id] = false; continue }
    const agentText = t.split('\n')
      .filter((l: string) => l.startsWith('Agent:'))
      .map((l: string) => l.replace(/^Agent:\s*/, '').trim())
      .join(' ')
    voicemailLeftMap[c.id] = agentText.length >= 100 && (dur ?? 0) >= 10
  }

  // 3. Apply call-side filters
  let filtered = allReviews.filter(r => {
    const c = callMap.get(r.call_id)
    if (!c) return false
    if (filters.direction && filters.direction !== 'all' && c.direction !== filters.direction) return false
    if (filters.sentiment?.length && !filters.sentiment.includes(c.sentiment ?? '')) return false
    if (filters.result?.length) {
      const dr = c.disconnected_reason as string | null
      let result: string | null = null
      if (dr === 'voicemail' || dr === 'voicemail_reached') result = voicemailLeftMap[c.id] ? 'Left Voicemail' : 'Voicemail Reached'
      else if (dr === 'dial_no_answer') result = 'Did Not Pick Up'
      else if (dr === 'dial_busy') result = 'Busy'
      else if (c.transferred) result = 'Transferred'
      else if (r.booking_successful === true) result = 'Booked'
      else if (r.callback_requested) result = 'Callback Requested'
      else if (r.booking_successful === false && r.booking_attempted) result = 'Booking Attempted'
      else if (c.appointment_booked) result = 'Booked'
      else if (dr === 'ivr_reached') result = 'IVR Reached'
      else if (dr === 'inactivity') result = 'Inactivity'
      else if (dr === 'user_hangup') result = 'User Hung Up'
      else if (dr === 'agent_hangup') result = 'Agent Hung Up'
      else if (c.outcome === 'unsuccessful') result = 'Did Not Pick Up'
      if (!result || !filters.result.includes(result)) return false
    }
    if (filters.qualityScore?.value) {
      const val = parseFloat(filters.qualityScore.value)
      const score = c.quality_score
      if (!isNaN(val) && score != null) {
        const op = filters.qualityScore.op
        if (op === '>=' && score < val) return false
        if (op === '<=' && score > val) return false
        if (op === '>' && score <= val) return false
        if (op === '<' && score >= val) return false
        if (op === '=' && score !== val) return false
      } else if (score == null) return false
    }
    if (filters.dateFrom && c.created_at < filters.dateFrom) return false
    if (filters.dateTo && c.created_at > filters.dateTo) return false
    return true
  })

  // 4. Sort
  const sortField = sort.field
  filtered.sort((a, b) => {
    const ca = callMap.get(a.call_id)
    const cb = callMap.get(b.call_id)
    let va: number | string | null = null
    let vb: number | string | null = null
    if (sortField === 'review_created_at') { va = a.created_at; vb = b.created_at }
    else if (sortField === 'created_at') { va = ca?.created_at ?? ''; vb = cb?.created_at ?? '' }
    else if (sortField === 'duration_seconds') { va = ca?.duration_seconds ?? 0; vb = cb?.duration_seconds ?? 0 }
    else if (sortField === 'quality_score') { va = ca?.quality_score ?? 0; vb = cb?.quality_score ?? 0 }
    else if (sortField === 'grade') { va = a.grade; vb = b.grade }
    else if (sortField === 'issues') { va = (a.agent_mistakes ?? []).length; vb = (b.agent_mistakes ?? []).length }
    else { va = a.created_at; vb = b.created_at }
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sort.ascending ? cmp : -cmp
  })

  const total = filtered.length
  const page_items = filtered.slice(offset, offset + pageSize)

  // 5. Resolve lead names
  const leadIds = [...new Set(page_items.map(r => callMap.get(r.call_id)?.lead_id).filter(Boolean) as string[])]
  const leadNames: Record<string, string> = {}
  if (leadIds.length) {
    const { data: leads } = await client.from('leads').select('id, name').in('id', leadIds)
    for (const l of leads ?? []) leadNames[l.id] = l.name
  }

  return {
    rows: page_items.map(r => {
      const c = callMap.get(r.call_id)!
      return {
        review_id: r.id,
        call_id: r.call_id,
        grade: r.grade as 'Pass' | 'Fail',
        summary: r.summary,
        agent_mistakes: r.agent_mistakes ?? [],
        user_repeats: r.user_repeats ?? 0,
        booking_attempted: r.booking_attempted,
        booking_successful: r.booking_successful,
        follow_up_needed: r.follow_up_needed ?? false,
        follow_up_reason: r.follow_up_reason,
        callback_requested: r.callback_requested ?? false,
        voicemail_left: (c.disconnected_reason === 'voicemail' || c.disconnected_reason === 'voicemail_reached') ? (voicemailLeftMap[c.id] ?? false) : null,
        topics_discussed: r.topics_discussed ?? [],
        trigger_type: r.trigger_type as 'manual' | 'cron',
        review_created_at: r.created_at,
        call_created_at: c.created_at,
        duration_seconds: c.duration_seconds,
        direction: c.direction as 'inbound' | 'outbound' | null,
        sentiment: c.sentiment,
        outcome: c.outcome,
        quality_score: c.quality_score,
        appointment_booked: c.appointment_booked,
        recording_url: c.recording_url,
        lead_id: c.lead_id,
        retell_call_id: c.retell_call_id,
        picked_up: c.picked_up,
        transferred: c.transferred,
        disconnected_reason: c.disconnected_reason,
        transcript_summary: c.transcript_summary,
        lead_name: c.lead_id ? (leadNames[c.lead_id] ?? null) : null,
      }
    }),
    total,
  }
}

export async function fetchQualityKpis(
  studioId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<QualityKpis> {
  const { client } = await getAuthorizedClient()

  // Eligible calls count
  let eligibleQuery = client
    .from('calls')
    .select('id', { count: 'exact', head: true })
    .eq('studio_id', studioId)
    .not('transcript', 'is', null)
    .neq('voicemail', true)
    .gt('duration_seconds', 15)
  if (dateFrom) eligibleQuery = eligibleQuery.gte('created_at', dateFrom)
  if (dateTo) eligibleQuery = eligibleQuery.lte('created_at', dateTo)
  const { count: totalEligible } = await eligibleQuery

  // All reviews for aggregation
  let reviewQuery = client
    .from('call_reviews')
    .select('grade, agent_mistakes, user_repeats, booking_attempted, booking_successful, follow_up_needed, topics_discussed')
    .eq('studio_id', studioId)
  if (dateFrom) reviewQuery = reviewQuery.gte('created_at', dateFrom)
  if (dateTo) reviewQuery = reviewQuery.lte('created_at', dateTo)
  const { data: reviews } = await reviewQuery

  const all = reviews ?? []
  const passCount = all.filter(r => r.grade === 'Pass').length
  const failCount = all.filter(r => r.grade === 'Fail').length
  const avgUserRepeats = all.length > 0
    ? all.reduce((sum, r) => sum + (r.user_repeats ?? 0), 0) / all.length
    : 0
  const followUpNeededCount = all.filter(r => r.follow_up_needed).length
  const bookingAttempted = all.filter(r => r.booking_attempted).length
  const bookingSuccessful = all.filter(r => r.booking_successful).length

  // Aggregate agent mistakes
  const mistakeFreq: Record<string, number> = {}
  for (const r of all) {
    for (const m of r.agent_mistakes ?? []) {
      mistakeFreq[m] = (mistakeFreq[m] ?? 0) + 1
    }
  }
  const topAgentMistakes = Object.entries(mistakeFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mistake, count]) => ({ mistake, count }))

  // Aggregate topics
  const topicFreq: Record<string, number> = {}
  for (const r of all) {
    for (const t of r.topics_discussed ?? []) {
      topicFreq[t] = (topicFreq[t] ?? 0) + 1
    }
  }
  const topTopics = Object.entries(topicFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }))

  return {
    totalReviewed: all.length,
    totalEligible: totalEligible ?? 0,
    passCount,
    failCount,
    avgUserRepeats: Math.round(avgUserRepeats * 10) / 10,
    followUpNeededCount,
    bookingAttempted,
    bookingSuccessful,
    topAgentMistakes,
    topTopics,
  }
}

// ── Follow-ups KPIs ──────────────────────────────────────────────────────────

export interface FollowUpKpis {
  followUpCount: number
  callbackCount: number
  passRate: number
}

export async function fetchFollowUpKpis(studioId: string): Promise<FollowUpKpis> {
  const { client } = await getAuthorizedClient()

  const { data: reviews } = await client
    .from('call_reviews')
    .select('grade, follow_up_needed, callback_requested')
    .eq('studio_id', studioId)

  const all = reviews ?? []
  const followUpCount = all.filter(r => r.follow_up_needed).length
  const callbackCount = all.filter(r => r.callback_requested).length
  const followUpRows = all.filter(r => r.follow_up_needed || r.callback_requested)
  const passRate = followUpRows.length > 0
    ? Math.round((followUpRows.filter(r => r.grade === 'Pass').length / followUpRows.length) * 100)
    : 0

  return { followUpCount, callbackCount, passRate }
}

// ── Scheduled Callbacks (n8n AI Callback queue) ──────────────────────────────

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`
  return null
}

interface N8nCallbackRow {
  id: number
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  email: string | null
  dance_interest: string | null
  reason: string | null
  callback_time: string | null
  called_at: string | null
}

async function callN8nCallbacksWebhook<T>(
  url: string | undefined,
  body: object,
  options?: { emptyBodyFallback?: T },
): Promise<T> {
  if (!url) throw new Error('Scheduled Callbacks webhook URL not configured')
  const secret = process.env.N8N_SCHEDULED_CALLBACKS_SECRET
  if (!secret) throw new Error('Scheduled Callbacks webhook secret not configured')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Callbacks-Secret': secret,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const raw = await res.text().catch(() => '')

  if (!res.ok) {
    throw new Error(`Scheduled Callbacks webhook ${res.status}: ${raw.slice(0, 200) || '(empty body)'}`)
  }
  if (!raw.trim()) {
    // n8n's Respond to Webhook node returns an empty body when the upstream
    // data table query yields zero rows. Callers that expect a list shape can
    // opt into a fallback value instead of surfacing a misleading error.
    if (options && 'emptyBodyFallback' in options) return options.emptyBodyFallback as T
    throw new Error(
      `Scheduled Callbacks webhook returned empty body (status ${res.status}). ` +
      `Check that the n8n workflow is ACTIVE and the Respond to Webhook node is reached. URL: ${url}`,
    )
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`Scheduled Callbacks webhook returned non-JSON body: ${raw.slice(0, 200)}`)
  }
}

export async function fetchScheduledCallbacks(): Promise<ScheduledCallback[]> {
  const { client, user } = await getAuthorizedClient()

  const { data: memberships } = await client
    .from('studio_users')
    .select('studio_id, role')
    .eq('user_id', user.id)
  const isSuper = memberships?.some(m => m.role === 'super_admin') ?? false
  const userStudioIds = (memberships ?? []).map(m => m.studio_id)
  if (!isSuper && userStudioIds.length === 0) return []

  const response = await callN8nCallbacksWebhook<{ rows: N8nCallbackRow[] }>(
    process.env.N8N_SCHEDULED_CALLBACKS_LIST_URL,
    {},
    { emptyBodyFallback: { rows: [] } },
  )
  const n8nRows = response.rows ?? []
  if (n8nRows.length === 0) return []

  const normalizedSet = new Set<string>()
  for (const row of n8nRows) {
    const norm = normalizePhone(row.phone_number)
    if (norm) normalizedSet.add(norm)
  }
  if (normalizedSet.size === 0) return []

  // Paginate the leads fetch because Supabase enforces a project-level max_rows cap
  // (default 1000) that overrides .limit(). Pagination via .range() bypasses this.
  // Phone matching has to happen in JS via normalizePhone (handles format drift like
  // "(224) 469-0382" vs "+12244690382") — most stored phones aren't clean E.164.
  // Early-exit once every n8n phone has a lead match.
  const PAGE = 1000
  const targetMatches = normalizedSet.size
  const leadByPhone = new Map<string, { id: string; studio_id: string }>()
  let offset = 0
  while (true) {
    let q = client
      .from('leads')
      .select('id, studio_id, phone')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (!isSuper) q = q.in('studio_id', userStudioIds)
    const { data, error } = await q
    if (error) throw new Error(`Leads query failed: ${error.message}`)
    if (!data || data.length === 0) break
    for (const lead of data) {
      const norm = normalizePhone(lead.phone)
      if (norm && normalizedSet.has(norm) && !leadByPhone.has(norm)) {
        leadByPhone.set(norm, { id: lead.id, studio_id: lead.studio_id })
      }
    }
    if (leadByPhone.size === targetMatches) break
    if (data.length < PAGE) break
    offset += PAGE
  }

  const enriched: ScheduledCallback[] = []
  for (const row of n8nRows) {
    const norm = normalizePhone(row.phone_number)
    if (!norm) continue
    const lead = leadByPhone.get(norm)
    if (!lead) continue   // orphan — drop
    enriched.push({
      n8n_row_id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone_number: norm,
      email: row.email,
      dance_interest: row.dance_interest,
      reason: row.reason,
      callback_time: row.callback_time ?? '',
      lead_id: lead.id,
      studio_id: lead.studio_id,
    })
  }

  enriched.sort((a, b) => a.callback_time.localeCompare(b.callback_time))
  return enriched
}

export async function fetchMostRecentCallForLead(
  leadId: string,
  studioId: string,
): Promise<CallHistoryRow | null> {
  const { client } = await getAuthorizedClient()

  const [{ data: lead }, { data: call, error }] = await Promise.all([
    client.from('leads').select('name, phone').eq('id', leadId).maybeSingle(),
    client
      .from('calls')
      .select('id, retell_call_id, created_at, duration_seconds, outcome, sentiment, transcript_summary, lead_id, direction, disconnected_reason, quality_score, appointment_booked, recording_url, picked_up, transferred')
      .eq('studio_id', studioId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (error) throw new Error(error.message)
  if (!call) return null

  return {
    ...call,
    lead_name: lead?.name ?? null,
    lead_phone: lead?.phone ?? null,
  } as CallHistoryRow
}

export async function cancelScheduledCallback(
  n8nRowId: number,
): Promise<{ success: true; rowsUpdated: number }> {
  // Visibility check: caller can only cancel rows they're allowed to see.
  // Reuses the same studio-filtering + orphan-drop logic as the list view.
  const visible = await fetchScheduledCallbacks()
  const target = visible.find(r => r.n8n_row_id === n8nRowId)
  if (!target) throw new Error('Callback not found or not authorized to cancel')

  // n8n's data table node can't filter on the auto-generated `id` column (not in
  // schema), so the cancel webhook filters on phone_number + called_at IS NULL.
  // Per spec edge case #3, multiple pending rows for the same phone all get
  // neutralized — acceptable because a lead has at most one pending callback in
  // practice.
  const response = await callN8nCallbacksWebhook<{ success?: boolean; rowsUpdated?: number }>(
    process.env.N8N_SCHEDULED_CALLBACKS_CANCEL_URL,
    { phone_number: target.phone_number },
  )

  return { success: true, rowsUpdated: response.rowsUpdated ?? 0 }
}

// ─── Client Onboarding ────────────────────────────────────────────────────────

/**
 * Normalised key used to detect duplicate studios by physical address (case-insensitive).
 * Name is intentionally excluded: the wizard's "Duplicate location" button appends
 * " (copy)" to the name, which would otherwise let an unedited dupe slip through.
 * Two studios at the same physical address are almost certainly accidental.
 */
function onboardingDupeKey(
  s: { street_address: string; city: string; state: string; postal_code: string; country: string },
): string {
  return [s.street_address, s.city, s.state, s.postal_code, s.country]
    .map(v => (v ?? '').trim().toLowerCase())
    .join('|')
}

/**
 * Completes the studio-owner onboarding wizard: creates one or more studios,
 * links the current user as studio_owner, seeds default field options + lead
 * sources, writes calendar config + timezone, then flips the
 * studio_setup_complete metadata flag. Modeled on createStudio + saveCalendarSettings.
 *
 * Auth: allowed for a freshly-invited studio_owner (role_intent === 'studio_owner'
 * AND studio_setup_complete === false) or a super_admin (test path before the
 * invite flow exists).
 */
export async function completeStudioOnboarding(
  studios: OnboardingStudioInput[],
): Promise<{ studioIds: string[] } | { error: string }> {
  // User-facing validation errors are RETURNED (not thrown). Next.js masks
  // server-action throws to a generic "An error occurred in the Server
  // Components render" message in production, which is useless for the UI.
  // Genuine bugs (DB writes, auth lookups) still throw — those shouldn't
  // surface to the user with friendly copy anyway.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Your session expired. Please sign in again.' }

  // Auth guard — freshly-invited owner OR a super_admin (test path).
  const meta = user.user_metadata ?? {}
  const isFreshOwner = meta.role_intent === 'studio_owner' && meta.studio_setup_complete === false
  const { data: memberships } = await supabase
    .from('studio_users')
    .select('role')
    .eq('user_id', user.id)
  const isSuperAdmin = memberships?.some(m => m.role === 'super_admin') ?? false
  if (!isFreshOwner && !isSuperAdmin) return { error: 'You don’t have permission to onboard a studio.' }

  // Validate: at least one studio.
  if (!Array.isArray(studios) || studios.length === 0) {
    return { error: 'At least one studio is required.' }
  }

  // Validate: required business fields + no duplicate physical address.
  const seenKeys = new Set<string>()
  for (const s of studios) {
    if (!s.name?.trim()) return { error: 'Each location must have a studio name.' }
    if (!s.street_address?.trim()) return { error: `"${s.name}" is missing a street address.` }
    if (!s.city?.trim()) return { error: `"${s.name}" is missing a city.` }
    if (!s.state?.trim()) return { error: `"${s.name}" is missing a state.` }
    if (!s.postal_code?.trim()) return { error: `"${s.name}" is missing a postal / zip code.` }
    const key = onboardingDupeKey(s)
    if (seenKeys.has(key)) {
      return { error: 'Two locations share the same physical address. Please give each location a unique address.' }
    }
    seenKeys.add(key)
  }

  const serviceClient = createServiceClient()

  // Reject any studio whose physical address already matches an existing (non-deleted)
  // studio in the DB. The validation above only dedupes within this submission.
  const { data: existingStudios } = await serviceClient
    .from('studios')
    .select('street_address, city, state, postal_code, country')
    .is('deleted_at', null)
  const existingKeys = new Set(
    ((existingStudios ?? []) as Array<{
      street_address: string
      city: string
      state: string
      postal_code: string
      country: string
    }>).map(s => onboardingDupeKey(s)),
  )
  for (const s of studios) {
    if (existingKeys.has(onboardingDupeKey(s))) {
      return { error: `A studio at "${s.street_address}, ${s.city}" already exists. Please use a different address.` }
    }
  }

  const createdIds: string[] = []

  for (const s of studios) {
    const location = [s.city, s.state].filter(Boolean).join(', ')

    const { data: studio, error: insertError } = await serviceClient
      .from('studios')
      .insert({
        name: s.name.trim(),
        street_address: s.street_address.trim(),
        city: s.city.trim(),
        state: s.state.trim(),
        postal_code: s.postal_code.trim(),
        country: s.country?.trim() || '',
        location,
        ghl_account_id: s.ghl_account_id?.trim() || '',
        ghl_calendar_id: s.ghl_calendar_id?.trim() || null,
        ghl_api_key: s.ghl_api_key?.trim() || null,
        retell_agent_id: s.retell_agent_id?.trim() || '',
        retell_inbound_agent_id: s.retell_inbound_agent_id?.trim() || null,
        retell_api_key: s.retell_api_key?.trim() || null,
        retell_phone_number: s.retell_phone_number?.trim() || null,
        timezone: s.timezone || 'America/Chicago',
        calendar_start_hour: s.calendar_start_hour,
        calendar_end_hour: s.calendar_end_hour,
        appointment_duration_minutes: s.appointment_duration_minutes,
        appointment_min_advance_weeks: s.appointment_min_advance_weeks,
        appointment_slots: s.appointment_slots,
      })
      .select('id')
      .single()

    if (insertError || !studio) throw new Error(insertError?.message ?? 'Failed to create studio.')
    const studioId = studio.id as string

    // Link the current user as studio_owner.
    const { error: linkError } = await serviceClient
      .from('studio_users')
      .insert({ studio_id: studioId, user_id: user.id, role: 'studio_owner' })
    if (linkError) throw new Error(linkError.message)

    // Seed default enum options (status/level/action/source/reason/partnership).
    // Lead views auto-seed via the AFTER INSERT ON studios trigger — not touched here.
    const { error: seedError } = await serviceClient.rpc('seed_studio_field_options', { p_studio_id: studioId })
    if (seedError) throw new Error(seedError.message)

    // Reconcile lead sources + per-source detail to the owner's chosen list.
    // Safe to delete seeded sources the owner removed — brand-new studio has
    // no leads yet — and writes metadata jsonb for each retained/new source.
    await reconcileStudioSources(serviceClient, studioId, s.sources)

    createdIds.push(studioId)
  }

  // Flip studio_setup_complete to true — preserve all existing metadata.
  const { error: metaError } = await serviceClient.auth.admin.updateUserById(user.id, {
    user_metadata: { ...meta, studio_setup_complete: true },
  })
  if (metaError) throw new Error(metaError.message)

  revalidatePath('/', 'layout')
  return { studioIds: createdIds }
}
