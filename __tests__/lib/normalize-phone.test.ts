/**
 * Unit tests for normalizePhone() — the phone-normalization function used inside
 * fetchScheduledCallbacks() to match n8n AI Callback rows to Supabase leads.
 *
 * normalizePhone is a private function in app/actions.ts (lines ~2501–2508).
 * It is not exported, so the implementation is mirrored here verbatim.
 * If the production implementation changes, this copy must be updated and
 * all tests re-run to confirm the change is intentional.
 *
 * Last synced with: app/actions.ts @ commit f4bf6cf (2026-05-21)
 */

import { describe, it, expect } from 'vitest'

// ── Mirror of the private normalizePhone function in app/actions.ts ───────────
// Update this if the production function changes.
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (raw.startsWith('+') && digits.length >= 10) return `+${digits}`
  return null
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  // ── Null / empty inputs ──────────────────────────────────────────────────

  it('returns null for null input', () => {
    expect(normalizePhone(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(normalizePhone(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizePhone('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    // After replace(/\D/g,''), digits = '' — length 0 — no branch matches
    expect(normalizePhone('   ')).toBeNull()
  })

  // ── 10-digit inputs (US numbers without country code) ────────────────────

  it('normalizes raw 10-digit number', () => {
    expect(normalizePhone('5551000001')).toBe('+15551000001')
  })

  it('normalizes 10-digit with spaces (555 100 0001)', () => {
    expect(normalizePhone('555 100 0001')).toBe('+15551000001')
  })

  it('normalizes formatted US (555) 100-0001', () => {
    expect(normalizePhone('(555) 100-0001')).toBe('+15551000001')
  })

  it('normalizes dashes 555-100-0001', () => {
    expect(normalizePhone('555-100-0001')).toBe('+15551000001')
  })

  it('normalizes dots 555.100.0001', () => {
    expect(normalizePhone('555.100.0001')).toBe('+15551000001')
  })

  it('normalizes mixed punctuation (555) 100.0001', () => {
    expect(normalizePhone('(555) 100.0001')).toBe('+15551000001')
  })

  // ── 11-digit inputs starting with 1 ─────────────────────────────────────

  it('normalizes 11-digit no-plus 15551000001', () => {
    expect(normalizePhone('15551000001')).toBe('+15551000001')
  })

  it('normalizes 11-digit with dashes 1-555-100-0001', () => {
    expect(normalizePhone('1-555-100-0001')).toBe('+15551000001')
  })

  it('does NOT normalize 11-digit starting with 2 (non-US country prefix)', () => {
    // digits = '20123456789', length 11, does not start with '1'
    // falls through to the raw.startsWith('+') check — raw does not start with '+' either
    expect(normalizePhone('20123456789')).toBeNull()
  })

  // ── E.164 inputs (already have leading +) ───────────────────────────────

  it('passes through E.164 US number +15551000001', () => {
    expect(normalizePhone('+15551000001')).toBe('+15551000001')
  })

  it('passes through E.164 with exactly 10 digits after +', () => {
    // raw = '+5551000001', digits = '5551000001', length 10 → "+1" prefix branch wins
    // Note: this is a +5... number but the 10-digit branch fires before the raw.startsWith('+') check
    expect(normalizePhone('+5551000001')).toBe('+15551000001')
  })

  it('passes through non-US E.164 +447911123456 (12 digits)', () => {
    // digits = '447911123456', length 12
    // Not 10, not 11-starting-with-1, but raw.startsWith('+') AND digits.length >= 10 → keeps full digits
    expect(normalizePhone('+447911123456')).toBe('+447911123456')
  })

  it('passes through long E.164 +12025551234 (11 digits, US)', () => {
    expect(normalizePhone('+12025551234')).toBe('+12025551234')
  })

  // ── Boundary: exactly 9 digits — too short ───────────────────────────────

  it('returns null for 9-digit number (too short, no leading +)', () => {
    // digits = '555100000', length 9 — no branch matches, return null
    expect(normalizePhone('555100000')).toBeNull()
  })

  it('returns null for 9-digit with + prefix', () => {
    // raw.startsWith('+') = true, but digits.length = 9 (< 10) — condition fails
    expect(normalizePhone('+555100000')).toBeNull()
  })

  // ── Garbage / unrecognizable inputs ─────────────────────────────────────

  it('returns null for alphabetic garbage', () => {
    expect(normalizePhone('abc-notaphone')).toBeNull()
  })

  it('returns null for mixed alpha-numeric that strips to < 10 digits', () => {
    // 'abc123def' → digits = '123', length 3
    expect(normalizePhone('abc123def')).toBeNull()
  })

  it('returns null for a string with only non-digit characters', () => {
    expect(normalizePhone('()- .')).toBeNull()
  })

  // ── Two-phone matching symmetry (both sides normalized) ──────────────────
  // Verifies the core invariant: leads.phone and n8n phone_number normalize to the same value.

  it('n8n E.164 matches leads formatted US — same result', () => {
    const n8nNorm = normalizePhone('+15551000001')
    const leadNorm = normalizePhone('(555) 100-0001')
    expect(n8nNorm).toBe(leadNorm)
  })

  it('n8n 10-digit matches leads E.164 — same result', () => {
    const n8nNorm = normalizePhone('5551000002')
    const leadNorm = normalizePhone('+15551000002')
    expect(n8nNorm).toBe(leadNorm)
  })

  it('n8n formatted-with-dashes matches leads raw 10-digit — same result', () => {
    const n8nNorm = normalizePhone('555-100-0003')
    const leadNorm = normalizePhone('5551000003')
    expect(n8nNorm).toBe(leadNorm)
  })

  it('n8n 11-digit-no-plus matches leads E.164 — same result', () => {
    const n8nNorm = normalizePhone('15551000002')
    const leadNorm = normalizePhone('+15551000002')
    expect(n8nNorm).toBe(leadNorm)
  })

  // ── Non-US number does NOT match US lead ────────────────────────────────

  it('non-US +44 number does not match any normalized US 10-digit', () => {
    // A lead stored as '5551000001' normalizes to '+15551000001'
    // A non-US n8n row stored as '+447911123456' normalizes to '+447911123456'
    // These are not equal — no false match
    const leadNorm = normalizePhone('5551000001')
    const n8nNorm = normalizePhone('+447911123456')
    expect(leadNorm).not.toBe(n8nNorm)
  })

  // ── Trim / leading-trailing whitespace ───────────────────────────────────

  it('handles leading whitespace before digits', () => {
    // '  5551000001' → digits = '5551000001', length 10
    expect(normalizePhone('  5551000001')).toBe('+15551000001')
  })

  it('handles trailing whitespace after digits', () => {
    expect(normalizePhone('5551000001  ')).toBe('+15551000001')
  })
})
