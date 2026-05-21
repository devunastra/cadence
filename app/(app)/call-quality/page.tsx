'use client'

import { useCurrentStudio } from '@/components/studio-context'
import { QualityReviewShell } from '@/components/call-quality/quality-review-shell'

export default function CallQualityPage() {
  const { studioId, userRole, isSuper } = useCurrentStudio()

  return (
    <>
      <h1
        className="text-2xl font-semibold flex-shrink-0 px-5 pt-5 md:pt-10 pb-3"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Quality Review
      </h1>
      <div className="flex flex-col flex-1 min-h-0">
        <QualityReviewShell studioId={studioId} userRole={userRole} isSuper={isSuper} />
      </div>
    </>
  )
}
