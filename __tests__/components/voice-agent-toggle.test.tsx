/**
 * Component tests for VoiceAgentToggle — the AI Voice Agent pill in the Leads header.
 *
 * The pill is gated by TWO independent mechanisms: the voice_agent_enabled switch
 * and the studio's calling window (studios.call_hours, enforced by the n8n dialers).
 * Before the window existed the pill only had to read the switch. Now a pill that
 * reads only the switch says "Active" while every outbound call is being held —
 * which is exactly the bug these tests exist to prevent regressing.
 *
 * Time is pinned with fake timers so the window states are deterministic.
 * Lincolnshire's real window (08:00–22:00 America/Chicago) is used throughout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { screen, waitFor } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import type { Studio } from '@/lib/types'
import { uniformCallHours } from '@/lib/call-hours'

// ── Mocks ────────────────────────────────────────────────────────────────────

const setVoiceAgentEnabledMock = vi.fn()
const updateStudioMock = vi.fn()
const updateCurrentStudioMock = vi.fn()

vi.mock('@/app/actions', () => ({
  setVoiceAgentEnabled: (...a: unknown[]) => setVoiceAgentEnabledMock(...a),
  updateStudio: (...a: unknown[]) => updateStudioMock(...a),
}))

vi.mock('@/components/ui/toast-provider', () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

// Realtime is irrelevant to what's under test; stub the whole client.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    realtime: { setAuth: vi.fn() },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
  }),
}))

let studio: Studio
let userRole = 'studio_owner'

vi.mock('@/components/studio-context', () => ({
  useCurrentStudio: () => ({
    currentStudio: studio,
    updateCurrentStudio: updateCurrentStudioMock,
    userRole,
    isSuper: false,
    studioId: studio.id,
  }),
}))

import { VoiceAgentToggle } from '@/components/leads/voice-agent-toggle'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LINCOLNSHIRE_HOURS = uniformCallHours('08:00', '22:00')

function makeStudio(over: Partial<Studio> = {}): Studio {
  return {
    id: 'studio-1',
    name: 'Arthur Murray Lincolnshire',
    timezone: 'America/Chicago',
    voice_agent_enabled: true,
    voice_agent_paused_at: null,
    voice_agent_paused_by: null,
    call_hours: LINCOLNSHIRE_HOURS,
    ...over,
  } as Studio
}

/** 2026-08-05 02:25 America/Chicago — the exact case from the bug report. */
const OUTSIDE_WINDOW = new Date('2026-08-05T07:25:00Z')
/** 2026-08-05 14:00 America/Chicago — comfortably inside 08:00–22:00. */
const INSIDE_WINDOW = new Date('2026-08-05T19:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  // shouldAdvanceTime lets userEvent's internal waits resolve while the clock
  // stays pinned to whatever setSystemTime we choose per test.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  userRole = 'studio_owner'
  studio = makeStudio()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Status states ────────────────────────────────────────────────────────────

describe('VoiceAgentToggle status', () => {
  it('shows Active when the switch is on and the studio is inside its window', async () => {
    vi.setSystemTime(INSIDE_WINDOW)
    render(<VoiceAgentToggle />)
    await waitFor(() => {
      expect(screen.getByText(/AI Voice Agent: Active/)).toBeInTheDocument()
    })
  })

  it('does NOT claim Active when the switch is on but the window is closed', async () => {
    // The regression this whole test file exists for.
    vi.setSystemTime(OUTSIDE_WINDOW)
    render(<VoiceAgentToggle />)
    await waitFor(() => {
      expect(screen.getByText(/AI Voice Agent: Outside calling hours/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/AI Voice Agent: Active/)).not.toBeInTheDocument()
  })

  it('says when calling resumes', async () => {
    vi.setSystemTime(OUTSIDE_WINDOW) // 02:25 Chicago -> opens 08:00 the same day
    render(<VoiceAgentToggle />)
    await waitFor(() => {
      expect(screen.getByText(/resumes 8:00 AM/)).toBeInTheDocument()
    })
  })

  it('shows Paused when the switch is off, regardless of the window', async () => {
    vi.setSystemTime(INSIDE_WINDOW)
    studio = makeStudio({ voice_agent_enabled: false })
    render(<VoiceAgentToggle />)
    await waitFor(() => {
      expect(screen.getByText(/AI Voice Agent: Paused/)).toBeInTheDocument()
    })
  })

  it('shows Active at any hour when no window is configured', async () => {
    // NULL call_hours means unrestricted — must not be read as "closed".
    vi.setSystemTime(OUTSIDE_WINDOW)
    studio = makeStudio({ call_hours: null })
    render(<VoiceAgentToggle />)
    await waitFor(() => {
      expect(screen.getByText(/AI Voice Agent: Active/)).toBeInTheDocument()
    })
  })

  it('reads the window in the studio timezone, not the host timezone', async () => {
    // 07:25Z is 02:25 in Chicago (closed) but 15:25 in Manila (would be open).
    // A studio on Manila time at the same instant must read as open.
    vi.setSystemTime(OUTSIDE_WINDOW)
    studio = makeStudio({ timezone: 'Asia/Manila' })
    render(<VoiceAgentToggle />)
    await waitFor(() => {
      expect(screen.getByText(/AI Voice Agent: Active/)).toBeInTheDocument()
    })
  })
})

// ── Actions ──────────────────────────────────────────────────────────────────

describe('VoiceAgentToggle actions', () => {
  it('opens the calling-hours modal from the overflow menu', async () => {
    vi.setSystemTime(OUTSIDE_WINDOW)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<VoiceAgentToggle />)

    await user.click(await screen.findByLabelText('AI voice agent settings'))
    await user.click(await screen.findByRole('menuitem', { name: /Calling hours/ }))

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /calling hours/i })).toBeInTheDocument()
    })
  })

  it('hides both controls from studio_staff', async () => {
    vi.setSystemTime(INSIDE_WINDOW)
    userRole = 'studio_staff'
    render(<VoiceAgentToggle />)
    await waitFor(() => {
      expect(screen.getByText(/AI Voice Agent: Active/)).toBeInTheDocument()
    })
    // Staff can read the status but updateStudio would reject them anyway.
    expect(screen.queryByLabelText('AI voice agent settings')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })

  it('does not over-promise when resuming outside the window', async () => {
    vi.setSystemTime(OUTSIDE_WINDOW)
    studio = makeStudio({ voice_agent_enabled: false })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<VoiceAgentToggle />)

    await user.click(await screen.findByRole('button', { name: 'Resume' }))

    // "immediately start placing outbound calls" would be false at 02:25.
    await waitFor(() => {
      expect(screen.getByText(/queued and start 8:00 AM/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/immediately start placing outbound calls/)).not.toBeInTheDocument()
  })
})
