import { describe, it, expect, vi } from 'vitest'

// Mock Supabase service client
const mockDelete  = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
const mockUpdate  = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
const mockUpsert  = vi.fn().mockResolvedValue({ error: null })
const mockSelect  = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: { id: 'studio-123' }, error: null }),
  }),
})

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: mockSelect,
      upsert:  mockUpsert,
      update:  mockUpdate,
      delete:  mockDelete,
    }),
  }),
}))

import { validateWebhookSecret, mapGHLContactToLead } from '@/app/api/webhooks/ghl-contact/route'

describe('GHL contact webhook', () => {
  describe('validateWebhookSecret', () => {
    it('returns true when secret matches', () => {
      expect(validateWebhookSecret('my-secret', 'my-secret')).toBe(true)
    })

    it('returns false when secret does not match', () => {
      expect(validateWebhookSecret('my-secret', 'wrong-secret')).toBe(false)
    })

    it('returns false when secret is missing', () => {
      expect(validateWebhookSecret('my-secret', null)).toBe(false)
    })
  })

  describe('mapGHLContactToLead', () => {
    it('maps GHL contact fields to lead schema', () => {
      const contact = {
        id: 'ghl-abc',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+15551234567',
        email: 'jane@example.com',
        source: 'Facebook Ads',
      }

      const lead = mapGHLContactToLead('studio-123', contact)

      expect(lead.studio_id).toBe('studio-123')
      expect(lead.name).toBe('Jane Doe')
      expect(lead.phone).toBe('+15551234567')
      expect(lead.email).toBe('jane@example.com')
      expect(lead.ghl_contact_id).toBe('ghl-abc')
      expect(lead.source).toBe('Facebook Ads')
    })

    it('falls back to top-level name field when firstName/lastName are absent', () => {
      const contact = { id: 'ghl-abc', name: 'Jane Doe' }
      const lead = mapGHLContactToLead('studio-123', contact)
      expect(lead.name).toBe('Jane Doe')
    })

    it('handles missing optional fields gracefully', () => {
      const contact = { id: 'ghl-xyz' }
      const lead = mapGHLContactToLead('studio-123', contact)

      expect(lead.name).toBe('')
      expect(lead.phone).toBeNull()
      expect(lead.email).toBeNull()
      expect(lead.source).toBeNull()
    })
  })
})
