import { SkeletonTabs, SkeletonBar } from '@/components/skeletons'

export default function CalendarLoading() {
  return (
    <div className="flex flex-col flex-1 min-h-0 px-5 pt-5 pb-4 gap-3">
      {/* Page heading */}
      <h1
        className="text-2xl font-semibold flex-shrink-0"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Calendar
      </h1>
      {/* Tabs: Calendar View | Appointment List */}
      <SkeletonTabs count={2} widths={[95, 110]} />
      {/* Toolbar: nav arrows + week label + buttons */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="skeleton-shimmer" style={{ height: 36, width: 36, borderRadius: 8 }} />
        <div className="skeleton-shimmer" style={{ height: 36, width: 36, borderRadius: 8 }} />
        <div className="skeleton-shimmer" style={{ height: 20, width: 180, borderRadius: 4 }} />
        <div className="ml-auto flex gap-2">
          <div className="skeleton-shimmer" style={{ height: 36, width: 36, borderRadius: 8 }} />
          <div className="skeleton-shimmer" style={{ height: 36, width: 120, borderRadius: 8 }} />
        </div>
      </div>
      {/* Calendar grid placeholder */}
      <div
        className="flex-1 min-h-0 rounded-xl overflow-hidden"
        style={{
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-bg)',
        }}
      >
        {/* Day headers */}
        <div
          className="grid grid-cols-7 gap-0"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-2 py-3 flex justify-center">
              <SkeletonBar width={40} height={12} />
            </div>
          ))}
        </div>
        {/* Grid rows */}
        <div className="p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <SkeletonBar width={40} height={12} />
              <SkeletonBar width="80%" height={32} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
