import { SkeletonTabs, SkeletonTable, SkeletonToolbar } from '@/components/skeletons'

export default function CalendarLoading() {
  return (
    <div className="flex flex-col flex-1 min-h-0 px-5 pt-5 pb-4 gap-3">
      {/* Page heading */}
      <h1
        className="text-2xl font-semibold flex-shrink-0"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Appointments
      </h1>
      {/* Tabs: List | Calendar */}
      <SkeletonTabs count={2} widths={[50, 80]} />
      {/* Toolbar: refresh + filter + show-past + search */}
      <SkeletonToolbar />
      {/* Appointment list table placeholder (list is the default view) */}
      <SkeletonTable cols={6} rows={8} />
    </div>
  )
}
