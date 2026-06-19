import { SkeletonTable, SkeletonTabs, SkeletonToolbar } from '@/components/skeletons'

export default function CallHistoryLoading() {
  return (
    <>
      <h1
        className="text-2xl font-semibold flex-shrink-0 px-5 pt-5 pb-3"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Call History
      </h1>
      <div className="flex flex-col flex-1 min-h-0 px-5 pb-4 gap-3">
        {/* Tabs: All Calls | Outbound | Inbound | Failed | Callbacks */}
        <SkeletonTabs count={5} widths={[60, 65, 55, 45, 65]} />
        {/* Toolbar: search + filter */}
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
