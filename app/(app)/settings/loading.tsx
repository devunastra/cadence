import { SkeletonBar } from '@/components/skeletons'

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      {/* Section heading */}
      <SkeletonBar width={160} height={20} />
      <SkeletonBar width={240} height={12} />
      {/* Form field placeholders */}
      <div className="space-y-5 mt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <SkeletonBar width={80} height={10} />
            <div
              className="skeleton-shimmer"
              style={{ height: 40, width: '100%', borderRadius: 8 }}
            />
          </div>
        ))}
      </div>
      {/* Save button placeholder */}
      <div className="pt-2">
        <div
          className="skeleton-shimmer"
          style={{ height: 40, width: 100, borderRadius: 8 }}
        />
      </div>
    </div>
  )
}
