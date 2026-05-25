import { SkeletonTable, SkeletonToolbar } from '@/components/skeletons'

export default function LeadsLoading() {
  return (
    <>
      <h1
        className="text-2xl font-semibold flex-shrink-0 px-5 pt-10 pb-3"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Leads
      </h1>
      <div className="flex-shrink-0 px-5 pb-3">
        <div className="skeleton-shimmer" style={{ height: 40, width: '100%', borderRadius: 8 }} />
      </div>
      <div className="flex flex-col flex-1 min-h-0 px-5 pb-4 gap-3">
        {/* View tabs placeholder */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="skeleton-shimmer" style={{ height: 32, width: 70, borderRadius: 6 }} />
          <div className="skeleton-shimmer" style={{ height: 32, width: 70, borderRadius: 6 }} />
        </div>
        {/* Toolbar: search + filter buttons */}
        <SkeletonToolbar />
        {/* Table */}
        <SkeletonTable cols={8} rows={10} />
        {/* Pagination */}
        <div className="flex-shrink-0 flex items-center justify-between px-2 py-0.5">
          <div className="skeleton-shimmer" style={{ height: 14, width: 120, borderRadius: 4 }} />
          <div className="skeleton-shimmer" style={{ height: 14, width: 100, borderRadius: 4 }} />
        </div>
      </div>
    </>
  )
}
