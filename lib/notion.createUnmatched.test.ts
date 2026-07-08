import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createUnmatchedLeads } from './notion'
import type { SupabaseClient } from '@supabase/supabase-js'

const STUDIO = 'aeefb977-5d03-4e40-994a-327cb51b7918'

// ── Mock Supabase client ──────────────────────────────────────────────────────
// `leads`:
//   .select('phone,email').eq().range()  → existing-lead contacts (dedup load), one page only
//   .insert(row).select('id')            → records the insert + returns a fake id
// `notion_sync_log` / `activity_logs`: .insert() resolves OK (best-effort logging).
type ExistingLead = { phone: string | null; email: string | null }
function makeClient(existing: ExistingLead[]) {
  const inserts: Array<Record<string, unknown>> = []
  let insertId = 0

  function leadsBuilder() {
    const b: Record<string, unknown> = {}
    b.select = vi.fn(() => b)
    b.eq = vi.fn(() => b)
    // dedup load awaits .range() → return the existing contacts once (length < 1000 stops the loop).
    b.range = vi.fn(async () => ({ data: existing, error: null }))
    // insert(row).select('id') → record + return a fake id row.
    b.insert = vi.fn((row: Record<string, unknown>) => {
      inserts.push(row)
      return {
        select: vi.fn(async () => ({ data: [{ id: `lead-${++insertId}` }], error: null })),
      }
    })
    return b
  }

  const logInsert = vi.fn(async () => ({ data: null, error: null }))
  const activityInsert = vi.fn(async () => ({ data: null, error: null }))
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'notion_sync_log') return { insert: logInsert }
      if (table === 'activity_logs') return { insert: activityInsert }
      return leadsBuilder()
    }),
  }
  return { client: client as unknown as SupabaseClient, inserts, logInsert, activityInsert }
}

// Minimal Notion page fixtures consistent with the contact/prop shapes lib/notion.ts reads.
function page(opts: {
  id: string
  name?: string
  phone?: string
  email?: string
  status?: string
  archived?: boolean
}) {
  const props: Record<string, unknown> = {
    Name: { type: 'title', title: opts.name ? [{ plain_text: opts.name }] : [] },
    Phone: { type: 'phone_number', phone_number: opts.phone ?? null },
    Email: { type: 'email', email: opts.email ?? null },
  }
  if (opts.status) props['Status'] = { type: 'select', select: { name: opts.status } }
  return {
    id: opts.id,
    archived: opts.archived ?? false,
    in_trash: false,
    created_time: '2026-01-01T00:00:00.000Z',
    last_edited_time: '2026-01-02T00:00:00.000Z',
    properties: props,
  }
}

const TZ = 'America/Chicago'
const emptyLabelToId = new Map<string, string>()

describe('createUnmatchedLeads', () => {
  beforeEach(() => vi.stubEnv('NOTION_SYNC_MODE', 'live'))
  afterEach(() => vi.unstubAllEnvs())

  it('skips a page whose contact duplicates an existing lead', async () => {
    const { client, inserts } = makeClient([{ phone: '+12245550000', email: null }])
    const pages = [page({ id: 'p1', name: 'Dup Person', phone: '(224) 555-0000' })] // same 10 digits
    const r = await createUnmatchedLeads(client, STUDIO, pages, new Set(), TZ, emptyLabelToId)
    expect(r.skipped_dup).toBe(1)
    expect(r.created).toBe(0)
    expect(inserts).toHaveLength(0)
  })

  it('skips an empty page (no name, phone, or email)', async () => {
    const { client, inserts } = makeClient([])
    const pages = [page({ id: 'p2' })]
    const r = await createUnmatchedLeads(client, STUDIO, pages, new Set(), TZ, emptyLabelToId)
    expect(r.skipped_empty).toBe(1)
    expect(r.created).toBe(0)
    expect(inserts).toHaveLength(0)
  })

  it('skips an already-linked page', async () => {
    const { client, inserts } = makeClient([])
    const pages = [page({ id: 'p3', name: 'Already Linked', phone: '224-555-1111' })]
    const r = await createUnmatchedLeads(client, STUDIO, pages, new Set(['p3']), TZ, emptyLabelToId)
    expect(r.created).toBe(0)
    expect(r.skipped_dup).toBe(0)
    expect(r.skipped_empty).toBe(0)
    expect(inserts).toHaveLength(0)
  })

  it('skips an archived page', async () => {
    const { client, inserts } = makeClient([])
    const pages = [page({ id: 'p4', name: 'Archived', phone: '224-555-2222', archived: true })]
    const r = await createUnmatchedLeads(client, STUDIO, pages, new Set(), TZ, emptyLabelToId)
    expect(r.skipped_archived).toBe(1)
    expect(r.created).toBe(0)
    expect(inserts).toHaveLength(0)
  })

  it('creates a clean brand-new page in live mode (row mirrors the importer)', async () => {
    const labelToId = new Map<string, string>([['status:Inquiry', 'opt-inquiry']])
    const { client, inserts, activityInsert } = makeClient([])
    const pages = [page({ id: 'p5', name: 'New Lead', phone: '(224) 555-3333', email: 'New@Example.com', status: 'Inquiry' })]
    const r = await createUnmatchedLeads(client, STUDIO, pages, new Set(), TZ, labelToId)
    expect(r.created).toBe(1)
    expect(inserts).toHaveLength(1)
    // Audited in Settings → Activity Log as a Notion-sourced create.
    expect(activityInsert).toHaveBeenCalledTimes(1)
    expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
      studio_id: STUDIO, lead_id: 'lead-1', lead_name: 'New Lead', event_type: 'create', source: 'notion',
    }))
    const row = inserts[0]
    expect(row.studio_id).toBe(STUDIO)
    expect(row.name).toBe('New Lead')
    expect(row.phone).toBe('+12245553333')   // E.164
    expect(row.email).toBe('new@example.com') // normalized
    expect(row.notion_page_id).toBe('p5')
    expect(row.created_by_email).toBe('import')
    expect(row.created_at).toBe('2026-01-01T00:00:00.000Z') // page.created_time preserved
    expect(row.status).toBe('opt-inquiry')    // enum resolved to option id
    // ghl_contact_id / tick intentionally unset; nulls stripped → DB defaults apply.
    expect('ghl_contact_id' in row).toBe(false)
    expect('tick' in row).toBe(false)
  })

  it('creates nothing (only logs) in log mode', async () => {
    vi.stubEnv('NOTION_SYNC_MODE', 'log')
    const { client, inserts, logInsert, activityInsert } = makeClient([])
    const pages = [page({ id: 'p6', name: 'Would Create', phone: '224-555-4444' })]
    const r = await createUnmatchedLeads(client, STUDIO, pages, new Set(), TZ, emptyLabelToId)
    expect(r.created).toBe(1)        // counted as would-create
    expect(inserts).toHaveLength(0)  // nothing inserted into leads
    expect(logInsert).toHaveBeenCalled() // logged the would-create
    expect(activityInsert).not.toHaveBeenCalled() // dry-run never writes the audit log
  })
})
