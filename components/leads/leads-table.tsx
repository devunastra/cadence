'use client'

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { useMounted } from '@/lib/hooks'
import { displayTzForLeadField } from '@/lib/date-utils'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PanelRightOpen, Clock, User, CircleDot, Trophy, Zap, Phone, Calendar, GraduationCap, MessageSquare, Globe, Mail, Tag, AlarmClock, Users, CheckSquare, Copy, Check, Trash2, ChevronDown, X, type LucideIcon } from 'lucide-react'
import { EnumDropdown } from './enum-dropdown'
import { DatePickerPopup } from './date-picker-popup'
import { NewLeadModal } from './new-lead-modal'
import { LeadsFilterBar } from './leads-filter-bar'
import { ViewsSelector } from './views-selector'
import { Checkbox } from './checkbox'
import { ConfirmDeleteModal } from '@/components/confirm-delete-modal'
import { useCurrentStudio } from '@/components/studio-context'
import { ALL_LEAD_ENUM_FIELDS, STATUS_COLORS } from '@/lib/constants'
import { buildDefaultOptions } from '@/lib/field-options'
import { ALL_COLUMNS_VIEW } from '@/lib/views'
import { createLeadView, deleteLeadView, updateLeadView, fetchLeadsPage, fetchLeadById, deleteLeads, bulkUpdateLeads, updateLead, saveUserPreferences, addStudioFieldOption, renameStudioFieldOption, deleteStudioFieldOption, savePageFilters, fetchStudioFieldOptions } from '@/app/actions'
import type { PageFilters } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from 'next-themes'
import type { FieldOption } from '@/lib/field-options'
import type { LeadView } from '@/lib/views'
import type { Lead } from '@/lib/types'
import { Spinner } from '@/components/spinner'

function formatPhone(raw: string | null): string {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`
  return raw
}

function formatNameList(names: string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`
}

function formatDateTime(iso: string | null, tz: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: tz,
  }).replace(' at ', ', ')
}

const ENUM_FIELDS = Object.keys(ALL_LEAD_ENUM_FIELDS) as (keyof typeof ALL_LEAD_ENUM_FIELDS)[]
const BOOLEAN_FIELDS: (keyof Lead)[] = ['showed', 'bought', 'old']
const DATE_FIELDS: (keyof Lead)[] = ['last_contacted', 'first_lesson']

// Token-driven styling for inline cell edit inputs — keeps them consistent
// with the design system and correct in dark mode (no hardcoded grays).
const EDIT_INPUT_STYLE: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text-primary)',
}

const DEFAULT_COL_WIDTHS: Partial<Record<keyof Lead, number>> = {
  created_at:     210,
  name:           170,
  status:         120,
  level:           90,
  action:         142,
  phone:          140,
  last_contacted: 220,
  first_lesson:   190,
  comments:       240,
  source:         100,
  email:          235,
  reason:         110,
  available:      110,
  showed:         100,
  bought:         100,
  partnership:    125,
  old:             90,
}
const PAGE_SIZE_OPTIONS = [20, 50, 100]

interface DropdownState {
  leadId: string
  field: keyof Lead
  anchorRect: DOMRect
}

interface EditingCell {
  leadId: string
  field: keyof Lead
}

interface LeadsTableProps {
  studioId: string | null
}

function PageInput({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (p: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const digits = Math.max(String(totalPages).length, 1)

  function commit() {
    const n = parseInt(value, 10)
    if (!isNaN(n) && n >= 1 && n <= totalPages && n !== page + 1) onJump(n - 1)
    setEditing(false)
  }

  return (
    <div
      className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md select-none transition-colors"
      style={{
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
        backgroundColor: 'var(--color-bg)',
        cursor: editing ? 'default' : 'pointer',
      }}
      onClick={() => { if (!editing) { setValue(String(page + 1)); setEditing(true) } }}
      onMouseEnter={e => { if (!editing) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)' }}
    >
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="bg-transparent focus:outline-none text-center"
          style={{ width: `${digits}ch`, color: 'var(--color-text-primary)' }}
        />
      ) : (
        <span style={{ display: 'inline-block', width: `${digits}ch`, textAlign: 'center' }}>{page + 1}</span>
      )}
      <span style={{ color: 'var(--color-text-muted)' }}>/ {totalPages}</span>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      title="Copy"
      className="flex-shrink-0 opacity-0 group-hover/cell:opacity-100 p-0.5 rounded transition-all"
      style={{ color: 'var(--color-text-muted)' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
    >
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  )
}

const ALL_COLUMNS: { key: keyof Lead; label: string; icon?: LucideIcon }[] = [
  { key: 'created_at',     label: 'Created Time',  icon: Clock },
  { key: 'name',           label: 'Name',           icon: User },
  { key: 'status',         label: 'Status',         icon: CircleDot },
  { key: 'level',          label: 'Level',          icon: Trophy },
  { key: 'action',         label: 'Action',         icon: Zap },
  { key: 'phone',          label: 'Phone',          icon: Phone },
  { key: 'last_contacted', label: 'Last Contacted', icon: Calendar },
  { key: 'first_lesson',   label: 'First Lesson',   icon: GraduationCap },
  { key: 'comments',       label: 'Comments',       icon: MessageSquare },
  { key: 'source',         label: 'Source',         icon: Globe },
  { key: 'email',          label: 'Email',          icon: Mail },
  { key: 'reason',         label: 'Reason',         icon: Tag },
  { key: 'available',      label: 'Available',      icon: AlarmClock },
  { key: 'showed',         label: 'Showed',         icon: CheckSquare },
  { key: 'bought',         label: 'Bought',         icon: CheckSquare },
  { key: 'partnership',    label: 'Partnership',    icon: Users },
  { key: 'old',            label: 'OLD',            icon: CheckSquare },
]

export function LeadsTable({ studioId }: LeadsTableProps) {
  const router = useRouter()
  const { currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  const { theme, setTheme } = useTheme()
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [newLeadNames, setNewLeadNames] = useState<{ name: string; email: string | null }[]>([])
  const [deletedLeadNames, setDeletedLeadNames] = useState<{ name: string; email: string | null }[]>([])
  const [updatedLeadNames, setUpdatedLeadNames] = useState<{ name: string; email: string | null }[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [editValue, setEditValue] = useState<string>('')
  const [dropdown, setDropdown] = useState<DropdownState | null>(null)
  const [datePicker, setDatePicker] = useState<{ leadId: string; field: keyof Lead; anchorRect: DOMRect } | null>(null)
  const [fieldOptions, setFieldOptions] = useState<Record<string, FieldOption[]>>({})
  const [sortField, setSortField] = useState('created_at')
  const [sortAscending, setSortAscending] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [levelFilter, setLevelFilter] = useState<string[]>([])
  const [actionFilter, setActionFilter] = useState<string[]>([])
  const [sourceFilter, setSourceFilter] = useState<string[]>([])
  const [reasonFilter, setReasonFilter] = useState<string[]>([])
  const [views, setViews] = useState<LeadView[]>([ALL_COLUMNS_VIEW])
  const [activeViewId, setActiveViewId] = useState('all')
  const [, startTransition] = useTransition()
  const mounted = useMounted()
  const [showNewLead, setShowNewLead] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [bulkField, setBulkField] = useState<string | null>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizeRef = useRef<{ field: string; startX: number; startWidth: number; minWidth: number } | null>(null)
  const prefSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filterSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [prefsReady, setPrefsReady] = useState(false)
  const initializing = useRef(true)
  const editingRef = useRef<EditingCell | null>(null)
  const editCommittedRef = useRef(false)
  const localInsertIds = useRef<Set<string>>(new Set())
  const pendingLocalInserts = useRef(0)
  const localDeleteIds = useRef<Set<string>>(new Set())
  // Tracks in-flight optimistic updates per lead ID to suppress own Realtime echo.
  // Uses a counter (not a Set) so rapid sequential edits on the same lead don't drop suppression early.
  const localUpdateCounts = useRef<Map<string, number>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realtimeChannelRef = useRef<any>(null)
  const currentUserEmailRef = useRef<string | null>(null)
  const pendingUpdateInfoRef = useRef<Map<string, { name: string; email: string | null }>>(new Map())

  useEffect(() => {
    if (!bulkField) return
    function handleClick() { setBulkField(null) }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [bulkField])

  // Keep ref in sync so realtime callback always sees latest editing cell
  useEffect(() => { editingRef.current = editing }, [editing])

  // Realtime subscription — syncs lead changes made by other users
  useEffect(() => {
    if (!studioId || !mounted) return
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return
      // Store current user's email so handleDeleteSelected can include it in broadcasts
      currentUserEmailRef.current = user.email ?? null
      // For realtime authentication, we still need the session for the access token.
      // Calling getSession after getUser is fine as the token is now validated.
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) supabase.realtime.setAuth(session.access_token)
      })
      channel = supabase
        .channel(`leads-${studioId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'leads', filter: `studio_id=eq.${studioId}` },
          (payload) => {
            if (payload.eventType === 'UPDATE') {
              const updatedId = (payload.new as Lead).id
              if (editingRef.current?.leadId === updatedId) return  // skip if user is currently editing this lead
              // Skip Realtime echo for leads updated optimistically by this session.
              // Decrement the counter; only let the echo through once all pending updates are accounted for.
              const pendingCount = localUpdateCounts.current.get(updatedId) ?? 0
              if (pendingCount > 0) {
                if (pendingCount === 1) localUpdateCounts.current.delete(updatedId)
                else localUpdateCounts.current.set(updatedId, pendingCount - 1)
                return
              }
              // Fetch the fully resolved lead from the server to get display values, not raw UUIDs
              fetchLeadById(updatedId).then(updated => {
                if (!updated) return
                setLeads(prev => prev.map(l => {
                  if (l.id !== updated.id) return l
                  if (editingRef.current?.leadId === l.id) return l  // re-check in case edit started during fetch
                  return updated
                }))
                // Show banner now that row is updated — both appear simultaneously
                const info = pendingUpdateInfoRef.current.get(updatedId)
                if (info) {
                  setUpdatedLeadNames(prev => [...prev, info])
                  pendingUpdateInfoRef.current.delete(updatedId)
                }
              })
            } else if (payload.eventType === 'INSERT') {
              const inserted = payload.new as Lead
              // Skip if the INSERT was confirmed by the current session already
              if (localInsertIds.current.has(inserted.id)) {
                localInsertIds.current.delete(inserted.id)
                return
              }
              // Skip if a local create is still in-flight (Realtime arrived before HTTP response)
              if (pendingLocalInserts.current > 0) {
                return
              }
              setNewLeadNames(prev => [...prev, { name: inserted.name || 'Unknown', email: inserted.created_by_email ?? null }])
            } else if (payload.eventType === 'DELETE') {
              const deletedId = (payload.old as { id: string }).id
              // If this session deleted it, remove silently — broadcast already sent the banner
              if (localDeleteIds.current.has(deletedId)) {
                localDeleteIds.current.delete(deletedId)
                return
              }
              // Another user deleted — silently remove from view (banner comes via broadcast)
              setLeads(prev => prev.filter(l => l.id !== deletedId))
              setTotal(t => Math.max(0, t - 1))
            }
          }
        )
        .on(
          'broadcast',
          { event: 'leads_deleted' },
          (msg: { payload: { names: string[]; deletedBy: string | null } }) => {
            const { names, deletedBy } = msg.payload
            setDeletedLeadNames(prev => [
              ...prev,
              ...names.map(name => ({ name, email: deletedBy })),
            ])
          }
        )
        .on(
          'broadcast',
          { event: 'leads_updated' },
          (msg: { payload: { leads: { id: string; name: string }[]; updatedBy: string | null } }) => {
            const { leads: updatedLeads, updatedBy } = msg.payload
            // Ignore own broadcasts — the sender sees their optimistic update already
            if (updatedBy === currentUserEmailRef.current) return
            for (const { id, name } of updatedLeads) {
              const info = { name, email: updatedBy }
              if (pendingUpdateInfoRef.current.has(id)) {
                // postgres_changes already ran — show banner now, row is already updated
                setUpdatedLeadNames(prev => [...prev, info])
                pendingUpdateInfoRef.current.delete(id)
              } else {
                // Wait for postgres_changes to trigger fetchLeadById before showing banner
                pendingUpdateInfoRef.current.set(id, info)
              }
            }
          }
        )
        .subscribe()
      realtimeChannelRef.current = channel
      if (cancelled) { supabase.removeChannel(channel); channel = null; realtimeChannelRef.current = null }
    })

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
      realtimeChannelRef.current = null
    }
  }, [studioId, mounted])

  async function handleBulkUpdate(field: string, value: string | null) {
    const ids = Array.from(selectedIds)
    const displayValue = value === '' || value === null ? null : value
    // Look up option ID for DB storage
    const optionId = displayValue !== null
      ? (fieldOptions[field] ?? []).find(o => o.value === displayValue)?.id ?? null
      : null
    const prevValues = new Map(leads.filter(l => selectedIds.has(l.id)).map(l => [l.id, l[field as keyof Lead]]))
    const updatedLeadEntries = leads.filter(l => selectedIds.has(l.id)).map(l => ({ id: l.id, name: l.name || 'Unknown' }))
    // Register each ID so Realtime echoes from our own bulk write are suppressed
    ids.forEach(id => localUpdateCounts.current.set(id, (localUpdateCounts.current.get(id) ?? 0) + 1))
    setLeads(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, [field]: displayValue } : l))
    setBulkField(null)
    // Selection is intentionally kept so the user can continue editing other fields on the same rows
    bulkUpdateLeads(ids, field, optionId)
      .then(() => broadcastLeadUpdated(updatedLeadEntries))
      .catch(() => {
        ids.forEach(id => {
          const c = localUpdateCounts.current.get(id) ?? 0
          if (c <= 1) localUpdateCounts.current.delete(id)
          else localUpdateCounts.current.set(id, c - 1)
        })
        setLeads(prev => prev.map(l => prevValues.has(l.id) ? { ...l, [field]: prevValues.get(l.id) } : l))
      })
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    setDeleting(true)
    const ids = Array.from(selectedIds)
    // Capture names before the rows disappear from state
    const deletedNames = leads.filter(l => selectedIds.has(l.id)).map(l => l.name || 'Unknown')
    // Mark as locally deleted so the postgres_changes DELETE echo is ignored
    ids.forEach(id => localDeleteIds.current.add(id))
    try {
      await deleteLeads(ids)
      setLeads(prev => prev.filter(l => !selectedIds.has(l.id)))
      setTotal(prev => prev - selectedIds.size)
      setSelectedIds(new Set())
      // Broadcast to other sessions so they can show the banner with email
      realtimeChannelRef.current?.send({
        type: 'broadcast',
        event: 'leads_deleted',
        payload: { names: deletedNames, deletedBy: currentUserEmailRef.current },
      })
    } catch (err) {
      // Delete failed — remove from local tracking so Realtime isn't suppressed
      ids.forEach(id => localDeleteIds.current.delete(id))
      throw err
    } finally {
      setDeleting(false)
      setShowConfirmDelete(false)
    }
  }

  function broadcastLeadUpdated(leads: { id: string; name: string }[]) {
    realtimeChannelRef.current?.send({
      type: 'broadcast',
      event: 'leads_updated',
      payload: { leads, updatedBy: currentUserEmailRef.current },
    })
  }

  function startResize(e: React.MouseEvent, field: string) {
    e.preventDefault()
    const minWidth = 40
    const th = (e.currentTarget as HTMLElement).closest('th')!
    // Use stored width if already resized; otherwise measure actual rendered width
    const startWidth = colWidths[field] ?? th.getBoundingClientRect().width
    resizeRef.current = { field, startX: e.clientX, startWidth, minWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMouseMove(ev: MouseEvent) {
      if (!resizeRef.current) return
      const { field, startX, startWidth, minWidth } = resizeRef.current
      const newWidth = Math.max(minWidth, startWidth + ev.clientX - startX)
      setColWidths(prev => ({ ...prev, [field]: newWidth }))
    }
    function onMouseUp() {
      resizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  // Debounce search so typing doesn't fire a request per keystroke
  const [debouncedSearch, setDebouncedSearch] = useState('')
  function handleDebouncedSearch(value: string) {
    setDebouncedSearch(value)
    setPage(0)
  }

  function handleStatusFilterChange(value: string[]) { setStatusFilter(value); setPage(0) }
  function handleLevelFilterChange(value: string[]) { setLevelFilter(value); setPage(0) }
  function handleActionFilterChange(value: string[]) { setActionFilter(value); setPage(0) }
  function handleSourceFilterChange(value: string[]) { setSourceFilter(value); setPage(0) }
  function handleReasonFilterChange(value: string[]) { setReasonFilter(value); setPage(0) }

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(0)
    setSelectedIds(new Set())
  }

  // Debounced DB save when colWidths change — skip during initial load
  useEffect(() => {
    if (Object.keys(colWidths).length === 0 || !studioId || !mounted || initializing.current) return
    if (prefSaveTimer.current) clearTimeout(prefSaveTimer.current)
    prefSaveTimer.current = setTimeout(() => {
      saveUserPreferences(studioId, colWidths, activeViewId, (theme ?? 'light') as 'light' | 'dark').catch(console.error)
    }, 1000)
  }, [colWidths, studioId, mounted, activeViewId, theme])

  // Single source of truth for the leads list. Waits for prefsReady so the saved
  // filters/sort (loaded by the mount effect below) are applied before the first fetch —
  // otherwise the initial view would diverge from filtered/searched results.
  useEffect(() => {
    if (!mounted || !prefsReady) return
    setLoading(true)
    fetchLeadsPage({ studioId, page, pageSize, search: debouncedSearch, statusFilter, levelFilter, actionFilter, sourceFilter, reasonFilter, sortField, sortAscending })
      .then(({ leads: data, total: count }) => {
        setLeads(data)
        setTotal(count)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [mounted, prefsReady, studioId, page, pageSize, debouncedSearch, statusFilter, levelFilter, actionFilter, sourceFilter, reasonFilter, sortField, sortAscending, refreshKey])

  // Reset confirm-delete state whenever the selection changes
  useEffect(() => { setShowConfirmDelete(false) }, [selectedIds])

  // Load prefs, views, and field options on mount via the browser client.
  // Leads themselves are fetched by the fetchLeadsPage effect above (single source
  // of truth) once prefsReady flips true — so saved filters/sort apply from the first render.
  useEffect(() => {
    if (!studioId) return
    setPrefsReady(false)

    let cancelled = false
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (cancelled || !user) { if (!cancelled) setLoading(false); return }
      // studio_field_options is fetched via a server action (fetchStudioFieldOptions)
      // because it's RLS-scoped on the browser client. Super_admins who don't have
      // a studio_users row in `studioId` would otherwise see an empty list and the
      // New Lead modal's dropdowns would show "No matches".
      // (Same RLS gap pattern as updateStudio / analyze-call-quality / update-role.)
      const [viewsRes, fieldOptsRows, prefsRes] = await Promise.all([
        supabase.from('lead_views').select('*').eq('studio_id', studioId).order('created_at', { ascending: true }),
        fetchStudioFieldOptions(studioId).catch(() => [] as Array<{ id: string; field: string; value: string; bg: string | null; text: string | null }>),
        supabase.from('user_preferences').select('col_widths, active_view_id, theme, page_filters, notify_lead_created, notify_lead_updated, notify_lead_deleted').eq('user_id', user.id).eq('studio_id', studioId).maybeSingle(),
      ])
      if (cancelled) return
      // Views
      const customViews = (viewsRes.data ?? []).map((v: { id: string; name: string; columns: string[] }) => ({
        id: v.id, name: v.name, columns: v.columns,
      }))
      setViews([ALL_COLUMNS_VIEW, ...customViews])
      // Preferences
      const prefs = prefsRes.data
      if (prefs) {
        const t = (prefs.theme as string) === 'dark' ? 'dark' : 'light'
        setTheme(t)
        const cw = (prefs.col_widths ?? {}) as Record<string, number>
        if (Object.keys(cw).length > 0) setColWidths(cw)
        if (prefs.active_view_id) setActiveViewId(prefs.active_view_id as string)
        // Page filters
        const pf = (prefs.page_filters ?? {}) as PageFilters
        if (pf.leads?.filters?.status) setStatusFilter(pf.leads.filters.status)
        if (pf.leads?.filters?.level) setLevelFilter(pf.leads.filters.level)
        if (pf.leads?.filters?.action) setActionFilter(pf.leads.filters.action)
        if (pf.leads?.filters?.source) setSourceFilter(pf.leads.filters.source)
        if (pf.leads?.filters?.reason) setReasonFilter(pf.leads.filters.reason)
        if (pf.leads?.sort?.field) setSortField(pf.leads.sort.field)
        if (pf.leads?.sort?.ascending != null) setSortAscending(pf.leads.sort.ascending)
      }
      // Field options (already RLS-bypassed via the server action above)
      const fieldOpts: Record<string, Array<{ id: string; value: string; bg: string | null; text: string | null }>> = {}
      for (const row of fieldOptsRows) {
        if (!fieldOpts[row.field]) fieldOpts[row.field] = []
        if (fieldOpts[row.field].some(o => o.value === row.value)) continue
        fieldOpts[row.field].push({ id: row.id, value: row.value, bg: row.bg ?? null, text: row.text ?? null })
      }
      const defaults: Record<string, FieldOption[]> = {}
      for (const field of ENUM_FIELDS) defaults[field] = buildDefaultOptions(field)
      const merged: Record<string, FieldOption[]> = {}
      for (const field of ENUM_FIELDS) {
        const studioRows = fieldOpts[field] ?? []
        merged[field] = studioRows.map(({ id, value, bg, text }) => {
          const defaultColor = defaults[field].find(o => o.value === value)
          return { id, value, bg: bg ?? defaultColor?.bg ?? 'status-bg-default', text: text ?? defaultColor?.text ?? 'status-text-default' }
        })
      }
      setFieldOptions(merged)
      // Prefs (incl. saved filters/sort) are applied — release the fetchLeadsPage effect
      // so it fetches leads with the correct filters/sort as the single source of truth.
      setPrefsReady(true)
      // Clear initializing flag after a tick so dependent save effects skip this batch
      setTimeout(() => { initializing.current = false }, 0)
    }).catch(() => { if (!cancelled) setPrefsReady(true) })  // still load leads with defaults if prefs fail
    return () => { cancelled = true }
  }, [studioId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist filter + sort changes to Supabase (debounced 1s) — skip during initial load
  useEffect(() => {
    if (!studioId || !mounted || initializing.current) return
    if (filterSaveTimer.current) clearTimeout(filterSaveTimer.current)
    filterSaveTimer.current = setTimeout(() => {
      savePageFilters(studioId, {
        leads: {
          filters: { status: statusFilter, level: levelFilter, action: actionFilter, source: sourceFilter, reason: reasonFilter },
          sort: { field: sortField, ascending: sortAscending },
        },
      }).catch(() => {})
    }, 1000)
    return () => { if (filterSaveTimer.current) clearTimeout(filterSaveTimer.current) }
  }, [studioId, mounted, statusFilter, levelFilter, actionFilter, sourceFilter, reasonFilter, sortField, sortAscending]) // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(lead: Lead, field: keyof Lead) {
    editCommittedRef.current = false
    setEditing({ leadId: lead.id, field })
    setEditValue(String(lead[field] ?? ''))
  }

  async function commitEdit(lead: Lead, field: keyof Lead) {
    if (editCommittedRef.current) return  // prevent double-fire from Enter key + unmount blur
    editCommittedRef.current = true
    setEditing(null)
    const newValue = editValue === '' ? null : editValue
    const currentValue = (lead[field] === '' ? null : lead[field]) as typeof newValue
    if (newValue === currentValue) return
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, [field]: newValue } : l))
    startTransition(async () => {
      try {
        await updateLead(lead.id, { [field]: newValue })
        broadcastLeadUpdated([{ id: lead.id, name: lead.name || 'Unknown' }])
      } catch {
        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, [field]: lead[field] } : l))
      }
    })
  }

  async function commitDateSelect(lead: Lead, field: keyof Lead, iso: string | null) {
    if (iso === lead[field]) return
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, [field]: iso } : l))
    startTransition(async () => {
      try {
        await updateLead(lead.id, { [field]: iso })
        broadcastLeadUpdated([{ id: lead.id, name: lead.name || 'Unknown' }])
      } catch {
        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, [field]: lead[field] } : l))
      }
    })
  }

  async function commitEnumSelect(lead: Lead, field: keyof Lead, value: string | null) {
    if (value === lead[field]) return
    // Look up the option ID from fieldOptions state (DB stores UUID, not display name)
    const optionId = value !== null
      ? (fieldOptions[String(field)] ?? []).find(o => o.value === value)?.id ?? null
      : null
    // Register the pending update so the Realtime echo is suppressed for this lead
    localUpdateCounts.current.set(lead.id, (localUpdateCounts.current.get(lead.id) ?? 0) + 1)
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, [field]: value } : l))
    startTransition(async () => {
      try {
        await updateLead(lead.id, { [field]: optionId })
        broadcastLeadUpdated([{ id: lead.id, name: lead.name || 'Unknown' }])
      } catch {
        const c = localUpdateCounts.current.get(lead.id) ?? 0
        if (c <= 1) localUpdateCounts.current.delete(lead.id)
        else localUpdateCounts.current.set(lead.id, c - 1)
        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, [field]: lead[field] } : l))
      }
    })
  }

  async function toggleBoolean(lead: Lead, field: keyof Lead) {
    const newValue = !lead[field]
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, [field]: newValue } : l))
    try {
      await updateLead(lead.id, { [field]: newValue as boolean })
      broadcastLeadUpdated([{ id: lead.id, name: lead.name || 'Unknown' }])
    } catch {
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, [field]: lead[field] } : l))
    }
  }

  const handleOptionsChange = useCallback((field: string, options: FieldOption[]) => {
    setFieldOptions(prev => ({ ...prev, [field]: options }))
  }, [])

  const handleOptionRenamed = useCallback((field: string, oldValue: string, newValue: string) => {
    renameStudioFieldOption(studioId!, field, oldValue, newValue).catch(console.error)
    setLeads(prev => prev.map(l =>
      l[field as keyof Lead] === oldValue ? { ...l, [field]: newValue } : l
    ))
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).map(o => o.value === oldValue ? { ...o, value: newValue } : o),
    }))
  }, [studioId])

  const handleOptionAdded = useCallback((field: string, value: string): Promise<{ id: string; value: string }> => {
    if (!studioId) return Promise.resolve({ id: '', value })
    return addStudioFieldOption(studioId, field, value)
  }, [studioId])

  const handleOptionDeleted = useCallback(async (field: string, optionId: string): Promise<void> => {
    await deleteStudioFieldOption(optionId)
    setLeads(prev => prev.map(l => {
      const opt = (fieldOptions[field] ?? []).find(o => o.id === optionId)
      if (!opt) return l
      return l[field as keyof Lead] === opt.value ? { ...l, [field]: null } : l
    }))
    setFieldOptions(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).filter(o => o.id !== optionId),
    }))
  }, [fieldOptions])

  async function handleCreateView(view: LeadView): Promise<void> {
    if (!studioId) return
    try {
      const saved = await createLeadView(studioId, view.name, view.columns)
      setViews(prev => [...prev, { id: saved.id, name: saved.name, columns: saved.columns }])
      setActiveViewId(saved.id)
      saveUserPreferences(studioId, colWidths, saved.id, (theme ?? 'light') as 'light' | 'dark').catch(console.error)
    } catch (e) { console.error('Failed to create view:', e) }
  }

  async function handleEditView(id: string, name: string, columns: string[]): Promise<void> {
    try {
      const saved = await updateLeadView(id, name, columns)
      setViews(prev => prev.map(v => v.id === id ? { id: saved.id, name: saved.name, columns: saved.columns } : v))
    } catch (e) { console.error('Failed to update view:', e) }
  }

  async function handleDeleteView(id: string): Promise<void> {
    try {
      await deleteLeadView(id)
      setViews(prev => prev.filter(v => v.id !== id))
      if (activeViewId === id) {
        const newViewId = ALL_COLUMNS_VIEW.id
        setActiveViewId(newViewId)
        if (studioId) {
          saveUserPreferences(studioId, colWidths, newViewId, (theme ?? 'light') as 'light' | 'dark').catch(console.error)
        }
      }
    } catch (e) { console.error('Failed to delete view:', e) }
  }

  const getUsageCount = useCallback((field: string, value: string): number => {
    return leads.filter(l => l[field as keyof Lead] === value).length
  }, [leads])

  function openDropdown(e: React.MouseEvent, lead: Lead, field: keyof Lead) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDropdown({ leadId: lead.id, field, anchorRect: rect })
  }

  function renderCell(lead: Lead, field: keyof Lead) {
    const isEditing = editing?.leadId === lead.id && editing?.field === field
    const value = lead[field]

    if (BOOLEAN_FIELDS.includes(field)) {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={() => toggleBoolean(lead, field)}
          className="rounded cursor-pointer flex-shrink-0 accent-[var(--color-accent)]" style={{ width: 15, height: 15, minWidth: 15, minHeight: 15, maxWidth: 15, maxHeight: 15, transition: 'none' }}
        />
      )
    }

    if (ENUM_FIELDS.includes(field as keyof typeof ALL_LEAD_ENUM_FIELDS)) {
      const opts = fieldOptions[field] ?? []
      const optDef = opts.find(o => o.value === value)
      const displayValue = value as string | null
      // Stored DB colors take priority; fall back to STATUS_COLORS defaults
      const badgeColors = displayValue
        ? (optDef?.bg && optDef?.text
            ? { bg: optDef.bg, text: optDef.text }
            : STATUS_COLORS[displayValue] ?? { bg: 'status-bg-default', text: 'status-text-default' })
        : null
      return (
        <span onClick={e => openDropdown(e, lead, field)} className="cursor-pointer block min-h-[20px] overflow-hidden" data-enum-field={field}>
          {displayValue && badgeColors ? (
            <span data-pill className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium max-w-full ${badgeColors.bg} ${badgeColors.text}`}>
              <span className="truncate">{displayValue}</span>
            </span>
          ) : null}
        </span>
      )
    }

    if (field === 'created_at') {
      return <span className="text-sm text-[var(--color-text-body)] block overflow-hidden whitespace-nowrap min-h-[20px]">{value ? formatDateTime(value as string | null, tz) : ''}</span>
    }

    if (DATE_FIELDS.includes(field)) {
      return (
        <span
          onClick={e => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setDatePicker({ leadId: lead.id, field, anchorRect: rect })
          }}
          className="cursor-pointer text-sm text-[var(--color-text-body)] hover:bg-[rgba(55,53,47,0.06)] dark:hover:bg-[rgba(255,255,255,0.06)] rounded px-1 py-0.5 block overflow-hidden whitespace-nowrap min-h-[20px] min-w-[40px]"
        >
          {value
            ? formatDateTime(value as string | null, displayTzForLeadField(field, tz))
            : ''}
        </span>
      )
    }

    if (field === 'name') {
      if (isEditing) {
        return (
          <input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(lead, field)}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(lead, field) }}
            className="text-base md:text-sm rounded px-1 py-0.5 w-full focus:outline-none"
            style={EDIT_INPUT_STYLE}
          />
        )
      }
      const nameStr = String(value ?? '')
      const initials = nameStr.split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
      return (
        <button
          onClick={() => router.push('/leads/' + lead.id)}
          className="flex items-center gap-2 w-full rounded-full px-3 py-1 bg-white dark:bg-[rgba(255,255,255,0.08)] border border-[#e4e4e2] dark:border-[rgba(255,255,255,0.12)] hover:border-[#c8c8c5] dark:hover:border-[rgba(255,255,255,0.22)] shadow-sm hover:shadow-md transition-all text-left cursor-pointer"
        >
          <span className="text-sm text-[var(--color-text-body)] overflow-hidden whitespace-nowrap flex-1">
            {nameStr || '—'}
          </span>
        </button>
      )
    }

    if (field === 'phone' || field === 'email') {
      if (isEditing) {
        return (
          <input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(lead, field)}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(lead, field) }}
            className="text-base md:text-sm rounded px-1 py-0.5 w-full focus:outline-none"
            style={EDIT_INPUT_STYLE}
          />
        )
      }
      const display = field === 'phone' ? formatPhone(value as string | null) : String(value ?? '')
      return (
        <div
          className={`group/cell ${value ? 'flex items-center gap-1' : 'block w-full min-h-[34px] cursor-pointer hover:bg-[rgba(55,53,47,0.06)] dark:hover:bg-[rgba(255,255,255,0.06)] rounded'}`}
          onClick={!value ? () => startEdit(lead, field) : undefined}
        >
          {value ? (
            <>
              <span
                className="text-sm text-[var(--color-text-body)] overflow-hidden whitespace-nowrap flex-1 cursor-pointer"
                onClick={() => startEdit(lead, field)}
              >
                {display}
              </span>
              <CopyButton text={String(value)} />
            </>
          ) : null}
        </div>
      )
    }

    if (field === 'comments') {
      if (isEditing) {
        return (
          <textarea
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit(lead, field)}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }}
            rows={3}
            className="text-base md:text-sm rounded px-1 py-0.5 w-full focus:outline-none resize-none"
            style={EDIT_INPUT_STYLE}
          />
        )
      }
      return (
        <span
          onClick={() => startEdit(lead, field)}
          className={`cursor-pointer text-sm text-[var(--color-text-body)] hover:bg-[rgba(55,53,47,0.06)] dark:hover:bg-[rgba(255,255,255,0.06)] rounded px-1 py-0.5 ${value ? 'line-clamp-1' : 'block min-h-[34px] w-full'}`}
        >
          {value ? String(value) : ''}
        </span>
      )
    }

    if (isEditing) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => commitEdit(lead, field)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(lead, field) }}
          className="text-base md:text-sm rounded px-1 py-0.5 w-full min-w-[80px] focus:outline-none"
          style={EDIT_INPUT_STYLE}
        />
      )
    }

    return (
      <span
        onClick={() => startEdit(lead, field)}
        className={`cursor-pointer text-sm text-[var(--color-text-body)] hover:bg-[rgba(55,53,47,0.06)] dark:hover:bg-[rgba(255,255,255,0.06)] rounded px-1 py-0.5 ${value ? 'line-clamp-1' : 'block min-h-[34px] w-full'}`}
      >
        {value ? String(value) : ''}
      </span>
    )
  }

  const activeView = views.find(v => v.id === activeViewId) ?? views[0]
  const COLUMNS = ALL_COLUMNS.filter(col => activeView.columns.includes(String(col.key)))
  const dropdownLead = dropdown ? leads.find(l => l.id === dropdown.leadId) ?? null : null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showingFrom = total === 0 ? 0 : page * pageSize + 1
  const showingTo = Math.min((page + 1) * pageSize, total)

  if (!mounted) return null

  return (
    <>
    {showConfirmDelete && (
      <ConfirmDeleteModal
        title={`Delete ${selectedIds.size} lead${selectedIds.size !== 1 ? 's' : ''}?`}
        message={`Are you sure you want to delete ${selectedIds.size} lead${selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.`}
        isDeleting={deleting}
        onConfirm={handleDeleteSelected}
        onCancel={() => setShowConfirmDelete(false)}
      />
    )}
    <div className="relative flex flex-col md:h-full px-5 pb-4 gap-3 [font-family:var(--font-inter,Inter,sans-serif)]">
      {/* Header */}
      <div className="flex-shrink-0 space-y-2">
        {/* Toolbar row: filter bar + action button */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <LeadsFilterBar
              onSearchChange={handleDebouncedSearch}
              statusFilter={statusFilter}
              onStatusFilterChange={handleStatusFilterChange}
              levelFilter={levelFilter}
              onLevelFilterChange={handleLevelFilterChange}
              actionFilter={actionFilter}
              onActionFilterChange={handleActionFilterChange}
              sourceFilter={sourceFilter}
              onSourceFilterChange={handleSourceFilterChange}
              reasonFilter={reasonFilter}
              onReasonFilterChange={handleReasonFilterChange}
              fieldOptions={fieldOptions}
              sortField={sortField}
              sortAscending={sortAscending}
              onSortChange={(field, ascending) => { setSortField(field); setSortAscending(ascending); setPage(0) }}
              onRefresh={() => setRefreshKey(k => k + 1)}
            />
          </div>

          {/* Right side — desktop only, inline with toolbar */}
          <div className="hidden md:flex shrink-0 items-center gap-2.5 ml-auto">
            {selectedIds.size > 0 ? (
              <>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={() => setShowConfirmDelete(true)}
                  className="px-3 py-1.5 text-sm font-medium text-white rounded-lg bg-red-600 hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </>
            ) : (
              studioId && (
                <button
                  onClick={() => setShowNewLead(true)}
                  className="px-3 py-1.5 text-sm font-medium text-white rounded-lg transition-colors hover:scale-[1.02]"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
                >
                  + New Lead
                </button>
              )
            )}
          </div>
        </div>

        {/* Mobile-only action row */}
        <div className="flex md:hidden items-center gap-2.5">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                {selectedIds.size} selected
              </span>
              <button
                onClick={() => setShowConfirmDelete(true)}
                className="px-3 py-1.5 text-sm font-medium text-white rounded-lg bg-red-600 hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </>
          ) : (
            studioId && (
              <button
                onClick={() => setShowNewLead(true)}
                className="px-3 py-1.5 text-sm font-medium text-white rounded-lg"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                + New Lead
              </button>
            )
          )}
        </div>

        {/* Views tab strip */}
        <div className="min-w-0 overflow-x-auto">
          <ViewsSelector
            views={views}
            activeViewId={activeViewId}
            onViewChange={v => {
              setActiveViewId(v.id)
              if (studioId) {
                if (prefSaveTimer.current) clearTimeout(prefSaveTimer.current)
                prefSaveTimer.current = setTimeout(() => {
                  saveUserPreferences(studioId, colWidths, v.id, (theme ?? 'light') as 'light' | 'dark').catch(console.error)
                }, 1000)
              }
            }}
            onCreateView={handleCreateView}
            onEditView={handleEditView}
            onDeleteView={handleDeleteView}
          />
        </div>
      </div>

      {/* New leads banner */}
      {newLeadNames.length > 0 && (() => {
        const uNames = [...new Set(newLeadNames.map(e => e.name))]
        const uEmails = [...new Set(newLeadNames.map(e => e.email).filter(Boolean))] as string[]
        return (
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700/50 text-sm">
          <span className="text-blue-800 dark:text-blue-300">
            {uNames.length === 1 ? (
              <>
                A new lead <span className="font-medium">{uNames[0]}</span> was added
                {uEmails.length > 0 ? <> by <span className="font-medium">{uEmails[0]}</span></> : ' by another user'}.
              </>
            ) : (
              <>
                <span className="font-medium">{formatNameList(uNames)}</span> were added
                {uEmails.length > 0 ? <> by <span className="font-medium">{formatNameList(uEmails)}</span></> : ' by other users'}.
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setNewLeadNames([]); setPage(0); setRefreshKey(k => k + 1) }}
              className="px-3 py-1 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={() => setNewLeadNames([])}
              className="p-2.5 md:p-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 transition-colors"
              title="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        )
      })()}

      {/* Leads deleted banner */}
      {deletedLeadNames.length > 0 && (() => {
        const uNames = [...new Set(deletedLeadNames.map(e => e.name))]
        const uEmails = [...new Set(deletedLeadNames.map(e => e.email).filter(Boolean))] as string[]
        return (
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-sm">
          <span className="text-amber-800 dark:text-amber-300">
            {uNames.length === 1 ? (
              <>
                A lead <span className="font-medium">{uNames[0]}</span> was deleted
                {uEmails.length > 0 ? <> by <span className="font-medium">{uEmails[0]}</span></> : ' by another user'}.
              </>
            ) : (
              <>
                <span className="font-medium">{formatNameList(uNames)}</span> were deleted
                {uEmails.length > 0 ? <> by <span className="font-medium">{formatNameList(uEmails)}</span></> : ' by another user'}.
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDeletedLeadNames([])}
              className="p-2.5 md:p-1 text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200 transition-colors"
              title="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        )
      })()}

      {/* Lead updated banner */}
      {updatedLeadNames.length > 0 && (() => {
        const uNames = [...new Set(updatedLeadNames.map(e => e.name))]
        const uEmails = [...new Set(updatedLeadNames.map(e => e.email).filter(Boolean))] as string[]
        return (
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700/50 text-sm">
          <span className="text-green-800 dark:text-green-300">
            {uNames.length === 1 ? (
              <>
                A lead <span className="font-medium">{uNames[0]}</span> was updated
                {uEmails.length > 0 ? <> by <span className="font-medium">{uEmails[0]}</span></> : ' by another user'}.
              </>
            ) : (
              <>
                <span className="font-medium">{formatNameList(uNames)}</span> were updated
                {uEmails.length > 0 ? <> by <span className="font-medium">{formatNameList(uEmails)}</span></> : ' by another user'}.
              </>
            )}
          </span>
          <button
            onClick={() => setUpdatedLeadNames([])}
            className="p-2.5 md:p-1 text-green-500 hover:text-green-700 dark:text-green-400 dark:hover:text-green-200 transition-colors"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
        )
      })()}

      {/* Table card */}
      <div className="relative md:flex-1 md:min-h-0 rounded-xl border border-[#e9e9e7] dark:border-[rgba(255,255,255,0.07)] shadow-sm overflow-hidden">
      <div className="relative md:h-full overflow-x-scroll md:overflow-y-auto bg-white dark:bg-[#191919] no-theme-transition leads-scroll">


        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
            <tr>
              {/* Select-all checkbox */}
              <th className="w-9 pl-3 pr-1 py-2 align-middle border-b border-[#e9e9e7] dark:border-[rgba(255,255,255,0.07)]">
                <Checkbox
                  checked={leads.length > 0 && leads.every(l => selectedIds.has(l.id))}
                  indeterminate={selectedIds.size > 0 && !leads.every(l => selectedIds.has(l.id))}
                  onChange={checked => {
                    if (checked) setSelectedIds(new Set(leads.map(l => l.id)))
                    else setSelectedIds(new Set())
                  }}
                />
              </th>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  style={{ width: colWidths[col.key] ?? DEFAULT_COL_WIDTHS[col.key] ?? 120 }}
                  className="relative text-left text-sm font-normal text-[rgba(55,53,47,0.95)] dark:text-[rgba(255,255,255,0.8)] pl-3 pr-4 py-3 border-b border-r border-[#e9e9e7] dark:border-[rgba(255,255,255,0.06)] overflow-hidden [font-family:var(--font-inter,Inter,sans-serif)]"
                >
                  <span className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
                    {col.icon && <col.icon size={14} className="flex-shrink-0 opacity-60" />}
                    <span className="overflow-hidden whitespace-nowrap">{col.label}</span>
                  </span>
                  <div
                    onMouseDown={e => startResize(e, String(col.key))}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize group/resize"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? null : leads.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-[rgba(55,53,47,0.4)] dark:text-[rgba(255,255,255,0.3)] text-sm">
                  No leads found.
                </td>
              </tr>
            ) : (
              leads.map((lead, i) => (
                <tr
                  key={lead.id}
                  className={`border-b border-[#e9e9e7] dark:border-[rgba(255,255,255,0.06)] transition-colors ${
                    selectedIds.has(lead.id)
                      ? 'bg-[var(--color-accent-subtle)]'
                      : 'bg-[var(--color-bg)] hover:bg-[var(--color-surface)]'
                  }`}
                >
                  {/* Row select checkbox */}
                  <td className="w-9 pl-3 pr-2 py-2 align-middle">
                    <Checkbox
                      checked={selectedIds.has(lead.id)}
                      onChange={checked => {
                        setSelectedIds(prev => {
                          const next = new Set(prev)
                          if (checked) next.add(lead.id)
                          else next.delete(lead.id)
                          return next
                        })
                      }}
                    />
                  </td>
                  {COLUMNS.map(col => (
                    <td key={col.key} className="px-3 py-2 align-middle max-w-0 overflow-hidden border-r border-[#e9e9e7] dark:border-[rgba(255,255,255,0.06)]">
                      {renderCell(lead, col.key)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Spinner />
        </div>
      )}
      </div>

      {/* Pagination footer */}
      <div className="flex-shrink-0 flex flex-col md:flex-row items-center justify-between gap-2 md:gap-0 px-2 py-1 md:py-0.5 text-sm">
        {/* Page size */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Rows per page</span>
          <div className="flex">
            {PAGE_SIZE_OPTIONS.map((size, i) => (
              <button
                key={size}
                onClick={() => handlePageSizeChange(size)}
                className={`px-3 py-1.5 text-sm ${
                  i === 0 ? 'rounded-l-md' : i === PAGE_SIZE_OPTIONS.length - 1 ? 'rounded-r-md' : ''
                }`}
                style={{
                  border: '1px solid var(--color-border)',
                  backgroundColor: pageSize === size ? 'var(--color-accent)' : 'var(--color-bg)',
                  color: pageSize === size ? '#ffffff' : 'var(--color-text-secondary)',
                  borderColor: pageSize === size ? 'var(--color-accent)' : 'var(--color-border)',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  if (pageSize !== size) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  if (pageSize !== size) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                  }
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Page info + nav */}
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {total === 0 ? 'No results' : `${showingFrom.toLocaleString()}–${showingTo.toLocaleString()} of ${total.toLocaleString()}`}
          </span>
          <div className="flex items-center gap-1">
            {[
              { onClick: () => setPage(0), disabled: page === 0 || loading, title: 'First page', Icon: ChevronsLeft },
              { onClick: () => setPage(p => p - 1), disabled: page === 0 || loading, title: 'Previous page', Icon: ChevronLeft },
            ].map(({ onClick, disabled, title, Icon }) => (
              <button
                key={title}
                onClick={onClick}
                disabled={disabled}
                title={title}
                className="p-2.5 md:p-2 rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-bg)',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  if (!disabled) {
                    ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                }}
              >
                <Icon size={16} />
              </button>
            ))}
            <PageInput page={page} totalPages={totalPages} onJump={setPage} />
            {[
              { onClick: () => setPage(p => p + 1), disabled: page >= totalPages - 1 || loading, title: 'Next page', Icon: ChevronRight },
              { onClick: () => setPage(totalPages - 1), disabled: page >= totalPages - 1 || loading, title: 'Last page', Icon: ChevronsRight },
            ].map(({ onClick, disabled, title, Icon }) => (
              <button
                key={title}
                onClick={onClick}
                disabled={disabled}
                title={title}
                className="p-2.5 md:p-2 rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-bg)',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  if (!disabled) {
                    ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
                }}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* New lead modal */}
      {showNewLead && studioId && (
        <NewLeadModal
          studioId={studioId}
          fieldOptions={fieldOptions}
          onBeforeCreate={() => { pendingLocalInserts.current++ }}
          onCreated={lead => {
            // Decrement pending — Realtime may have already arrived and checked this
            pendingLocalInserts.current = Math.max(0, pendingLocalInserts.current - 1)
            // Register ID in case Realtime fires after this point
            localInsertIds.current.add(lead.id)
            setLeads(prev => [lead, ...prev])
            setTotal(t => t + 1)
          }}
          onCreateFailed={() => { pendingLocalInserts.current = Math.max(0, pendingLocalInserts.current - 1) }}
          onClose={() => setShowNewLead(false)}
        />
      )}

      {/* Date picker portal */}
      {datePicker && (() => {
        const lead = leads.find(l => l.id === datePicker.leadId)
        return lead ? (
          <DatePickerPopup
            currentValue={lead[datePicker.field] as string | null}
            anchorRect={datePicker.anchorRect}
            onSelect={iso => commitDateSelect(lead, datePicker.field, iso)}
            onClose={() => setDatePicker(null)}
            tz={displayTzForLeadField(datePicker.field, tz)}
          />
        ) : null
      })()}

      {/* Enum dropdown portal */}
      {dropdown && dropdownLead && (
        <EnumDropdown
          field={String(dropdown.field)}
          currentValue={dropdownLead[dropdown.field] as string | null}
          options={fieldOptions[String(dropdown.field)] ?? []}
          anchorRect={dropdown.anchorRect}
          getUsageCount={value => getUsageCount(String(dropdown.field), value)}
          onSelect={value => {
            // If the clicked lead is part of a multi-selection, apply the value to all selected leads
            if (selectedIds.has(dropdownLead.id) && selectedIds.size > 1) {
              handleBulkUpdate(String(dropdown.field), value)
            } else {
              commitEnumSelect(dropdownLead, dropdown.field, value)
            }
          }}
          onOptionsChange={opts => handleOptionsChange(String(dropdown.field), opts)}
          onOptionAdded={value => handleOptionAdded(String(dropdown.field), value)}
          onOptionRenamed={(oldValue, newValue) => handleOptionRenamed(String(dropdown.field), oldValue, newValue)}
          onOptionDeleted={id => handleOptionDeleted(String(dropdown.field), id)}
          onClose={() => setDropdown(null)}
        />
      )}
    </div>
    </>
  )
}
