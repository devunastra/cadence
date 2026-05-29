import { SOURCE_OPTIONS } from '@/lib/constants'
import type { OnboardingStudioInput } from '@/lib/types'

// Shared form input class — 16px on mobile (prevents iOS zoom), 14px on desktop.
export const INPUT =
  'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]'
export const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'
export const HELP = 'mt-1 text-xs'

export const US_STATE_OPTIONS = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
].map(s => ({ value: s, label: s }))

// Common US IANA timezones the owner can pick from.
export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern Time (New York)' },
  { value: 'America/Chicago', label: 'Central Time (Chicago)' },
  { value: 'America/Denver', label: 'Mountain Time (Denver)' },
  { value: 'America/Phoenix', label: 'Mountain Time — no DST (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska Time (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (Honolulu)' },
]

const TIMEZONE_VALUES = new Set(TIMEZONE_OPTIONS.map(o => o.value))

// US state → primary IANA timezone. Multi-zone states resolve to their most
// populous zone; the owner can always override via the picker.
const STATE_TIMEZONE: Record<string, string> = {
  Alabama: 'America/Chicago', Alaska: 'America/Anchorage', Arizona: 'America/Phoenix',
  Arkansas: 'America/Chicago', California: 'America/Los_Angeles', Colorado: 'America/Denver',
  Connecticut: 'America/New_York', Delaware: 'America/New_York',
  'District of Columbia': 'America/New_York', Florida: 'America/New_York',
  Georgia: 'America/New_York', Hawaii: 'Pacific/Honolulu', Idaho: 'America/Denver',
  Illinois: 'America/Chicago', Indiana: 'America/New_York', Iowa: 'America/Chicago',
  Kansas: 'America/Chicago', Kentucky: 'America/New_York', Louisiana: 'America/Chicago',
  Maine: 'America/New_York', Maryland: 'America/New_York', Massachusetts: 'America/New_York',
  Michigan: 'America/New_York', Minnesota: 'America/Chicago', Mississippi: 'America/Chicago',
  Missouri: 'America/Chicago', Montana: 'America/Denver', Nebraska: 'America/Chicago',
  Nevada: 'America/Los_Angeles', 'New Hampshire': 'America/New_York',
  'New Jersey': 'America/New_York', 'New Mexico': 'America/Denver', 'New York': 'America/New_York',
  'North Carolina': 'America/New_York', 'North Dakota': 'America/Chicago', Ohio: 'America/New_York',
  Oklahoma: 'America/Chicago', Oregon: 'America/Los_Angeles', Pennsylvania: 'America/New_York',
  'Rhode Island': 'America/New_York', 'South Carolina': 'America/New_York',
  'South Dakota': 'America/Chicago', Tennessee: 'America/Chicago', Texas: 'America/Chicago',
  Utah: 'America/Denver', Vermont: 'America/New_York', Virginia: 'America/New_York',
  Washington: 'America/Los_Angeles', 'West Virginia': 'America/New_York',
  Wisconsin: 'America/Chicago', Wyoming: 'America/Denver',
}

/**
 * Hybrid timezone default: map from US state when known, else the browser's
 * resolved zone if it's one of our common options, else Central Time.
 */
export function defaultTimezoneForState(state: string): string {
  if (state && STATE_TIMEZONE[state]) return STATE_TIMEZONE[state]
  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browserTz && TIMEZONE_VALUES.has(browserTz)) return browserTz
  } catch {
    // ignore — fall through to default
  }
  return 'America/Chicago'
}

// First four SOURCE_OPTIONS are the new defaults: Website Form, Facebook, Email, Walk-In.
export const DEFAULT_SOURCES: string[] = SOURCE_OPTIONS.slice(0, 4)

export function makeEmptyStudio(): OnboardingStudioInput {
  return {
    name: '',
    street_address: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'United States',
    ghl_account_id: '',
    ghl_calendar_id: '',
    ghl_api_key: '',
    retell_agent_id: '',
    retell_inbound_agent_id: '',
    retell_api_key: '',
    retell_phone_number: '',
    sources: [...DEFAULT_SOURCES],
    timezone: defaultTimezoneForState(''),
    calendar_start_hour: 9,
    calendar_end_hour: 21,
    appointment_duration_minutes: 45,
    appointment_min_advance_weeks: 1,
    appointment_slots: {},
  }
}
