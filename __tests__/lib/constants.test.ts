import { describe, it, expect } from 'vitest'
import {
  STATUS_OPTIONS,
  LEVEL_OPTIONS,
  ACTION_OPTIONS,
  SOURCE_OPTIONS,
  REASON_OPTIONS,
  PARTNERSHIP_OPTIONS,
  ALL_LEAD_ENUM_FIELDS,
} from '@/lib/constants'

describe('constants', () => {
  it('STATUS_OPTIONS contains all 9 Notion status values', () => {
    expect(STATUS_OPTIONS).toHaveLength(9)
    expect(STATUS_OPTIONS).toContain('Active')
    expect(STATUS_OPTIONS).toContain('Solicitation')
  })

  it('LEVEL_OPTIONS contains all 13 trophy values', () => {
    expect(LEVEL_OPTIONS).toHaveLength(13)
    expect(LEVEL_OPTIONS).toContain('Inquiry')
    expect(LEVEL_OPTIONS).toContain('Silver 2')
  })

  it('ACTION_OPTIONS contains all 15 action values', () => {
    expect(ACTION_OPTIONS).toHaveLength(15)
    expect(ACTION_OPTIONS).toContain('NO SHOW')
    expect(ACTION_OPTIONS).toContain('Bought Gift Certificate')
  })

  it('SOURCE_OPTIONS contains all 6 source values', () => {
    expect(SOURCE_OPTIONS).toHaveLength(6)
    expect(SOURCE_OPTIONS).toContain('Facebook Ads')
    expect(SOURCE_OPTIONS).toContain('Events')
  })

  it('REASON_OPTIONS contains all 4 reason values', () => {
    expect(REASON_OPTIONS).toHaveLength(4)
    expect(REASON_OPTIONS).toContain('Wedding')
    expect(REASON_OPTIONS).toContain('Other')
  })

  it('PARTNERSHIP_OPTIONS contains Couple and Single', () => {
    expect(PARTNERSHIP_OPTIONS).toHaveLength(2)
    expect(PARTNERSHIP_OPTIONS).toContain('Couple')
    expect(PARTNERSHIP_OPTIONS).toContain('Single')
  })

  it('ALL_LEAD_ENUM_FIELDS maps correct field names to option arrays', () => {
    expect(ALL_LEAD_ENUM_FIELDS).toHaveProperty('status')
    expect(ALL_LEAD_ENUM_FIELDS).toHaveProperty('level')
    expect(ALL_LEAD_ENUM_FIELDS).toHaveProperty('action')
    expect(ALL_LEAD_ENUM_FIELDS).toHaveProperty('source')
    expect(ALL_LEAD_ENUM_FIELDS).toHaveProperty('reason')
    expect(ALL_LEAD_ENUM_FIELDS).toHaveProperty('partnership')
  })
})
