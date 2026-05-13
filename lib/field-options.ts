import { ALL_LEAD_ENUM_FIELDS, STATUS_COLORS } from './constants'

export interface FieldOption {
  id?: string   // studio_field_options.id (UUID) — present when loaded from DB
  value: string
  bg: string
  text: string
}

// Notion-style color presets — 10 options, mirrors globals.css status-bg-* classes
export const COLOR_PRESETS: { name: string; bg: string; text: string }[] = [
  { name: 'Default', bg: 'status-bg-default', text: 'status-text-default' },
  { name: 'Gray',    bg: 'status-bg-gray',    text: 'status-text-gray' },
  { name: 'Brown',   bg: 'status-bg-brown',   text: 'status-text-brown' },
  { name: 'Orange',  bg: 'status-bg-orange',  text: 'status-text-orange' },
  { name: 'Yellow',  bg: 'status-bg-yellow',  text: 'status-text-yellow' },
  { name: 'Green',   bg: 'status-bg-green',   text: 'status-text-green' },
  { name: 'Blue',    bg: 'status-bg-blue',    text: 'status-text-blue' },
  { name: 'Purple',  bg: 'status-bg-purple',  text: 'status-text-purple' },
  { name: 'Pink',    bg: 'status-bg-pink',    text: 'status-text-pink' },
  { name: 'Red',     bg: 'status-bg-red',     text: 'status-text-red' },
]

const DEFAULT_OPTION_COLOR = COLOR_PRESETS[0] // Default

export function buildDefaultOptions(field: string): FieldOption[] {
  const enumValues = ALL_LEAD_ENUM_FIELDS[field as keyof typeof ALL_LEAD_ENUM_FIELDS]
  if (!enumValues) return []
  return (enumValues as readonly string[]).map(value => {
    const colors = STATUS_COLORS[value]
    return {
      value,
      bg: colors?.bg ?? DEFAULT_OPTION_COLOR.bg,
      text: colors?.text ?? DEFAULT_OPTION_COLOR.text,
    }
  })
}
