/**
 * Component tests for FollowupsToggle — the Leads-header switch that pauses the
 * automatic no-answer follow-up ladder (migrations 061 + 062).
 *
 * The behaviours worth pinning are the ones that make the switch trustworthy
 * rather than the ones that make it render:
 *
 *  - It says "Off", not just "unchecked". A header pill is scanned, not read.
 *  - The off state promises the queue survives. If that copy ever disappears the
 *    switch becomes one nobody dares touch, because the destructive reading is
 *    what users assume by default.
 *  - studio_staff cannot flip it (server enforces too — this is the UI half).
 *  - A failed save reverts the optimistic update, so the pill never claims a
 *    state the database doesn't have.
 *
 * Last synced with: components/leads/followups-toggle.tsx, app/actions.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { screen, waitFor } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import type { Studio } from '@/lib/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

const setFollowupsEnabledMock = vi.fn()
vi.mock('@/app/actions', () => ({
  setFollowupsEnabled: (...args: unknown[]) => setFollowupsEnabledMock(...args),
}))

const showErrorMock = vi.fn()
vi.mock('@/components/ui/toast-provider', () => ({
  useToast: () => ({ showError: showErrorMock }),
}))

// Realtime is a no-op in tests (mirrors the scheduled-callbacks-table stub).
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    realtime: { setAuth: () => {} },
    channel: () => {
      const chan = { on: () => chan, subscribe: () => chan }
      return chan
    },
    removeChannel: () => {},
  }),
}))

const updateCurrentStudioMock = vi.fn()
const studioState: { studio: Partial<Studio>; role: string; isSuper: boolean } = {
  studio: {},
  role: 'studio_owner',
  isSuper: false,
}

vi.mock('@/components/studio-context', () => ({
  useCurrentStudio: () => ({
    currentStudio: studioState.studio,
    updateCurrentStudio: updateCurrentStudioMock,
    userRole: studioState.role,
    isSuper: studioState.isSuper,
  }),
}))

// Import after mocks so the component picks up the stubs
import { FollowupsToggle } from '@/components/leads/followups-toggle'

const STUDIO_ID = 'studio-uuid-1'

function setup({
  enabled = true,
  role = 'studio_owner',
  isSuper = false,
}: { enabled?: boolean; role?: string; isSuper?: boolean } = {}) {
  studioState.studio = {
    id: STUDIO_ID,
    followups_enabled: enabled,
    followups_paused_at: null,
    followups_paused_by: null,
  }
  studioState.role = role
  studioState.isSuper = isSuper
  return render(<FollowupsToggle />)
}

beforeEach(() => {
  vi.clearAllMocks()
  setFollowupsEnabledMock.mockResolvedValue(undefined)
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FollowupsToggle', () => {
  it('names the state in words, not just the knob position', () => {
    setup({ enabled: true })
    expect(screen.getByText(/Automatic follow-ups: On/)).toBeTruthy()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('renders Off with the switch unchecked when paused', () => {
    setup({ enabled: false })
    expect(screen.getByText(/Automatic follow-ups: Off/)).toBeTruthy()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('promises the queue survives while off', () => {
    // The single most important sentence on this control: off HOLDS the queued
    // rungs, it does not cancel them. Losing this copy would make the switch
    // read as destructive and nobody would use it.
    setup({ enabled: false })
    expect(screen.getByText(/on hold, not cancelled/i)).toBeTruthy()
  })

  it('turns follow-ups off through the server action', async () => {
    setup({ enabled: true })
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(setFollowupsEnabledMock).toHaveBeenCalledWith(STUDIO_ID, false))
    // Optimistic first, so the pill flips without waiting on the round trip.
    expect(updateCurrentStudioMock).toHaveBeenCalledWith(
      expect.objectContaining({ followups_enabled: false }),
    )
  })

  it('turns follow-ups back on through the server action', async () => {
    setup({ enabled: false })
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(setFollowupsEnabledMock).toHaveBeenCalledWith(STUDIO_ID, true))
    expect(updateCurrentStudioMock).toHaveBeenCalledWith(
      expect.objectContaining({ followups_enabled: true, followups_paused_at: null }),
    )
  })

  it('does not let studio_staff flip it', async () => {
    setup({ enabled: true, role: 'studio_staff' })
    const sw = screen.getByRole('switch') as HTMLButtonElement
    expect(sw.disabled).toBe(true)
    await userEvent.click(sw)
    expect(setFollowupsEnabledMock).not.toHaveBeenCalled()
  })

  it('lets a super_admin flip it even without an owner role on this studio', async () => {
    setup({ enabled: true, role: 'studio_staff', isSuper: true })
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(setFollowupsEnabledMock).toHaveBeenCalledWith(STUDIO_ID, false))
  })

  it('reverts the optimistic flip when the save fails', async () => {
    setFollowupsEnabledMock.mockRejectedValue(new Error('Forbidden'))
    setup({ enabled: true })
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showErrorMock).toHaveBeenCalledWith('Forbidden'))
    // Last write puts it back where it started — the pill must never claim a
    // state the database doesn't have.
    expect(updateCurrentStudioMock).toHaveBeenLastCalledWith({ followups_enabled: true })
  })
})
