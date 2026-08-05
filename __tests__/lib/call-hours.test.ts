/**
 * Unit tests for lib/call-hours.ts — the outbound call window logic behind
 * Settings → Business Profile → Call Hours, and behind the n8n dialer guards.
 *
 * The cases that matter most are the DST ones. The n8n Code node this replaced
 * computed the PDT/PST changeover by hand; these tests pin the behaviour to real
 * IANA offsets so a future edit can't quietly reintroduce that bug.
 */

import { describe, it, expect } from 'vitest'
import {
  isWithinCallHours,
  nextCallWindowOpening,
  normalizeCallHours,
  formatCallHoursSummary,
  formatNextOpeningLabel,
  hasAnyWindow,
  windowMinutes,
  parseHHMM,
  formatHHMM,
  emptyCallHours,
  uniformCallHours,
  type CallHours,
} from '@/lib/call-hours'

const CHICAGO = 'America/Chicago'
const VANCOUVER = 'America/Vancouver'

// White Rock's live window: Mon–Thu 12:00–20:00, Fri 12:00–19:00, closed weekends.
const WHITE_ROCK: CallHours = {
  '0': null,
  '1': { open: '12:00', close: '20:00' },
  '2': { open: '12:00', close: '20:00' },
  '3': { open: '12:00', close: '20:00' },
  '4': { open: '12:00', close: '20:00' },
  '5': { open: '12:00', close: '19:00' },
  '6': null,
}

// Lincolnshire's live window: 08:00–22:00 every day.
const LINCOLNSHIRE: CallHours = uniformCallHours('08:00', '22:00')

/** Build a UTC instant from a studio-local wall clock, for readable test setup. */
function localInstant(iso: string): Date {
  return new Date(iso)
}

// ── parseHHMM / formatHHMM ────────────────────────────────────────────────────

describe('parseHHMM', () => {
  it('parses midnight', () => expect(parseHHMM('00:00')).toBe(0))
  it('parses a normal time', () => expect(parseHHMM('09:30')).toBe(570))
  it('parses the last valid minute', () => expect(parseHHMM('23:59')).toBe(1439))
  it('rejects hour 24', () => expect(parseHHMM('24:00')).toBeNull())
  it('rejects minute 60', () => expect(parseHHMM('10:60')).toBeNull())
  it('rejects unpadded input', () => expect(parseHHMM('9:00')).toBeNull())
  it('rejects garbage', () => expect(parseHHMM('nope')).toBeNull())
})

describe('formatHHMM', () => {
  it('renders midnight as 12 AM', () => expect(formatHHMM('00:00')).toBe('12:00 AM'))
  it('renders noon as 12 PM', () => expect(formatHHMM('12:00')).toBe('12:00 PM'))
  it('renders morning', () => expect(formatHHMM('09:00')).toBe('9:00 AM'))
  it('renders evening', () => expect(formatHHMM('22:30')).toBe('10:30 PM'))
  it('passes malformed values through', () => expect(formatHHMM('bogus')).toBe('bogus'))
})

// ── windowMinutes ─────────────────────────────────────────────────────────────

describe('windowMinutes', () => {
  it('returns bounds for a valid window', () => {
    expect(windowMinutes({ open: '09:00', close: '17:00' })).toEqual({ open: 540, close: 1020 })
  })
  it('treats null as closed', () => expect(windowMinutes(null)).toBeNull())
  it('treats close === open as closed', () => {
    expect(windowMinutes({ open: '09:00', close: '09:00' })).toBeNull()
  })
  it('treats an overnight wrap as closed, not as a wrap', () => {
    // 22:00–02:00 is ambiguous; failing closed beats cold-calling at 2am.
    expect(windowMinutes({ open: '22:00', close: '02:00' })).toBeNull()
  })
  it('treats a malformed end as closed', () => {
    expect(windowMinutes({ open: '09:00', close: '25:00' })).toBeNull()
  })
})

// ── normalizeCallHours ────────────────────────────────────────────────────────

describe('normalizeCallHours', () => {
  it('returns null for null (unconfigured = 24/7)', () => {
    expect(normalizeCallHours(null)).toBeNull()
  })
  it('returns null for an empty object', () => {
    expect(normalizeCallHours({})).toBeNull()
  })
  it('returns null for an array', () => {
    expect(normalizeCallHours([{ open: '09:00', close: '17:00' }])).toBeNull()
  })
  it('returns null for a string', () => {
    expect(normalizeCallHours('09:00-17:00')).toBeNull()
  })
  it('keeps valid days', () => {
    expect(normalizeCallHours({ '1': { open: '09:00', close: '17:00' } }))
      .toEqual({ '1': { open: '09:00', close: '17:00' } })
  })
  it('preserves explicit nulls as closed days', () => {
    expect(normalizeCallHours({ '0': null, '1': { open: '09:00', close: '17:00' } }))
      .toEqual({ '0': null, '1': { open: '09:00', close: '17:00' } })
  })
  it('drops an inverted window to closed rather than keeping it', () => {
    expect(normalizeCallHours({ '1': { open: '20:00', close: '09:00' } })).toEqual({ '1': null })
  })
  it('drops non-string open/close to closed', () => {
    expect(normalizeCallHours({ '1': { open: 9, close: 17 } })).toEqual({ '1': null })
  })
  it('ignores out-of-range day keys', () => {
    expect(normalizeCallHours({ '7': { open: '09:00', close: '17:00' } })).toBeNull()
  })
  it('ignores junk keys alongside valid ones', () => {
    expect(normalizeCallHours({ '1': { open: '09:00', close: '17:00' }, evil: 'x' }))
      .toEqual({ '1': { open: '09:00', close: '17:00' } })
  })
})

// ── hasAnyWindow ──────────────────────────────────────────────────────────────

describe('hasAnyWindow', () => {
  it('is false for null', () => expect(hasAnyWindow(null)).toBe(false))
  it('is false when every day is closed', () => expect(hasAnyWindow(emptyCallHours())).toBe(false))
  it('is true when one day is open', () => expect(hasAnyWindow(WHITE_ROCK)).toBe(true))
})

// ── isWithinCallHours ─────────────────────────────────────────────────────────

describe('isWithinCallHours', () => {
  it('allows calls at any time when unconfigured', () => {
    // 3am is the case that matters — unconfigured must not silently block.
    expect(isWithinCallHours(null, CHICAGO, localInstant('2026-08-05T08:00:00Z'))).toBe(true)
  })

  it('blocks every time when every day is explicitly closed', () => {
    expect(isWithinCallHours(emptyCallHours(), CHICAGO, localInstant('2026-08-05T18:00:00Z'))).toBe(false)
  })

  it('is inside the window mid-afternoon', () => {
    // Wed 2026-08-05, 14:00 Vancouver (PDT, -07:00) = 21:00Z.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-05T21:00:00Z'))).toBe(true)
  })

  it('is outside before opening', () => {
    // Wed 11:59 Vancouver = 18:59Z — one minute before the 12:00 open.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-05T18:59:00Z'))).toBe(false)
  })

  it('is inside at exactly the opening minute', () => {
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-05T19:00:00Z'))).toBe(true)
  })

  it('is outside at exactly the closing minute (close is exclusive)', () => {
    // Wed 20:00 Vancouver = 03:00Z Thursday.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-06T03:00:00Z'))).toBe(false)
  })

  it('is outside on a closed day', () => {
    // Sunday 2026-08-09, 14:00 Vancouver.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-09T21:00:00Z'))).toBe(false)
  })

  it('honours the shorter Friday close', () => {
    // Fri 2026-08-07, 19:30 Vancouver = 02:30Z Saturday. Open Mon–Thu, shut on Fri.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-08T02:30:00Z'))).toBe(false)
    // Same wall-clock on Thursday is still inside.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-07T02:30:00Z'))).toBe(true)
  })

  it('reads the window in the studio timezone, not the server timezone', () => {
    // 21:00Z is 14:00 in Vancouver (open) but 16:00 in Chicago. Both inside their
    // own windows, but the point is the tz argument decides — not the host clock.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-05T21:00:00Z'))).toBe(true)
    // 05:00Z Wed = 22:00 Tue in Vancouver (closed) but 00:00 Wed in Chicago.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-08-05T05:00:00Z'))).toBe(false)
  })

  // ── DST: the class of bug the hand-rolled n8n arithmetic was prone to ──────

  it('holds across the Vancouver spring-forward (PST → PDT)', () => {
    // 2026-03-08 is the second Sunday in March. Monday 2026-03-09 is PDT (-07:00),
    // so 12:00 local = 19:00Z. Under the old PST assumption this read as 11:00.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-03-09T19:00:00Z'))).toBe(true)
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-03-09T18:59:00Z'))).toBe(false)
  })

  it('holds across the Vancouver fall-back (PDT → PST)', () => {
    // 2026-11-01 is the first Sunday in November. Monday 2026-11-02 is PST (-08:00),
    // so 12:00 local = 20:00Z.
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-11-02T20:00:00Z'))).toBe(true)
    expect(isWithinCallHours(WHITE_ROCK, VANCOUVER, localInstant('2026-11-02T19:59:00Z'))).toBe(false)
  })

  it('handles Lincolnshire 08:00–22:00 in Chicago', () => {
    // Wed 2026-08-05, 07:59 Chicago (CDT, -05:00) = 12:59Z → outside.
    expect(isWithinCallHours(LINCOLNSHIRE, CHICAGO, localInstant('2026-08-05T12:59:00Z'))).toBe(false)
    // 08:00 Chicago = 13:00Z → inside.
    expect(isWithinCallHours(LINCOLNSHIRE, CHICAGO, localInstant('2026-08-05T13:00:00Z'))).toBe(true)
    // 22:00 Chicago = 03:00Z next day → outside (close is exclusive).
    expect(isWithinCallHours(LINCOLNSHIRE, CHICAGO, localInstant('2026-08-06T03:00:00Z'))).toBe(false)
  })
})

// ── nextCallWindowOpening ─────────────────────────────────────────────────────

describe('nextCallWindowOpening', () => {
  it('returns the input instant when unconfigured', () => {
    const at = localInstant('2026-08-05T08:00:00Z')
    expect(nextCallWindowOpening(null, CHICAGO, at)).toEqual(at)
  })

  it('returns null when no day has a window', () => {
    // Must not loop forever or invent a call time that never arrives.
    expect(nextCallWindowOpening(emptyCallHours(), CHICAGO, localInstant('2026-08-05T18:00:00Z'))).toBeNull()
  })

  it('returns the input instant when already inside the window', () => {
    const at = localInstant('2026-08-05T21:00:00Z') // Wed 14:00 Vancouver
    expect(nextCallWindowOpening(WHITE_ROCK, VANCOUVER, at)).toEqual(at)
  })

  it('rolls forward to today’s opening when called before it', () => {
    // Wed 09:00 Vancouver = 16:00Z → next opening is Wed 12:00 local = 19:00Z.
    const got = nextCallWindowOpening(WHITE_ROCK, VANCOUVER, localInstant('2026-08-05T16:00:00Z'))
    expect(got?.toISOString()).toBe('2026-08-05T19:00:00.000Z')
  })

  it('rolls to the next day when today’s window has already closed', () => {
    // Wed 21:00 Vancouver = 04:00Z Thu → next opening is Thu 12:00 local = 19:00Z Thu.
    const got = nextCallWindowOpening(WHITE_ROCK, VANCOUVER, localInstant('2026-08-06T04:00:00Z'))
    expect(got?.toISOString()).toBe('2026-08-06T19:00:00.000Z')
  })

  it('skips closed weekend days to Monday', () => {
    // Sat 2026-08-08 10:00 Vancouver = 17:00Z → next opening is Mon 2026-08-10 12:00 local.
    const got = nextCallWindowOpening(WHITE_ROCK, VANCOUVER, localInstant('2026-08-08T17:00:00Z'))
    expect(got?.toISOString()).toBe('2026-08-10T19:00:00.000Z')
  })

  it('skips from Friday evening to Monday', () => {
    // Fri 2026-08-07 19:30 Vancouver = 02:30Z Sat (Friday closes 19:00).
    const got = nextCallWindowOpening(WHITE_ROCK, VANCOUVER, localInstant('2026-08-08T02:30:00Z'))
    expect(got?.toISOString()).toBe('2026-08-10T19:00:00.000Z')
  })

  it('produces the correct UTC instant across a DST boundary', () => {
    // Sat 2026-03-07 (PST) looking ahead to Mon 2026-03-09, which is PDT.
    // 12:00 local on the 9th is 19:00Z, not the 20:00Z a fixed -08:00 would give.
    const got = nextCallWindowOpening(WHITE_ROCK, VANCOUVER, localInstant('2026-03-07T18:00:00Z'))
    expect(got?.toISOString()).toBe('2026-03-09T19:00:00.000Z')
  })

  it('finds the same weekday next week when only one day is open', () => {
    const tuesdayOnly: CallHours = { ...emptyCallHours(), '2': { open: '10:00', close: '12:00' } }
    // Tue 2026-08-04 13:00 Chicago = 18:00Z, after that day's 12:00 close.
    const got = nextCallWindowOpening(tuesdayOnly, CHICAGO, localInstant('2026-08-04T18:00:00Z'))
    expect(got?.toISOString()).toBe('2026-08-11T15:00:00.000Z') // Tue 10:00 CDT
  })
})

// ── formatNextOpeningLabel ────────────────────────────────────────────────────

describe('formatNextOpeningLabel', () => {
  it('is null when hours are unrestricted', () => {
    expect(formatNextOpeningLabel(null, VANCOUVER, localInstant('2026-08-05T10:00:00Z'))).toBeNull()
  })

  it('is null when already inside the window', () => {
    // Wed 14:00 Vancouver.
    expect(formatNextOpeningLabel(WHITE_ROCK, VANCOUVER, localInstant('2026-08-05T21:00:00Z'))).toBeNull()
  })

  it('is null when no day ever opens', () => {
    expect(formatNextOpeningLabel(emptyCallHours(), VANCOUVER, localInstant('2026-08-05T21:00:00Z'))).toBeNull()
  })

  it('shows a bare time when the window opens later today', () => {
    // Wed 09:00 Vancouver -> opens 12:00 the same day.
    expect(formatNextOpeningLabel(WHITE_ROCK, VANCOUVER, localInstant('2026-08-05T16:00:00Z')))
      .toBe('12:00 PM')
  })

  it('says "tomorrow" when today has closed', () => {
    // Wed 21:00 Vancouver (past the 20:00 close) -> Thu 12:00.
    expect(formatNextOpeningLabel(WHITE_ROCK, VANCOUVER, localInstant('2026-08-06T04:00:00Z')))
      .toBe('tomorrow 12:00 PM')
  })

  it('names the weekday when it is further out', () => {
    // Sat 10:00 Vancouver -> Mon 12:00, two days away.
    expect(formatNextOpeningLabel(WHITE_ROCK, VANCOUVER, localInstant('2026-08-08T17:00:00Z')))
      .toBe('Mon 12:00 PM')
  })

  it('reports the label in the studio timezone across a DST change', () => {
    // Sat 2026-03-07 (PST) -> Mon 2026-03-09 (PDT). Still 12:00 wall-clock.
    expect(formatNextOpeningLabel(WHITE_ROCK, VANCOUVER, localInstant('2026-03-07T18:00:00Z')))
      .toBe('Mon 12:00 PM')
  })

  it('handles Lincolnshire overnight — 02:00 Chicago resumes 8:00 AM today', () => {
    // Wed 2026-08-05 02:00 Chicago = 07:00Z.
    expect(formatNextOpeningLabel(LINCOLNSHIRE, CHICAGO, localInstant('2026-08-05T07:00:00Z')))
      .toBe('8:00 AM')
  })

  it('handles Lincolnshire just after close — 22:30 Chicago resumes tomorrow', () => {
    // Wed 22:30 Chicago = 03:30Z Thu.
    expect(formatNextOpeningLabel(LINCOLNSHIRE, CHICAGO, localInstant('2026-08-06T03:30:00Z')))
      .toBe('tomorrow 8:00 AM')
  })
})

// ── formatCallHoursSummary ────────────────────────────────────────────────────

describe('formatCallHoursSummary', () => {
  it('describes unconfigured hours', () => {
    expect(formatCallHoursSummary(null)).toBe('Calling any time')
  })
  it('describes an all-closed week', () => {
    expect(formatCallHoursSummary(emptyCallHours())).toBe('Never calling')
  })
  it('collapses a uniform week into one range', () => {
    expect(formatCallHoursSummary(LINCOLNSHIRE)).toBe('Mon–Sun 8:00 AM – 10:00 PM')
  })
  it('splits when one day differs', () => {
    expect(formatCallHoursSummary(WHITE_ROCK))
      .toBe('Mon–Thu 12:00 PM – 8:00 PM, Fri 12:00 PM – 7:00 PM')
  })
  it('renders a single open day on its own', () => {
    const tuesdayOnly: CallHours = { ...emptyCallHours(), '2': { open: '10:00', close: '12:00' } }
    expect(formatCallHoursSummary(tuesdayOnly)).toBe('Tue 10:00 AM – 12:00 PM')
  })
  it('does not merge non-adjacent days that share a window', () => {
    const monWed: CallHours = {
      ...emptyCallHours(),
      '1': { open: '09:00', close: '17:00' },
      '3': { open: '09:00', close: '17:00' },
    }
    expect(formatCallHoursSummary(monWed)).toBe('Mon 9:00 AM – 5:00 PM, Wed 9:00 AM – 5:00 PM')
  })
})
