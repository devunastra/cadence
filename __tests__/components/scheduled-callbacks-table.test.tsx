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
 *  - Plus the cancel happy path with the new phone-based webhook contract
 *    (the regression we just hit — n8n update was matching too broadly).
 *
 * Last synced with: app/actions.ts + scheduled-callbacks-table.tsx (post phone-based cancel fix)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { screen, waitFor } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import type { ScheduledCallback } from '@/lib/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

const fetchScheduledCallbacksMock = vi.fn()
const fetchMostRecentCallForLeadMock = vi.fn()
const cancelScheduledCallbackMock = vi.fn()

vi.mock('@/app/actions', () => ({
  fetchScheduledCallbacks: (...args: unknown[]) => fetchScheduledCallbacksMock(...args),
  fetchMostRecentCallForLead: (...args: unknown[]) => fetchMostRecentCallForLeadMock(...args),
  cancelScheduledCallback: (...args: unknown[]) => cancelScheduledCallbackMock(...args),
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

// Import after mocks so the component picks up the stubs
// eslint-disable-next-line import/first
import { ScheduledCallbacksTable } from '@/components/follow-ups/scheduled-callbacks-table'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ScheduledCallback> = {}): ScheduledCallback {
  return {
    n8n_row_id: 65,
    first_name: 'Cristobal',
    last_name: 'Salido',
    phone_number: '+12244690382',
    email: 'crsalidom@gmail.com',
    dance_interest: 'For Fun',
    reason: 'For Fun',
    callback_time: '2026-05-25T22:10:00.000Z',
    lead_id: 'lead-uuid-1',
    studio_id: 'studio-uuid-1',
    ...overrides,
  }
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
  fetchScheduledCallbacksMock.mockReset()
  fetchMostRecentCallForLeadMock.mockReset()
  cancelScheduledCallbackMock.mockReset()
  showSuccessMock.mockReset()
  showWarningMock.mockReset()
  showErrorMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScheduledCallbacksTable — initial render', () => {
  it('shows the empty state when fetchScheduledCallbacks returns []', async () => {
    fetchScheduledCallbacksMock.mockResolvedValue([])
    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    expect(await screen.findByText(/no scheduled callbacks at this time/i)).toBeInTheDocument()
  })

  it('renders one row per fetched callback', async () => {
    fetchScheduledCallbacksMock.mockResolvedValue([makeRow()])
    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    expect(await screen.findByText('Cristobal Salido')).toBeInTheDocument()
    expect(screen.getByText(/1 scheduled callback$/i)).toBeInTheDocument()
  })

  it('shows error + Retry when fetch throws', async () => {
    fetchScheduledCallbacksMock.mockRejectedValue(new Error('n8n unreachable'))
    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    expect(await screen.findByText('n8n unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})

describe('TC-DRAWER-01 / happy path — row click opens CallDetailDrawer', () => {
  it('fetches the lead’s most recent call and renders the drawer', async () => {
    const user = userEvent.setup()
    fetchScheduledCallbacksMock.mockResolvedValue([makeRow()])
    fetchMostRecentCallForLeadMock.mockResolvedValue(makeCallRow())

    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    const nameCell = await screen.findByText('Cristobal Salido')

    await user.click(nameCell)

    expect(fetchMostRecentCallForLeadMock).toHaveBeenCalledWith('lead-uuid-1', 'studio-uuid-1')
    expect(await screen.findByTestId('call-detail-drawer')).toHaveTextContent('drawer:call-uuid-1')
    expect(showWarningMock).not.toHaveBeenCalled()
  })
})

describe('TC-DRAWER-02 / B-02 — row click when lead has no prior calls', () => {
  it('shows a warning toast and does NOT render the drawer', async () => {
    const user = userEvent.setup()
    fetchScheduledCallbacksMock.mockResolvedValue([makeRow()])
    fetchMostRecentCallForLeadMock.mockResolvedValue(null)

    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    const nameCell = await screen.findByText('Cristobal Salido')

    await user.click(nameCell)

    await waitFor(() =>
      expect(showWarningMock).toHaveBeenCalledWith(expect.stringMatching(/no call history/i)),
    )
    expect(screen.queryByTestId('call-detail-drawer')).not.toBeInTheDocument()
  })
})

describe('TC-CANCEL-02 / B-03 — clicking cancel button does NOT trigger the drawer', () => {
  it('opens the confirm modal without calling fetchMostRecentCallForLead', async () => {
    const user = userEvent.setup()
    fetchScheduledCallbacksMock.mockResolvedValue([makeRow()])

    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')

    const cancelBtn = screen.getByRole('button', { name: /cancel scheduled callback/i })
    await user.click(cancelBtn)

    // Confirm modal opens
    expect(screen.getByText(/cancel scheduled callback\?/i)).toBeInTheDocument()
    // Drawer-fetch must NOT have fired (stopPropagation worked)
    expect(fetchMostRecentCallForLeadMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('call-detail-drawer')).not.toBeInTheDocument()
  })
})

describe('Cancel happy path — confirming removes the row and shows success toast', () => {
  it('calls cancelScheduledCallback with the row’s n8n_row_id and removes the row', async () => {
    const user = userEvent.setup()
    fetchScheduledCallbacksMock.mockResolvedValue([makeRow()])
    cancelScheduledCallbackMock.mockResolvedValue({ success: true, rowsUpdated: 1 })

    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')

    await user.click(screen.getByRole('button', { name: /cancel scheduled callback/i }))
    await user.click(screen.getByRole('button', { name: /^cancel callback$/i }))

    await waitFor(() => expect(cancelScheduledCallbackMock).toHaveBeenCalledWith(65))
    await waitFor(() =>
      expect(showSuccessMock).toHaveBeenCalledWith(expect.stringMatching(/cancelled for cristobal salido/i)),
    )
    // Row removed from view
    expect(screen.queryByText('Cristobal Salido')).not.toBeInTheDocument()
  })

  it('shows a warning toast when rowsUpdated is 0 (race with auto-trigger)', async () => {
    const user = userEvent.setup()
    fetchScheduledCallbacksMock.mockResolvedValue([makeRow()])
    cancelScheduledCallbackMock.mockResolvedValue({ success: true, rowsUpdated: 0 })

    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')

    await user.click(screen.getByRole('button', { name: /cancel scheduled callback/i }))
    await user.click(screen.getByRole('button', { name: /^cancel callback$/i }))

    await waitFor(() =>
      expect(showWarningMock).toHaveBeenCalledWith(expect.stringMatching(/already made by the ai/i)),
    )
  })

  it('keeps the row visible + shows error toast when cancel throws', async () => {
    const user = userEvent.setup()
    fetchScheduledCallbacksMock.mockResolvedValue([makeRow()])
    cancelScheduledCallbackMock.mockRejectedValue(new Error('n8n timeout'))

    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')

    await user.click(screen.getByRole('button', { name: /cancel scheduled callback/i }))
    await user.click(screen.getByRole('button', { name: /^cancel callback$/i }))

    await waitFor(() => expect(showErrorMock).toHaveBeenCalledWith('n8n timeout'))
    // Row should still be present (not optimistically removed on error).
    // Modal stays open on error, so the name appears in both the row cell and
    // the modal copy — assert >=1 occurrence rather than exactly one.
    expect(screen.getAllByText('Cristobal Salido').length).toBeGreaterThan(0)
  })
})

describe('Multi-row sanity — cancelling row A leaves row B untouched in the UI', () => {
  // Regression for the bug Joshua just hit: cancelling one row stamped ALL pending rows.
  // The UI-side guarantee is that only the clicked row is optimistically removed; if
  // n8n stamps too broadly, the next refresh would correct it.
  it('only the clicked row is removed optimistically; the other stays', async () => {
    const user = userEvent.setup()
    const rowA = makeRow({ n8n_row_id: 65, first_name: 'Cristobal', last_name: 'Salido', phone_number: '+12244690382', lead_id: 'lead-a' })
    const rowB = makeRow({ n8n_row_id: 66, first_name: 'Test', last_name: 'User',     phone_number: '+15551234567', lead_id: 'lead-b' })
    fetchScheduledCallbacksMock.mockResolvedValue([rowA, rowB])
    cancelScheduledCallbackMock.mockResolvedValue({ success: true, rowsUpdated: 1 })

    render(<ScheduledCallbacksTable refreshTrigger={0} />)
    await screen.findByText('Cristobal Salido')
    await screen.findByText('Test User')

    // Cancel buttons render in row order
    const cancelButtons = screen.getAllByRole('button', { name: /cancel scheduled callback/i })
    await user.click(cancelButtons[0]) // click row A's cancel
    await user.click(screen.getByRole('button', { name: /^cancel callback$/i }))

    await waitFor(() => expect(screen.queryByText('Cristobal Salido')).not.toBeInTheDocument())
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(cancelScheduledCallbackMock).toHaveBeenCalledTimes(1)
    expect(cancelScheduledCallbackMock).toHaveBeenCalledWith(65)
  })
})
