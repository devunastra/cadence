'use client'

import { useState, useEffect } from 'react'
import { Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { deleteActivityLog } from '@/app/actions'
import { STATUS_COLORS } from '@/lib/constants'
import { useCurrentStudio } from '@/components/studio-context'
import type { Role } from '@/lib/types'

interface LogEntry {
  id: string
  lead_name: string | null
  actor_email: string | null
  event_type: string | null
  created_at: string
}

interface ActivityLogTableProps {
  initialLogs: LogEntry[]
  studioId: string
  role: Role
}

const PAGE_SIZE_OPTIONS = [10, 20, 50]

function formatDateTime(iso: string, tz: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: tz,
  })
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
        {/* Rows per page */}
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
                onMouseEnter={e => {
                  if (size !== pageSize) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
                }}
                onMouseLeave={e => {
                  if (size !== pageSize) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Page controls */}
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
            <col className="w-48" />
            <col />
            <col className="w-24" />
            <col className="w-44" />
            {isOwner && <col className="w-14" />}
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <th className="text-left pl-3 pr-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Lead</th>
              <th className="text-left pl-3 pr-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>User</th>
              <th className="text-left pl-3 pr-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Type</th>
              <th className="text-left pl-3 pr-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Date</th>
              {isOwner && <th className="py-3" />}
            </tr>
          </thead>
          <tbody>
            {pagedLogs.map(log => {
              const typeLabel = { create: 'Create', update: 'Update', delete: 'Delete' }[log.event_type ?? ''] ?? log.event_type ?? '—'
              const colors = STATUS_COLORS[typeLabel] ?? { bg: 'status-bg-default', text: 'status-text-default' }
              return (
                <tr
                  key={log.id}
                  style={{ borderTop: '1px solid var(--color-border)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  <td className="px-3 py-3 align-middle whitespace-nowrap overflow-hidden text-ellipsis" title={log.lead_name ?? undefined}>
                    <span className="text-sm font-medium text-[#37352f] dark:text-[rgba(255,255,255,0.85)]">{log.lead_name ?? '—'}</span>
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap">
                    <span className="text-sm" style={{ color: 'var(--color-text-body)' }}>{log.actor_email ?? '—'}</span>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium ${colors.bg} ${colors.text}`}>
                      {typeLabel}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-middle whitespace-nowrap">
                    <span className="text-sm" style={{ color: 'var(--color-text-body)' }}>{formatDateTime(log.created_at, tz)}</span>
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
