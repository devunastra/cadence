'use client'

import { useState, useEffect } from 'react'
import { Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { deleteActivityLog } from '@/app/actions'
import { useCurrentStudio } from '@/components/studio-context'
import { displayTzForLeadField } from '@/lib/date-utils'
import type { Role } from '@/lib/types'

interface LogEntry {
  id: string
  lead_id: string | null
  lead_name: string | null
  actor_email: string | null
  event_type: string | null
  changes: { field: string; old_value: unknown; new_value: unknown }[] | null
  source: string | null
  created_at: string
}

interface ActivityLogTableProps {
  initialLogs: LogEntry[]
  studioId: string
  role: Role
}

const PAGE_SIZE_OPTIONS = [10, 20, 50]

const FIELD_LABELS: Record<string, string> = {
  status: 'Status', level: 'Level', action: 'Action', source: 'Source',
  reason: 'Reason', partnership: 'Partnership', name: 'Name', phone: 'Phone',
  email: 'Email', comments: 'Comments', available: 'Availability',
  showed: 'Showed', bought: 'Bought', old: 'Old', texted: 'Texted',
  last_contacted: 'Last Contacted', first_lesson: 'First Lesson',
  start_time: 'Time', title: 'Title', notes: 'Notes',
}

const FREE_TEXT_FIELDS = new Set(['comments', 'available', 'notes'])
const DATE_FIELDS = new Set(['last_contacted', 'first_lesson'])

function formatValue(field: string, value: unknown, tz: string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (DATE_FIELDS.has(field) && typeof value === 'string') {
    return new Date(value).toLocaleString('en-US', {
      timeZone: displayTzForLeadField(field, tz), month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  }
  return String(value)
}

function describeChange(c: { field: string; old_value: unknown; new_value: unknown }, tz: string): string {
  const label = FIELD_LABELS[c.field] ?? c.field
  const hasOld = c.old_value !== null && c.old_value !== '' && c.old_value !== undefined
  const hasNew = c.new_value !== null && c.new_value !== '' && c.new_value !== undefined

  if (FREE_TEXT_FIELDS.has(c.field)) {
    if (!hasOld && hasNew) return `Added ${label}`
    if (hasOld && !hasNew) return `Cleared ${label}`
    return `Updated ${label}`
  }

  if (!hasOld && hasNew) return `Set ${label} to ${formatValue(c.field, c.new_value, tz)}`
  if (hasOld && !hasNew) return `Cleared ${label}`
  return `Changed ${label} from ${formatValue(c.field, c.old_value, tz)} to ${formatValue(c.field, c.new_value, tz)}`
}

function formatActivity(log: LogEntry, tz: string): string {
  const { event_type, changes, source } = log
  switch (event_type) {
    case 'create':
      return 'Created lead'
    case 'delete':
      return 'Deleted lead'
    case 'update': {
      if (!changes || changes.length === 0) return 'Updated lead'
      if (changes.length === 1) return describeChange(changes[0], tz)
      return changes.map(c => describeChange(c, tz)).join(' · ')
    }
    case 'appointment_created':
      return source === 'ghl' ? 'Appointment booked via AI / GHL' : 'Booked appointment'
    case 'appointment_rescheduled':
      return 'Appointment rescheduled'
    case 'appointment_deleted':
      return 'Appointment cancelled'
    case 'appointment_updated':
      return 'Appointment updated'
    default:
      return event_type ?? '—'
  }
}

function formatDateTime(iso: string, tz: string) {
  const date = new Date(iso)
  const now = new Date()

  const toDay = (d: Date) => d.toLocaleDateString('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const time = date.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })

  const dayDiff = Math.floor((new Date(toDay(now)).getTime() - new Date(toDay(date)).getTime()) / 86400000)

  if (dayDiff === 0) return `Today at ${time}`
  if (dayDiff === 1) return `Yesterday at ${time}`

  const sameYear = date.getFullYear() === now.getFullYear()
  const dateLabel = date.toLocaleDateString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return `${dateLabel} at ${time}`
}

function PageInput({ page, totalPages, onJump }: { page: number; totalPages: number; onJump: (p: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const digits = Math.max(String(totalPages).length, 1)

  function commit() {
    const n = parseInt(value, 10)
    if (!isNaN(n) && n >= 1 && n <= totalPages && n !== page) onJump(n)
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
      onClick={() => { if (!editing) { setValue(String(page)); setEditing(true) } }}
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
        <span style={{ display: 'inline-block', width: `${digits}ch`, textAlign: 'center' }}>{page}</span>
      )}
      <span style={{ color: 'var(--color-text-muted)' }}>/ {totalPages}</span>
    </div>
  )
}

export function ActivityLogTable({ initialLogs, studioId, role }: ActivityLogTableProps) {
  const { currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const isOwner = role === 'studio_owner' || role === 'super_admin'

  const totalPages = Math.max(1, Math.ceil(logs.length / pageSize))
  const pagedLogs = logs.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) supabase.realtime.setAuth(session.access_token)
      })
      channel = supabase
        .channel(`activity-logs-${studioId}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `studio_id=eq.${studioId}` },
          (payload) => {
            const entry = payload.new as LogEntry
            setLogs(prev => [entry, ...prev])
            setPage(1)
          }
        )
        .subscribe()
    })

    return () => { cancelled = true; if (channel) supabase.removeChannel(channel) }
  }, [studioId])

  async function handleDelete(id: string) {
    setDeleting(id)
    setLogs(prev => {
      const next = prev.filter(l => l.id !== id)
      const newTotal = Math.max(1, Math.ceil(next.length / pageSize))
      if (page > newTotal) setPage(newTotal)
      return next
    })
    try {
      await deleteActivityLog(id)
    } catch {
      setLogs(prev => {
        const entry = initialLogs.find(l => l.id === id)
        if (!entry) return prev
        return [entry, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at))
      })
    } finally {
      setDeleting(null)
    }
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setPage(1)
  }

  if (logs.length === 0) {
    return (
      <div className="rounded-xl px-6 py-12 text-center" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No activity recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Pagination bar — above the table */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-2 md:gap-0 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Rows per page</span>
          <div className="flex items-center rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {PAGE_SIZE_OPTIONS.map(size => (
              <button
                key={size}
                onClick={() => handlePageSizeChange(size)}
                className="px-4 h-8 text-sm font-medium transition-colors"
                style={{
                  borderRight: '1px solid var(--color-border)',
                  backgroundColor: size === pageSize ? 'var(--color-accent)' : 'transparent',
                  color: size === pageSize ? '#ffffff' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { if (size !== pageSize) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
                onMouseLeave={e => { if (size !== pageSize) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, logs.length)} of {logs.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            {([
              { onClick: () => setPage(1), disabled: page === 1, title: 'First page', Icon: ChevronsLeft },
              { onClick: () => setPage(p => Math.max(1, p - 1)), disabled: page === 1, title: 'Previous page', Icon: ChevronLeft },
            ] as const).map((btn, i) => (
              <button
                key={i}
                onClick={btn.onClick}
                disabled={btn.disabled}
                title={btn.title}
                className="p-2.5 md:p-2 rounded-md disabled:opacity-30 disabled:pointer-events-none transition-colors"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
              >
                <btn.Icon size={16} />
              </button>
            ))}
            <PageInput page={page} totalPages={totalPages} onJump={setPage} />
            {([
              { onClick: () => setPage(p => Math.min(totalPages, p + 1)), disabled: page === totalPages, title: 'Next page', Icon: ChevronRight },
              { onClick: () => setPage(totalPages), disabled: page === totalPages, title: 'Last page', Icon: ChevronsRight },
            ] as const).map((btn, i) => (
              <button
                key={i}
                onClick={btn.onClick}
                disabled={btn.disabled}
                title={btn.title}
                className="p-2.5 md:p-2 rounded-md disabled:opacity-30 disabled:pointer-events-none transition-colors"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
              >
                <btn.Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-x-auto" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm min-w-[640px] table-fixed">
          <colgroup>
            <col className="w-40" />
            <col />
            <col className="w-44" />
            <col className="w-44" />
            {isOwner && <col className="w-14" />}
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <th className="text-left pl-3 pr-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Lead / Contact</th>
              <th className="text-left pl-3 pr-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Activity</th>
              <th className="text-left pl-3 pr-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>User</th>
              <th className="text-left pl-3 pr-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Date</th>
              {isOwner && <th className="py-3" />}
            </tr>
          </thead>
          <tbody>
            {pagedLogs.map(log => {
              const activity = formatActivity(log, tz)
              const actorLabel = log.actor_email ?? (log.source === 'ghl' ? 'via GHL / AI' : log.source === 'notion' ? 'via Notion' : '—')
              return (
                <tr
                  key={log.id}
                  style={{ borderTop: '1px solid var(--color-border)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  <td className="px-3 py-3 align-middle whitespace-nowrap overflow-hidden text-ellipsis" title={log.lead_name ?? undefined}>
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {log.lead_name ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{activity}</span>
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap overflow-hidden text-ellipsis">
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{actorLabel}</span>
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap">
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{formatDateTime(log.created_at, tz)}</span>
                  </td>
                  {isOwner && (
                    <td className="py-3 align-middle text-center">
                      <button
                        onClick={() => handleDelete(log.id)}
                        disabled={deleting === log.id}
                        className="p-1 transition-colors disabled:opacity-40"
                        style={{ color: '#dc2626' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#b91c1c'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#dc2626'}
                        title="Delete log entry"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
