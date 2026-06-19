import { SOURCE_OPTIONS } from '@/lib/constants'
import { defaultTimezoneForCountryRegion } from '@/lib/locale-data'
import { defaultSourceDetail } from '@/lib/source-kinds'
import type { SourceDetail } from '@/lib/source-kinds'
import type { OnboardingStudioInput } from '@/lib/types'

// Shared form input class — 16px on mobile (prevents iOS zoom), 14px on desktop.
export const INPUT =
  'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]'
export const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'
export const HELP = 'mt-1 text-xs'

// First four SOURCE_OPTIONS are the new defaults: Website Form, Facebook, Email, Walk-In.
const DEFAULT_SOURCE_NAMES: readonly string[] = SOURCE_OPTIONS.slice(0, 4)
export const DEFAULT_SOURCES: SourceDetail[] = DEFAULT_SOURCE_NAMES.map(defaultSourceDetail)

export function makeEmptyStudio(): OnboardingStudioInput {
  // Defaults to the US so the existing onboarding flow still gets the state dropdown
  // out of the gate. defaultTimezoneForCountryRegion returns null for multi-tz countries
  // like the US, so we fall back to Central Time for the initial form state.
  const defaultCountry = 'United States'
  return {
    name: '',
    street_address: '',
    city: '',
    state: '',
    postal_code: '',
    country: defaultCountry,
    ghl_account_id: '',
    ghl_calendar_id: '',
    ghl_api_key: '',
    retell_agent_id: '',
    retell_inbound_agent_id: '',
    retell_api_key: '',
    retell_phone_number: '',
    sources: DEFAULT_SOURCE_NAMES.map(defaultSourceDetail),
    timezone: defaultTimezoneForCountryRegion(defaultCountry, '') ?? 'America/Chicago',
    calendar_start_hour: 9,
    calendar_end_hour: 21,
    appointment_duration_minutes: 45,
    appointment_min_advance_weeks: 1,
    appointment_slots: {},
  }
}
