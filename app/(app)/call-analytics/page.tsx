'use client'

import { useSearchParams } from 'next/navigation'
import { useCurrentStudio } from '@/components/studio-context'
import { AnalyticsShell } from '@/components/call-analytics/analytics-shell'

export default function CallAnalyticsPage() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const { studioId } = useCurrentStudio()

  return (
    <AnalyticsShell
      studioId={studioId}
      initialTab={tab === 'transcripts' ? 'transcripts' : 'analytics'}
    />
  )
}
