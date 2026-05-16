import { notFound } from 'next/navigation'
import { LeadProfileClientShell } from '@/components/leads/lead-profile-client-shell'
import type { FieldOption } from '@/lib/field-options'
import { buildDefaultOptions } from '@/lib/field-options'
import { ALL_LEAD_ENUM_FIELDS } from '@/lib/constants'
import { MOCK_LEADS, MOCK_CONVERSATIONS } from '@/lib/mock-data'

const STUDIO_EMAIL = 'info@arthurmurray.info'

export default async function LeadProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Mock data — find lead by ID
  const lead = MOCK_LEADS.find(l => l.id === id) ?? null
  if (!lead) notFound()

  const studioId = 'studio-001'

  // Find conversation for this lead's GHL contact
  let initialConversationId: string | null = null
  if (lead.ghl_contact_id) {
    const conv = MOCK_CONVERSATIONS.find(c => c.contact_id === lead.ghl_contact_id)
    initialConversationId = conv?.id ?? null
  }

  // Build default field options
  const ENUM_FIELDS = Object.keys(ALL_LEAD_ENUM_FIELDS)
  const initialFieldOptions: Record<string, FieldOption[]> = {}
  for (const field of ENUM_FIELDS) initialFieldOptions[field] = buildDefaultOptions(field)

  return (
    <LeadProfileClientShell
      lead={lead}
      studioId={studioId}
      initialFieldOptions={initialFieldOptions}
      initialConversationId={initialConversationId}
      studioEmail={STUDIO_EMAIL}
      ghlLocationId="slTYdxI6vskx4r28zsIo"
    />
  )
}
