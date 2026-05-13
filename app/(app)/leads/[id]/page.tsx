import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getMemberships, getSelectedStudioId } from '@/lib/data-cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { LeadProfileClientShell } from '@/components/leads/lead-profile-client-shell'
import type { Lead } from '@/lib/types'
import type { FieldOption } from '@/lib/field-options'
import { buildDefaultOptions } from '@/lib/field-options'
import { ALL_LEAD_ENUM_FIELDS } from '@/lib/constants'

const STUDIO_EMAIL = 'info@arthurmurray.info'

export default async function LeadProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  const selectedStudioId = await getSelectedStudioId()
  const studioId = selectedStudioId ?? memberships[0]?.studio_id ?? null

  if (!studioId && !isSuper) redirect('/login')

  const client = isSuper ? createServiceClient() : await createClient()

  // Fetch lead + field options + studio GHL location ID in parallel
  const [leadResult, fieldOptsResult, studioResult] = await Promise.all([
    client
      .from('leads')
      .select('*')
      .eq('id', id)
      .maybeSingle(),
    studioId
      ? client
          .from('studio_field_options')
          .select('id, field, value, bg, text')
          .eq('studio_id', studioId)
          .order('sort_order', { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    studioId
      ? client
          .from('studios')
          .select('ghl_account_id')
          .eq('id', studioId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const lead = leadResult.data as Lead | null
  if (!lead) notFound()

  // Look up existing GHL conversation in Supabase
  let initialConversationId: string | null = null
  if (lead.ghl_contact_id && studioId) {
    const convResult = await client
      .from('conversations')
      .select('id')
      .eq('contact_id', lead.ghl_contact_id)
      .eq('studio_id', studioId)
      .limit(1)
      .maybeSingle()
    initialConversationId = convResult.data?.id ?? null
  }

  const ENUM_FIELDS = Object.keys(ALL_LEAD_ENUM_FIELDS)
  const defaults: Record<string, FieldOption[]> = {}
  for (const field of ENUM_FIELDS) defaults[field] = buildDefaultOptions(field)

  const initialFieldOptions: Record<string, FieldOption[]> = {}
  for (const row of (fieldOptsResult.data ?? []) as {
    id: string; field: string; value: string; bg: string | null; text: string | null
  }[]) {
    if (!initialFieldOptions[row.field]) initialFieldOptions[row.field] = []
    if (initialFieldOptions[row.field].some(o => o.value === row.value)) continue
    const defaultColor = defaults[row.field]?.find(o => o.value === row.value)
    initialFieldOptions[row.field].push({ 
      id: row.id, 
      value: row.value, 
      bg: row.bg ?? defaultColor?.bg ?? 'status-bg-default', 
      text: row.text ?? defaultColor?.text ?? 'status-text-default' 
    })
  }

  return (
    <LeadProfileClientShell
      lead={lead}
      studioId={studioId!}
      initialFieldOptions={initialFieldOptions}
      initialConversationId={initialConversationId}
      studioEmail={STUDIO_EMAIL}
      ghlLocationId={studioResult.data?.ghl_account_id ?? null}
    />
  )
}
