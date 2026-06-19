// Per-source detail registry for the onboarding wizard + Settings → Studios.
//
// Each lead source can carry a small piece of structured detail (the studio's
// email address, Facebook page URL, etc.). The "kind" determines which input
// the editor shows beneath that source's card; the value is what the owner
// typed. Unknown source names fall back to the free-text 'text' kind.
//
// Stored on `studio_field_options.metadata jsonb` — see migration 046.

export type SourceKind = 'email' | 'url' | 'tel' | 'text' | 'none'

export interface SourceDetail {
  name: string
  kind: SourceKind
  /** Empty string for kind === 'none'. */
  value: string
}

interface SourceKindConfig {
  /** Label shown above the input. */
  label: string
  /** Placeholder text inside the input. */
  placeholder: string
  /** Browser input type — email/tel get validation + correct mobile keyboard. */
  inputType: 'text' | 'email' | 'tel' | 'url'
  /** Multiline when the answer is prose (kind === 'text'). */
  multiline?: boolean
}

export const SOURCE_KIND_CONFIG: Record<Exclude<SourceKind, 'none'>, SourceKindConfig> = {
  email: {
    label: 'Which email address do leads come in to?',
    placeholder: 'e.g. info@yourstudio.com',
    inputType: 'email',
  },
  url: {
    label: 'Page URL or handle',
    placeholder: 'e.g. facebook.com/yourstudio',
    inputType: 'url',
  },
  tel: {
    label: 'Phone number',
    placeholder: 'e.g. +1 847-555-1234',
    inputType: 'tel',
  },
  text: {
    label: 'How do leads come in through this source?',
    placeholder: 'A short note — your onboarding specialist can fill in the rest.',
    inputType: 'text',
    multiline: true,
  },
}

// Known source names → kind. Case-insensitive matching via sourceKindFor().
// Names here line up with the seeded defaults from migration 033 + the legacy
// values still in use by Lincolnshire (Phone, Facebook Ads, etc.).
const KNOWN_SOURCE_KINDS: Record<string, SourceKind> = {
  'email': 'email',
  'facebook': 'url',
  'facebook ads': 'url',
  'website form': 'url',
  'online': 'url',
  'walk-in': 'none',
  'phone': 'tel',
  'event': 'text',
  'guest': 'text',
}

export function sourceKindFor(name: string): SourceKind {
  return KNOWN_SOURCE_KINDS[name.trim().toLowerCase()] ?? 'text'
}

/** Build a fresh detail for a source name — used when adding/seeding. */
export function defaultSourceDetail(name: string): SourceDetail {
  return { name: name.trim(), kind: sourceKindFor(name), value: '' }
}

/**
 * Normalize an incoming detail (e.g. from the server) so the kind always
 * reflects the current name. Owners can rename a source in Settings, and
 * the kind should re-evaluate from the new name rather than stick to whatever
 * was persisted earlier.
 */
export function reconcileSourceDetail(detail: Partial<SourceDetail> & { name: string }): SourceDetail {
  const kind = sourceKindFor(detail.name)
  return {
    name: detail.name.trim(),
    kind,
    value: kind === 'none' ? '' : (detail.value ?? '').trim(),
  }
}
