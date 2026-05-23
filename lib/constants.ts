export const STATUS_OPTIONS = [
  'Active',
  'Out of Town',
  "Didn't Buy",
  "Didn't Show",
  'Broken Toe',
  'Injury',
  'Inactive',
  'On Automation',
  'Solicitation',
  'Wrong Location',
] as const

export const LEVEL_OPTIONS = [
  'Inquiry',
  'Front',
  'Middle',
  'Back',
  'Lost',
  'Guest',
  'Bronze 1',
  'Bronze 2',
  'Bronze 3',
  'Bronze 4',
  'Silver 1',
  'Silver 2',
  'Old Inquiry',
] as const

export const ACTION_OPTIONS = [
  'NO SHOW',
  'Call Back',
  'Scheduled',
  'WRONG LOCATION',
  'DO NOT CALL',
  'Emailed',
  'Left Message',
  'NO VOICEMAIL',
  'Other',
  'Revisit',
  'Texting',
  'WRONG NUMBER',
  'Walk-In',
  'Phone Call',
  'Bought Gift Certificate',
  'AI Called',
] as const

export const SOURCE_OPTIONS = [
  'Facebook Ads',
  'Online',
  'Guest',
  'Phone',
  'Walk-In',
  'Event',
] as const

export const REASON_OPTIONS = [
  'Wedding',
  'For Fun',
  'Special Occasion',
  'Other',
] as const

export const PARTNERSHIP_OPTIONS = ['Couple', 'Single'] as const

export type Status = (typeof STATUS_OPTIONS)[number]
export type Level = (typeof LEVEL_OPTIONS)[number]
export type Action = (typeof ACTION_OPTIONS)[number]
export type Source = (typeof SOURCE_OPTIONS)[number]
export type Reason = (typeof REASON_OPTIONS)[number]
export type Partnership = (typeof PARTNERSHIP_OPTIONS)[number]

export const ALL_LEAD_ENUM_FIELDS = {
  status: STATUS_OPTIONS,
  level: LEVEL_OPTIONS,
  action: ACTION_OPTIONS,
  source: SOURCE_OPTIONS,
  reason: REASON_OPTIONS,
  partnership: PARTNERSHIP_OPTIONS,
} as const

// Notion palette hex values — use where CSS classes can't be applied (charts, JS DOM, inline SVG fills)
export const NOTION_COLORS = {
  green:  { bg: '#EDF3EC', text: '#448361' },
  yellow: { bg: '#FBF3DB', text: '#CB912F' },
  red:    { bg: '#FFE2DD', text: '#C4554D' },
  blue:   { bg: '#D3E5EF', text: '#337EA9' },
  purple: { bg: '#EDE9F4', text: '#9065B0' },
  pink:   { bg: '#F5E0E9', text: '#C14C8A' },
  gray:   { bg: '#F1F1EF', text: '#787774' },
  orange: { bg: '#FAEBDD', text: '#C97B48' },
  brown:  { bg: '#EEE0DA', text: '#9F6B53' },
} as const

// Color map using CSS classes defined in app/globals.css (status-bg-* / status-text-*)
// These classes have explicit .dark variants, so they work without Tailwind scanning.
export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  // Status field
  Active:                    { bg: 'status-bg-green',   text: 'status-text-green' },
  'Out of Town':             { bg: 'status-bg-yellow',  text: 'status-text-yellow' },
  "Didn't Buy":              { bg: 'status-bg-brown',   text: 'status-text-brown' },
  "Didn't Show":             { bg: 'status-bg-purple',  text: 'status-text-purple' },
  'Broken Toe':              { bg: 'status-bg-gray',    text: 'status-text-gray' },
  Injury:                    { bg: 'status-bg-default', text: 'status-text-default' },
  Inactive:                  { bg: 'status-bg-red',     text: 'status-text-red' },
  'On Automation':           { bg: 'status-bg-orange',  text: 'status-text-orange' },
  Solicitation:              { bg: 'status-bg-pink',    text: 'status-text-pink' },
  solicitation:              { bg: 'status-bg-pink',    text: 'status-text-pink' },
  'Wrong Location':          { bg: 'status-bg-blue',    text: 'status-text-blue' },
  // Level field
  Inquiry:                   { bg: 'status-bg-gray',    text: 'status-text-gray' },
  Front:                     { bg: 'status-bg-pink',    text: 'status-text-pink' },
  Middle:                    { bg: 'status-bg-yellow',  text: 'status-text-yellow' },
  Back:                      { bg: 'status-bg-green',   text: 'status-text-green' },
  Lost:                      { bg: 'status-bg-red',     text: 'status-text-red' },
  Loss:                      { bg: 'status-bg-red',     text: 'status-text-red' },
  Guest:                     { bg: 'status-bg-default', text: 'status-text-default' },
  'Bronze 1':                { bg: 'status-bg-orange',  text: 'status-text-orange' },
  'Bronze 2':                { bg: 'status-bg-blue',    text: 'status-text-blue' },
  'Bronze 3':                { bg: 'status-bg-purple',  text: 'status-text-purple' },
  'Bronze 4':                { bg: 'status-bg-brown',   text: 'status-text-brown' },
  'Silver 1':                { bg: 'status-bg-default', text: 'status-text-default' },
  'Silver 2':                { bg: 'status-bg-pink',    text: 'status-text-pink' },
  'Old Inquiry':             { bg: 'status-bg-green',   text: 'status-text-green' },
  'Old inquiry':             { bg: 'status-bg-green',   text: 'status-text-green' },
  // Action field
  'NO SHOW':                 { bg: 'status-bg-pink',    text: 'status-text-pink' },
  'Call Back':               { bg: 'status-bg-yellow',  text: 'status-text-yellow' },
  Scheduled:                 { bg: 'status-bg-green',   text: 'status-text-green' },
  'WRONG LOCATION':          { bg: 'status-bg-red',     text: 'status-text-red' },
  'DO NOT CALL':             { bg: 'status-bg-red',     text: 'status-text-red' },
  Emailed:                   { bg: 'status-bg-purple',  text: 'status-text-purple' },
  'Left Message':            { bg: 'status-bg-default', text: 'status-text-default' },
  'NO VOICEMAIL':            { bg: 'status-bg-orange',  text: 'status-text-orange' },
  Other:                     { bg: 'status-bg-brown',   text: 'status-text-brown' },
  Revisit:                   { bg: 'status-bg-blue',    text: 'status-text-blue' },
  Texting:                   { bg: 'status-bg-pink',    text: 'status-text-pink' },
  'WRONG NUMBER':            { bg: 'status-bg-red',     text: 'status-text-red' },
  'Walk-In':                 { bg: 'status-bg-gray',    text: 'status-text-gray' },
  'Phone Call':              { bg: 'status-bg-red',     text: 'status-text-red' },
  'phone call':              { bg: 'status-bg-red',     text: 'status-text-red' },
  'Bought Gift Certificate': { bg: 'status-bg-blue',    text: 'status-text-blue' },
  'bought gift certificate': { bg: 'status-bg-blue',    text: 'status-text-blue' },
  'AI Called':               { bg: 'status-bg-purple',  text: 'status-text-purple' },
  // Source field
  'Facebook Ads':            { bg: 'status-bg-purple',  text: 'status-text-purple' },
  Online:                    { bg: 'status-bg-brown',   text: 'status-text-brown' },
  Phone:                     { bg: 'status-bg-blue',    text: 'status-text-blue' },
  Event:                     { bg: 'status-bg-green',   text: 'status-text-green' },
  // Reason field
  Wedding:                   { bg: 'status-bg-blue',    text: 'status-text-blue' },
  'For Fun':                 { bg: 'status-bg-pink',    text: 'status-text-pink' },
  'Special Occasion':        { bg: 'status-bg-gray',    text: 'status-text-gray' },
  // Partnership field
  Couple:                    { bg: 'status-bg-purple',  text: 'status-text-purple' },
  Single:                    { bg: 'status-bg-red',     text: 'status-text-red' },
  // Activity log event types
  Create:                    { bg: 'status-bg-green',   text: 'status-text-green' },
  Update:                    { bg: 'status-bg-blue',    text: 'status-text-blue' },
  Delete:                    { bg: 'status-bg-red',     text: 'status-text-red' },
  // Call outcomes
  successful:                { bg: 'status-bg-green',   text: 'status-text-green' },
  unsuccessful:              { bg: 'status-bg-red',     text: 'status-text-red' },
  // Call review grades
  Pass:                      { bg: 'status-bg-green',   text: 'status-text-green' },
  Fail:                      { bg: 'status-bg-red',     text: 'status-text-red' },
  // Call sentiment
  positive:                  { bg: 'status-bg-green',   text: 'status-text-green' },
  neutral:                   { bg: 'status-bg-blue',    text: 'status-text-blue' },
  negative:                  { bg: 'status-bg-red',     text: 'status-text-red' },
  unknown:                   { bg: 'status-bg-gray',    text: 'status-text-gray' },
  // Call direction
  inbound:                   { bg: 'status-bg-blue',    text: 'status-text-blue' },
  outbound:                  { bg: 'status-bg-purple',  text: 'status-text-purple' },
  // Disconnect reasons
  agent_hangup:              { bg: 'status-bg-green',   text: 'status-text-green' },
  user_hangup:               { bg: 'status-bg-green',   text: 'status-text-green' },
  voicemail:                 { bg: 'status-bg-orange',  text: 'status-text-orange' },
  voicemail_reached:         { bg: 'status-bg-orange',  text: 'status-text-orange' },
  dial_no_answer:            { bg: 'status-bg-yellow',  text: 'status-text-yellow' },
  dial_busy:                 { bg: 'status-bg-red',     text: 'status-text-red' },
  call_transfer:             { bg: 'status-bg-blue',    text: 'status-text-blue' },
  // Call results (derived)
  Voicemail:                 { bg: 'status-bg-orange',  text: 'status-text-orange' },
  'Left Voicemail':          { bg: 'status-bg-blue',    text: 'status-text-blue' },
  'Voicemail Reached':       { bg: 'status-bg-blue',    text: 'status-text-blue' },
  'No Answer':               { bg: 'status-bg-yellow',  text: 'status-text-yellow' },
  Busy:                      { bg: 'status-bg-red',     text: 'status-text-red' },
  Transferred:               { bg: 'status-bg-orange',  text: 'status-text-orange' },
  Booked:                    { bg: 'status-bg-green',   text: 'status-text-green' },
  'User Hung Up':            { bg: 'status-bg-pink',    text: 'status-text-pink' },
  'Agent Hung Up':           { bg: 'status-bg-purple',  text: 'status-text-purple' },
}
