'use client'

import { useCurrentStudio } from '@/components/studio-context'
import { LeadsTable } from '@/components/leads/leads-table'

export default function LeadsPage() {
  const { studioId } = useCurrentStudio()

  return (
    <>
      <h1 className="text-2xl font-semibold flex-shrink-0 px-5 pt-10 pb-3" style={{ color: 'var(--color-text-primary)' }}>Leads</h1>
      <div className="flex flex-col flex-1 min-h-0">
        <LeadsTable studioId={studioId} />
      </div>
    </>
  )
}
