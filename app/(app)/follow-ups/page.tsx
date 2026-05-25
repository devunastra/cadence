'use client'

import { useCurrentStudio } from '@/components/studio-context'
import { FollowUpsShell } from '@/components/follow-ups/follow-ups-shell'

export default function FollowUpsPage() {
  const { studioId } = useCurrentStudio()

  return (
    <>
      <h1
        className="text-2xl font-semibold flex-shrink-0 px-5 pt-5 md:pt-10 pb-3"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Follow-ups
      </h1>
      <div className="flex flex-col md:flex-1 md:min-h-0">
        <FollowUpsShell studioId={studioId} />
      </div>
    </>
  )
}
