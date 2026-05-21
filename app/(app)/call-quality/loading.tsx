import { SkeletonTable, SkeletonToolbar, SkeletonKpiCard } from '@/components/skeletons'

export default function CallQualityLoading() {
  return (
    <>
      <h1
        className="text-2xl font-semibold flex-shrink-0 px-5 pt-5 md:pt-10 pb-3"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Quality Review
      </h1>
      <div className="flex flex-col flex-1 min-h-0 px-5 pb-4 gap-3">
        {/* KPI cards row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 flex-shrink-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonKpiCard key={i} />
          ))}
        </div>
        {/* Toolbar: search + filters */}
        <SkeletonToolbar />
        {/* Table */}
        <SkeletonTable cols={10} rows={10} />
        {/* Pagination */}
        <div className="flex-shrink-0 flex items-center justify-between px-2 py-0.5">
          <div className="skeleton-shimmer" style={{ height: 14, width: 120, borderRadius: 4 }} />
          <div className="skeleton-shimmer" style={{ height: 14, width: 100, borderRadius: 4 }} />
        </div>
      </div>
    </>
  )
}
