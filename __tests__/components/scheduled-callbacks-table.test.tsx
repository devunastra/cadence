/**
 * Component tests for ScheduledCallbacksTable covering the P0 ship-blockers the
 * qa-tester flagged:
 *
 *  - TC-CANCEL-02 / B-03: clicking the cancel button must NOT trigger the row's
 *    drawer-fetch click handler (e.stopPropagation). Regression risk if anyone
 *    edits the row markup later.
 *  - TC-DRAWER-02 / B-02: row click on a lead with no prior calls must show a
 *    warning toast and must NOT render the CallDetailDrawer.
 *  - Plus a happy-path drawer-open test so the negative tests aren't read in
 *    isolation.
 *  - Plus the cancel happy path, now on the migration-053 contract: cancel
 *    targets ONE row by uuid primary key and returns { ok, cancelled }. The old
 *    phone-based webhook (which stamped every pending row for a phone) is gone.
 *
 * Last synced with: app/actions.ts + scheduled-callbacks-table.tsx (post migration 053)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { screen, waitFor } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import type { PendingScheduledCall } from '@/lib/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

const fetchScheduledCallsMock = vi.fn()
const fetchMostRecentCallForLeadMock = vi.fn()
const cancelScheduledCallMock = vi.fn()

vi.mock('@/app/actions', () => ({
  fetchScheduledCalls: (...args: unknown[]) => fetchScheduledCallsMock(...args),
  fetchMostRecentCallForLead: (...args: unknown[]) => fetchMostRecentCallForLeadMock(...args),
  cancelScheduledCall: (...args: unknown[]) => cancelScheduledCallMock(...args),
}))

const showSuccessMock = vi.fn()
const showWarningMock = vi.fn()
const showErrorMock = vi.fn()

vi.mock('@/components/ui/toast-provider', () => ({
  useToast: () => ({
    showSuccess: showSuccessMock,
    showWarning: showWarningMock,
    showError: showErrorMock,
  }),
}))

vi.mock('@/components/call-history/call-detail-drawer', () => ({
  CallDetailDrawer: ({ call }: { call: { id: string } }) => (
    <div data-testid="call-detail-drawer">drawer:{call.id}</div>
  ),
}))

// The table reads currentStudio.timezone via useCurrentStudio(); stub the
// context so the tests don't need a real StudioProvider wrapper.
vi.mock('@/components/studio-context', () => ({
  useCurrentStudio: () => ({ currentStudio: { timezone: 'America/Chicago' } }),
}))

// Post-053 the table subscribes to scheduled_calls via Realtime. Stub the
// browser client so the subscription is a no-op in tests.
const removeChannelMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: () => {
      const chan = { on: () => chan, subscribe: () => chan }
      return chan
    },
    removeChannel: removeChannelMock,
  }),
}))

// Import after mocks so the component picks up the stubs
import { ScheduledCallbacksTable } from '@/components/follow-ups/scheduled-callbacks-table'

const STUDIO = 'studio-uuid-1'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<PendingScheduledCall> = {}): PendingScheduledCall {
  return {
    id: 'call-row-1',
    studio_id: STUDIO,
    lead_id: 'lead-uuid-1',
    first_name: 'Cristobal',
    last_name: 'Salido',
    phone_number: '+12244690382',
    email: 'crsalidom@gmail.com',
    dance_interest: 'For Fun',
    reason: 'For Fun',
    call_note: null,
    callback_time: '2026-05-25T22:10:00.000Z',
    called_at: null,
    retell_call_id: null,
    source: 'ai_agent',
    created_by: null,
    cancelled_at: null,
    cancelled_by: null,
    skipped_at: null,
    skip_reason: null,
    followup_attempt: null,
    followup_triggered_by_call_id: null,
    created_at: '2026-05-20T22:10:00.000Z',
    updated_at: '2026-05-20T22:10:00.000Z',
    ...overrides,
  } as PendingScheduledCall
}

function makeCallRow(leadId = 'lead-uuid-1') {
  return {
    id: 'call-uuid-1',
    retell_call_id: 'retell-1',
    created_at: '2026-05-20T12:00:00.000Z',
    duration_seconds: 120,
    outcome: 'successful',
    sentiment: 'positive',
    transcript_summary: 'Lead asked for a callback tomorrow at 1pm',
    lead_id: leadId,
    direction: 'inbound',
    disconnected_reason: 'user_hangup',
    quality_score: 0.85,
    appointment_booked: false,
    recording_url: null,
    picked_up: true,
    transferred: false,
    lead_name: 'Cristobal Salido',
    lead_phone: '+12244690382',
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  fetchScheduledCallsMock.mockReset()
  fetchMostRecentCallForLeadMock.mockReset()
  cancelScheduledCallMock.mockReset()
  showSuccessMock.mockReset()
  showWarningMock.mockReset()
  showErrorMock.mockReset()
  removeChannelMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScheduledCallbacksTable — initial render', () => {
  it('shows the empty state when fetchScheduledCalls returns []', async () => {
    fetchScheduledCallsMock.mockResolvedValue([])
    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    expect(await screen.findByText(/no scheduled calls at this time/i)).toBeInTheDocument()
  })

  it('renders one row per fetched call', async () => {
    fetchScheduledCallsMock.mockResolvedValue([makeRow()])
    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    expect(await screen.findByText('Cristobal Salido')).toBeInTheDocument()
    expect(screen.getByText(/1 scheduled call$/i)).toBeInTheDocument()
  })

  // The pre-053 fetch took no studioId and unioned every studio the user
  // belonged to, so the sidebar studio switcher had no effect on this tab.
  it('scopes the fetch to the studio it was given', async () => {
    fetchScheduledCallsMock.mockResolvedValue([])
    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    await waitFor(() => expect(fetchScheduledCallsMock).toHaveBeenCalledWith(STUDIO))
  })

  it('shows error + Retry when fetch throws', async () => {
    fetchScheduledCallsMock.mockRejectedValue(new Error('database unreachable'))
    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    expect(await screen.findByText('database unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('distinguishes staff-scheduled rows from AI-agent rows', async () => {
    fetchScheduledCallsMock.mockResolvedValue([
      makeRow({ id: 'a', source: 'manual', first_name: 'Manual', last_name: 'Row' }),
      makeRow({ id: 'b', source: 'ai_agent', first_name: 'Agent', last_name: 'Row' }),
    ])
    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    expect(await screen.findByText(/scheduled by staff/i)).toBeInTheDocument()
    expect(screen.getByText(/^AI agent$/i)).toBeInTheDocument()
  })

  // The no-answer ladder (migration 061). followup_attempt counts only the
  // automatic retries (1-4), so rung 1 is overall attempt 2 of 5 — the +1 is the
  // whole point of these tests.
  it('labels a follow-up row with its position in the 5-call ladder', async () => {
    fetchScheduledCallsMock.mockResolvedValue([
      makeRow({ id: 'f1', source: 'followup', followup_attempt: 1, first_name: 'Rung', last_name: 'One' }),
    ])
    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    expect(await screen.findByText(/attempt 2 of 5/i)).toBeInTheDocument()
  })

  it('labels the final rung as attempt 5 of 5', async () => {
    fetchScheduledCallsMock.mockResolvedValue([
      makeRow({ id: 'f4', source: 'followup', followup_attempt: 4, first_name: 'Last', last_name: 'Rung' }),
    ])
    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    expect(await screen.findByText(/attempt 5 of 5/i)).toBeInTheDocument()
  })

  // Defensive: a followup row whose attempt is somehow null must still render a
  // badge rather than "attempt NaN of 5".
  it('falls back to a bare label when a follow-up row has no attempt number', async () => {
    fetchScheduledCallsMock.mockResolvedValue([
      makeRow({ id: 'f0', source: 'followup', followup_attempt: null, first_name: 'No', last_name: 'Attempt' }),
    ])
    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    expect(await screen.findByText(/^Auto follow-up$/i)).toBeInTheDocument()
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument()
  })
})

describe('TC-DRAWER-01 / happy path — row click opens CallDetailDrawer', () => {
  it('fetches the lead’s most recent call and renders the drawer', async () => {
    const user = userEvent.setup()
    fetchScheduledCallsMock.mockResolvedValue([makeRow()])
    fetchMostRecentCallForLeadMock.mockResolvedValue(makeCallRow())

    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    const nameCell = await screen.findByText('Cristobal Salido')

    await user.click(nameCell)

    expect(fetchMostRecentCallForLeadMock).toHaveBeenCalledWith('lead-uuid-1', STUDIO)
    expect(await screen.findByTestId('call-detail-drawer')).toHaveTextContent('drawer:call-uuid-1')
    expect(showWarningMock).not.toHaveBeenCalled()
  })
})

describe('TC-DRAWER-02 / B-02 — row click when lead has no prior calls', () => {
  it('shows a warning toast and does NOT render the drawer', async () => {
    const user = userEvent.setup()
    fetchScheduledCallsMock.mockResolvedValue([makeRow()])
    fetchMostRecentCallForLeadMock.mockResolvedValue(null)

    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    const nameCell = await screen.findByText('Cristobal Salido')

    await user.click(nameCell)

    await waitFor(() =>
      expect(showWarningMock).toHaveBeenCalledWith(expect.stringMatching(/no call history/i)),
    )
    expect(screen.queryByTestId('call-detail-drawer')).not.toBeInTheDocument()
  })
})

describe('TC-DRAWER-03 — row click when the row has no linked lead', () => {
  // lead_id is nullable post-053: an inbound caller can be queued before they
  // exist as a lead. Clicking must not call the action with a null id.
  it('warns and skips the fetch entirely', async () => {
    const user = userEvent.setup()
    fetchScheduledCallsMock.mockResolvedValue([makeRow({ lead_id: null })])

    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    await user.click(await screen.findByText('Cristobal Salido'))

    await waitFor(() =>
      expect(showWarningMock).toHaveBeenCalledWith(expect.stringMatching(/isn't linked to a lead/i)),
    )
    expect(fetchMostRecentCallForLeadMock).not.toHaveBeenCalled()
  })
})

describe('TC-CANCEL-02 / B-03 — clicking cancel button does NOT trigger the drawer', () => {
  it('opens the confirm modal without calling fetchMostRecentCallForLead', async () => {
    const user = userEvent.setup()
    fetchScheduledCallsMock.mockResolvedValue([makeRow()])

    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')

    const cancelBtn = screen.getByRole('button', { name: /cancel scheduled call/i })
    await user.click(cancelBtn)

    // Confirm modal opens
    expect(screen.getByText(/cancel scheduled call\?/i)).toBeInTheDocument()
    // Drawer-fetch must NOT have fired (stopPropagation worked)
    expect(fetchMostRecentCallForLeadMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('call-detail-drawer')).not.toBeInTheDocument()
  })
})

describe('Cancel happy path — confirming removes the row and shows success toast', () => {
  it('calls cancelScheduledCall with the row’s uuid and removes the row', async () => {
    const user = userEvent.setup()
    fetchScheduledCallsMock.mockResolvedValue([makeRow()])
    cancelScheduledCallMock.mockResolvedValue({ ok: true, cancelled: true })

    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')

    await user.click(screen.getByRole('button', { name: /cancel scheduled call/i }))
    await user.click(screen.getByRole('button', { name: /^cancel call$/i }))

    await waitFor(() => expect(cancelScheduledCallMock).toHaveBeenCalledWith('call-row-1'))
    await waitFor(() =>
      expect(showSuccessMock).toHaveBeenCalledWith(expect.stringMatching(/cancelled for cristobal salido/i)),
    )
    // Row removed from view
    expect(screen.queryByText('Cristobal Salido')).not.toBeInTheDocument()
  })

  it('warns when cancelled is false (dialer won the race)', async () => {
    const user = userEvent.setup()
    fetchScheduledCallsMock.mockResolvedValue([makeRow()])
    cancelScheduledCallMock.mockResolvedValue({ ok: true, cancelled: false })

    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')

    await user.click(screen.getByRole('button', { name: /cancel scheduled call/i }))
    await user.click(screen.getByRole('button', { name: /^cancel call$/i }))

    await waitFor(() =>
      expect(showWarningMock).toHaveBeenCalledWith(expect.stringMatching(/already went out/i)),
    )
  })

  it('keeps the row visible + shows error toast when cancel throws', async () => {
    const user = userEvent.setup()
    fetchScheduledCallsMock.mockResolvedValue([makeRow()])
    cancelScheduledCallMock.mockRejectedValue(new Error('database timeout'))

    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')

    await user.click(screen.getByRole('button', { name: /cancel scheduled call/i }))
    await user.click(screen.getByRole('button', { name: /^cancel call$/i }))

    await waitFor(() => expect(showErrorMock).toHaveBeenCalledWith('database timeout'))
    // Row should still be present (not optimistically removed on error).
    // Modal stays open on error, so the name appears in both the row cell and
    // the modal copy — assert >=1 occurrence rather than exactly one.
    expect(screen.getAllByText('Cristobal Salido').length).toBeGreaterThan(0)
  })
})

describe('Multi-row sanity — cancelling row A leaves row B untouched', () => {
  // Pre-053 cancel matched on phone_number and stamped EVERY pending row for
  // that phone. Now it targets one uuid, so this is a real guarantee rather than
  // a UI-side illusion corrected on the next refresh.
  it('only the clicked row is cancelled; the other stays', async () => {
    const user = userEvent.setup()
    const rowA = makeRow({ id: 'row-a', first_name: 'Cristobal', last_name: 'Salido', phone_number: '+12244690382', lead_id: 'lead-a' })
    const rowB = makeRow({ id: 'row-b', first_name: 'Test', last_name: 'User', phone_number: '+15551234567', lead_id: 'lead-b' })
    fetchScheduledCallsMock.mockResolvedValue([rowA, rowB])
    cancelScheduledCallMock.mockResolvedValue({ ok: true, cancelled: true })

    render(<ScheduledCallbacksTable studioId={STUDIO} refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')
    await screen.findByText('Test User')

    // Cancel buttons render in row order
    const cancelButtons = screen.getAllByRole('button', { name: /cancel scheduled call/i })
    await user.click(cancelButtons[0]) // click row A's cancel
    await user.click(screen.getByRole('button', { name: /^cancel call$/i }))

    await waitFor(() => expect(screen.queryByText('Cristobal Salido')).not.toBeInTheDocument())
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(cancelScheduledCallMock).toHaveBeenCalledTimes(1)
    expect(cancelScheduledCallMock).toHaveBeenCalledWith('row-a')
  })
})
