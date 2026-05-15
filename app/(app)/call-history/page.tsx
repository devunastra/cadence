import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getSelectedStudioId } from '@/lib/data-cache'
import { fetchCallHistory, getPageFilters } from '@/app/actions'
import { CallHistoryShell } from '@/components/call-history/call-history-shell'

export default async function CallHistoryPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const selectedStudioId = await getSelectedStudioId()
  const studioId = selectedStudioId ?? memberships[0]?.studio_id ?? null

  if (!studioId) redirect('/login')

  const [initialPageFilters, initialData] = await Promise.all([
    getPageFilters(studioId).catch(() => ({})),
    fetchCallHistory({ studioId, tab: 'all', page: 1, pageSize: 50 }).catch(() => ({ calls: [], total: 0 })),
  ])

  return (
    <>
      <h1
        className="text-2xl font-semibold flex-shrink-0 px-5 pt-10 pb-3"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Call History
      </h1>
      <div className="flex flex-col flex-1 min-h-0">
        <CallHistoryShell
          studioId={studioId}
          initialCalls={initialData.calls}
          initialTotal={initialData.total}
          initialPageFilters={initialPageFilters}
        />
      </div>
    </>
  )
}
