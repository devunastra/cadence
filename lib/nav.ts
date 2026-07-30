// Single source of truth for the sidebar nav pages and their per-studio
// visibility. Consumed by:
//   - components/sidebar/sidebar.tsx  (renders the visible tabs)
//   - components/settings/studio-nav-tabs.tsx  (super_admin toggles)
//   - components/nav-guard.tsx  (redirects away from a hidden page)
//   - app/actions.ts  (setStudioNavOverrides sanitizes against this list)
//
// Kept icon-free on purpose so it's safe to import from server code
// (app/actions.ts) as well as client components. Icons live in the sidebar.

export interface NavPageMeta {
  /** Route prefix, matches the sidebar Link href. */
  href: string
  label: string
  /** Always visible, not toggleable (the home tab). */
  core?: boolean
  /** Visibility when a studio has no explicit override. Defaults to true. */
  defaultVisible?: boolean
}

// Order matches the sidebar top-to-bottom.
export const NAV_PAGES: NavPageMeta[] = [
  { href: '/leads', label: 'Leads', core: true },
  { href: '/conversations', label: 'Conversations' },
  { href: '/calendar', label: 'Appointments' },
  { href: '/call-analytics', label: 'Call Analytics' },
  { href: '/call-history', label: 'Call History' },
  { href: '/call-quality', label: 'Quality Review' },
  { href: '/follow-ups', label: 'Follow-ups' },
  { href: '/test', label: 'Test', defaultVisible: false },
]

/** Map of nav href -> visible boolean. Only explicit overrides are stored. */
export type NavOverrides = Record<string, boolean>

/** Pages a super_admin can toggle per studio (everything but the core home tab). */
export const TOGGLEABLE_PAGES = NAV_PAGES.filter((p) => !p.core)

function pageDefaultVisible(page: NavPageMeta): boolean {
  return page.defaultVisible !== false
}

/** Is `href` visible for a studio with the given overrides? */
export function isPageVisible(href: string, overrides: NavOverrides | null | undefined): boolean {
  const page = NAV_PAGES.find((p) => p.href === href)
  if (!page) return true // unknown route (e.g. /settings) — never hidden
  if (page.core) return true
  const o = overrides?.[href]
  if (typeof o === 'boolean') return o
  return pageDefaultVisible(page)
}

/** Find the nav page a pathname belongs to (exact or nested, e.g. /leads/123). */
export function findNavPage(pathname: string): NavPageMeta | undefined {
  return NAV_PAGES.find((p) => pathname === p.href || pathname.startsWith(p.href + '/'))
}
