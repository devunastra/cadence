import { describe, it, expect } from 'vitest'
import { buildNotionProperties } from './notion'

describe('buildNotionProperties', () => {
  it('maps each field type to the correct Notion property shape', () => {
    const props = buildNotionProperties({
      name: 'Jane Doe',
      status: 'Active',          // enum already resolved to label
      level: 'Front',            // -> empty-name select
      phone: '2243089402',
      texted: true,
      showed: false,
      last_contacted: '2026-05-28T16:01:10.546Z', // date-only
      first_lesson: '2026-04-04T19:00:00.000Z',   // keeps time
      reason: null,              // cleared select
    })
    expect(props['Name']).toEqual({ title: [{ text: { content: 'Jane Doe' } }] })
    expect(props['Status']).toEqual({ select: { name: 'Active' } })
    expect(props['']).toEqual({ select: { name: 'Front' } })           // Level = empty-name property
    expect(props['Phone']).toEqual({ rich_text: [{ text: { content: '2243089402' } }] })
    expect(props['Texted']).toEqual({ checkbox: true })
    expect(props['Showed']).toEqual({ checkbox: false })
    expect(props['Last Contacted']).toEqual({ date: { start: '2026-05-28' } })          // date-only
    expect(props['First Lesson']).toEqual({ date: { start: '2026-04-04T19:00:00.000Z' } }) // time kept
    expect(props['Reason']).toEqual({ select: null })                  // cleared
  })

  it('ignores unsynced fields', () => {
    const props = buildNotionProperties({ created_at: 'x', ghl_contact_id: 'y' } as never)
    expect(Object.keys(props)).toHaveLength(0)
  })
})
