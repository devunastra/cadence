import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getSelectedStudioId } from '@/lib/data-cache'
import { fetchCallsAnalytics, getAnalyticsPreferences, getPageFilters } from '@/app/actions'
import { getPresetRange } from '@/lib/date-utils'
import type { DatePreset } from '@/lib/types'
import { AnalyticsShell } from '@/components/call-analytics/analytics-shell'
import { createClient } from '@/lib/supabase/server'

export default async function CallAnalyticsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const selectedStudioId = await getSelectedStudioId()
  const studioId = selectedStudioId ?? memberships[0]?.studio_id ?? null

  if (!studioId) redirect('/login')

  const client = await createClient()
  const { data: fieldOptsRows } = await client
    .from('studio_field_options')
    .select('id, field, value, bg, text')
    .eq('studio_id', studioId)
    .order('sort_order', { ascending: true, nullsFirst: false })

  const initialFieldOptions: Record<string, Array<{ id: string; value: string; bg: string | null; text: string | null }>> = {}
  for (const row of (fieldOptsRows ?? []) as { id: string; field: string; value: string; bg: string | null; text: string | null }[]) {
    if (!initialFieldOptions[row.field]) initialFieldOptions[row.field] = []
    if (initialFieldOptions[row.field].some(o => o.value === row.value)) continue
    initialFieldOptions[row.field].push({ id: row.id, value: row.value, bg: row.bg ?? null, text: row.text ?? null })
  }

  const [prefs, pageFilters] = await Promise.all([
    getAnalyticsPreferences(studioId),
    getPageFilters(studioId).catch(() => ({ transcripts: undefined })),
  ])
  const savedPreset = (prefs.preset === 'custom' ? '7d' : prefs.preset) as DatePreset
  const { from, to } = getPresetRange(savedPreset)
  const initialRange = { from, to, preset: savedPreset }

  const initialData = await fetchCallsAnalytics(
    studioId,
    from.toISOString(),
    to.toISOString(),
  ).catch(() => ({
    calls: [],
    volumeByDay: [],
    totalCalls: 0,
    totalDurationSeconds: 0,
    appointmentsBooked: 0,
    avgQualityScore: null,
    successRate: 0,
    pickupRate: 0,
    sentimentCounts: {},
    disconnectCounts: {},
    outcomeCounts: {},
  }))

  return (
    <AnalyticsShell
      studioId={studioId}
      initialData={initialData}
      initialRange={initialRange}
      initialDirection={prefs.direction}
      initialFieldOptions={initialFieldOptions}
      initialTab={tab === 'transcripts' ? 'transcripts' : 'analytics'}
      initialTranscriptFilters={pageFilters.transcripts}
    />
  )
}
