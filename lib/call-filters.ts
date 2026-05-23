import type { TranscriptFilters } from '@/components/call-analytics/transcripts-filter-bar'

interface FilterableCall {
  direction?: string | null
  sentiment?: string | null
  outcome?: string | null
  appointment_booked?: boolean | null
  disconnected_reason?: string | null
  quality_score?: number | null
}

export function applyTranscriptFilters<T extends FilterableCall>(calls: T[], filters: TranscriptFilters): T[] {
  return calls.filter(c => {
    if (filters.direction !== 'all' && c.direction !== filters.direction) return false
    if (filters.sentiment.length > 0 && !filters.sentiment.includes(c.sentiment ?? '')) return false
    if (filters.outcome && c.outcome !== filters.outcome) return false
    if (filters.appointmentBooked) {
      const want = filters.appointmentBooked === 'yes'
      if (c.appointment_booked !== want) return false
    }
    if (filters.disconnectedReason.length > 0) {
      const dr = c.disconnected_reason ?? ''
      const match = filters.disconnectedReason.includes(dr) || (dr === 'voicemail_reached' && filters.disconnectedReason.includes('voicemail'))
      if (!match) return false
    }
    if (filters.qualityScore.value !== '') {
      const v = parseFloat(filters.qualityScore.value)
      const s = c.quality_score
      if (s == null) return false
      if (filters.qualityScore.op === '>'  && !(s >  v)) return false
      if (filters.qualityScore.op === '<'  && !(s <  v)) return false
      if (filters.qualityScore.op === '='  && s !== v)   return false
      if (filters.qualityScore.op === '>=' && !(s >= v)) return false
      if (filters.qualityScore.op === '<=' && !(s <= v)) return false
    }
    return true
  })
}
