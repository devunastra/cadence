import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getSelectedStudioId } from '@/lib/data-cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { LeadsTable } from '@/components/leads/leads-table'
import { fetchLeadsPage, getUserPreferences, getPageFilters } from '@/app/actions'
import type { LeadView } from '@/lib/views'

export default async function LeadsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const isSuper = memberships.some(m => m.role === 'super_admin')
  const selectedStudioId = await getSelectedStudioId()
  const studioId = selectedStudioId ?? memberships[0]?.studio_id ?? null

  if (!studioId && !isSuper) redirect('/login')

  const client = isSuper ? createServiceClient() : await createClient()

  const [studioResult, viewsResult, fieldOptsResult, initialPrefs, initialPageFilters, initialLeadsData] = await Promise.all([
    studioId ? client.from('studios').select('name').eq('id', studioId).single() : Promise.resolve({ data: null }),
    studioId ? client.from('lead_views').select('*').eq('studio_id', studioId).order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
    studioId ? client.from('studio_field_options').select('id, field, value, bg, text').eq('studio_id', studioId).order('sort_order', { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] }),
    studioId ? getUserPreferences(studioId).catch(() => null) : Promise.resolve(null),
    studioId ? getPageFilters(studioId).catch(() => ({})) : Promise.resolve({}),
    studioId ? fetchLeadsPage({ studioId, page: 0, pageSize: 50, search: '', statusFilter: [], levelFilter: [], actionFilter: [], sourceFilter: [], reasonFilter: [] }).catch(() => ({ leads: [], total: 0 })) : Promise.resolve({ leads: [], total: 0 }),
  ])

  const studioName = studioResult.data?.name ?? null
  const initialCustomViews: LeadView[] = (viewsResult.data ?? []).map((v: { id: string; name: string; columns: string[] }) => ({
    id: v.id,
    name: v.name,
    columns: v.columns,
  }))

  const initialFieldOptions: Record<string, Array<{ id: string; value: string; bg: string | null; text: string | null }>> = {}
  for (const row of (fieldOptsResult.data ?? []) as { id: string; field: string; value: string; bg: string | null; text: string | null }[]) {
    if (!initialFieldOptions[row.field]) initialFieldOptions[row.field] = []
    if (initialFieldOptions[row.field].some(o => o.value === row.value)) continue
    initialFieldOptions[row.field].push({ id: row.id, value: row.value, bg: row.bg ?? null, text: row.text ?? null })
  }

  return (
    <>
      <h1 className="text-2xl font-semibold flex-shrink-0 px-5 pt-10 pb-3" style={{ color: 'var(--color-text-primary)' }}>Leads</h1>
      <div className="flex flex-col flex-1 min-h-0">
        <LeadsTable
          initialCustomViews={initialCustomViews}
          studioId={studioId}
          studioName={studioName}
          initialFieldOptions={initialFieldOptions}
          initialLeads={initialLeadsData.leads}
          initialTotal={initialLeadsData.total}
          initialPrefs={initialPrefs}
          initialPageFilters={initialPageFilters}
        />
      </div>
    </>
  )
}
