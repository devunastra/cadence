'use client'

import { LeadSourcesEditor } from '@/components/settings/lead-sources-editor'
import type { OnboardingStudioInput } from '@/lib/types'

interface StepLeadSourcesProps {
  studio: OnboardingStudioInput
  onChange: (patch: Partial<OnboardingStudioInput>) => void
}

export function StepLeadSources({ studio, onChange }: StepLeadSourcesProps) {
  return (
    <LeadSourcesEditor
      sources={studio.sources}
      onChange={sources => onChange({ sources })}
      helper="These are the lead sources your team can tag on each lead. We've added a few common ones — add or remove any to match how your studio gets inquiries."
    />
  )
}
