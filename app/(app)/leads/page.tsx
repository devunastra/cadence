'use client'

import { useCurrentStudio } from '@/components/studio-context'
import { LeadsTable } from '@/components/leads/leads-table'
import { VoiceAgentToggle } from '@/components/leads/voice-agent-toggle'
import { OutboundAgentSelector } from '@/components/leads/outbound-agent-selector'
import { FollowupsToggle } from '@/components/leads/followups-toggle'

export default function LeadsPage() {
  const { studioId } = useCurrentStudio()

  return (
    <>
      <h1 className="text-2xl font-semibold flex-shrink-0 px-5 pt-5 pb-3" style={{ color: 'var(--color-text-primary)' }}>Leads</h1>
      {/* Stacked, not side by side. The pill's width need swings with its state —
          "Active" is short, "Outside calling hours · resumes 12:00 PM · …" is not —
          so sharing a row means it fits or truncates depending on the time of day.
          Giving it the full row makes it predictable; the agent selector sits below
          at its natural width. */}
      <div className="flex-shrink-0 px-5 pb-3 flex flex-col gap-3">
        <VoiceAgentToggle />
        {/* Two independent settings, so they share a row and wrap rather than
            stacking — keeping them off the agent pill's row is what stops the
            follow-ups switch reading as part of the agent's on/off state. */}
        <div className="flex flex-wrap items-center gap-3">
          <OutboundAgentSelector />
          <FollowupsToggle />
        </div>
      </div>
      <div className="flex flex-col md:flex-1 md:min-h-0">
        <LeadsTable studioId={studioId} />
      </div>
    </>
  )
}
