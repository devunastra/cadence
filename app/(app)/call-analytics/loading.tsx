import { SkeletonTabs, SkeletonKpiCard, SkeletonBar } from '@/components/skeletons'

export default function CallAnalyticsLoading() {
  return (
    <div className="flex flex-col flex-1 min-h-0 px-5 pt-5 md:pt-10 pb-4 gap-3">
      {/* Page heading */}
      <h1
        className="text-2xl font-semibold flex-shrink-0"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Call Analytics
      </h1>
      {/* Tabs: Analytics | Transcripts */}
      <SkeletonTabs count={2} widths={[70, 80]} />
      {/* Action bar: refresh + date range */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="skeleton-shimmer" style={{ height: 36, width: 36, borderRadius: 8 }} />
        <div className="skeleton-shimmer" style={{ height: 36, width: 140, borderRadius: 8 }} />
      </div>
      {/* KPI cards row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 flex-shrink-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonKpiCard key={i} />
        ))}
      </div>
      {/* Chart area placeholders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl overflow-hidden"
            style={{
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-bg)',
              minHeight: 180,
            }}
          >
            <div className="p-5">
              <SkeletonBar width={120} height={14} />
              <div className="mt-6">
                <SkeletonBar width="100%" height={100} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
