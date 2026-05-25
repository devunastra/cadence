'use client'

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal, Calendar as CalendarIcon } from 'lucide-react'
import { Checkbox } from '@/components/leads/checkbox'
import { SimpleSelect } from '@/components/simple-select'
import { ConfirmDeleteModal } from '@/components/confirm-delete-modal'
import { AppointmentModal } from './appointment-modal'
import { createClient } from '@/lib/supabase/client'
import { fetchAppointmentList, updateAppointmentStatus, deleteAppointment, findLeadsByContactIds } from '@/app/actions'
import { useToast } from '@/components/ui/toast-provider'
import { Spinner } from '@/components/spinner'
import type { Appointment, Lead, Role, StudioSlotConfig } from '@/lib/types'

const STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'showed',    label: 'Showed' },
  { value: 'noshow',    label: 'No Show' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'invalid',   label: 'Invalid' },
]

const STATUS_DISPLAY: Record<string, string> = {
  confirmed: 'Confirmed',
  showed:    'Showed',
  noshow:    'No Show',
  cancelled: 'Cancelled',
  invalid:   'Invalid',
}

const STATUS_CLASSES: Record<string, string> = {
  confirmed: 'status-bg-blue   status-text-blue',
  showed:    'status-bg-green  status-text-green',
  cancelled: 'status-bg-gray   status-text-gray',
  noshow:    'status-bg-red    status-text-red',
  invalid:   'status-bg-gray   status-text-gray',
}

const PAGE_SIZE_OPTIONS = [20, 50, 100]

function formatApptDateTime(iso: string): string {
  const date = new Date(iso.substring(0, 19) + 'Z')
  const dayLabel = date.toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
  })
  const h = parseInt(iso.substring(11, 13), 10)
  const m = parseInt(iso.substring(14, 16), 10)
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  const timeLabel = `${h12}:${String(m).padStart(2, '0')} ${period}`
  return `${dayLabel}, ${timeLabel}`
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

function NavButton({ onClick, disabled, title, children }: { onClick: () => void; disabled: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
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
          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'
        }
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'
        ;(e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'
      }}
    >
      {children}
    </button>
  )
}

export interface AppointmentListPanelProps {
  studioId: string
  userRole: Role
  slotConfig: StudioSlotConfig
  search: string
  statusFilters: string[]
  dateFrom: string
  dateTo: string
  sortField: 'start_time' | 'title' | 'status'
  sortAscending: boolean
  onSelectionChange?: (count: number, onDelete: () => void) => void
}

export function AppointmentListPanel({
  studioId, userRole, slotConfig,
  search, statusFilters, dateFrom, dateTo, sortField, sortAscending,
  onSelectionChange,
}: AppointmentListPanelProps) {
  const router = useRouter()
  const { showError } = useToast()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [isPending, startTransition] = useTransition()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [deletingBulk, setDeletingBulk] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null)
  const [modalAppt, setModalAppt] = useState<Appointment | null>(null)
  const [modalEditing, setModalEditing] = useState(false)
  const [deleteApptId, setDeleteApptId] = useState<string | null>(null)
  const [deletingSingle, setDeletingSingle] = useState(false)
  const [contactLeadMap, setContactLeadMap] = useState<Record<string, Lead>>({})
  const menuRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef(0)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState(search)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showingFrom = total === 0 ? 0 : page * pageSize + 1
  const showingTo = Math.min((page + 1) * pageSize, total)

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [search])

  const loadPage = useCallback((p: number) => {
    startTransition(async () => {
      const result = await fetchAppointmentList(
        studioId,
        { search: debouncedSearch, statusFilters, dateFrom, dateTo },
        sortField,
        sortAscending,
        p + 1,
        pageSize,
      )
      setAppointments(result.appointments)
      setTotal(result.total)
      setPage(p)
      pageRef.current = p
      setSelectedIds(new Set())
      const contactIds = [...new Set(result.appointments.map(a => a.contact_id).filter(Boolean) as string[])]
      if (contactIds.length) {
        findLeadsByContactIds(contactIds, studioId).then(map =>
          setContactLeadMap(prev => ({ ...prev, ...map }))
        )
      }
    })
  }, [studioId, debouncedSearch, statusFilters, dateFrom, dateTo, sortField, sortAscending, pageSize])

  useEffect(() => {
    loadPage(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId, debouncedSearch, statusFilters, dateFrom, dateTo, sortField, sortAscending, pageSize])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`appt-list:${studioId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'appointments',
        filter: `studio_id=eq.${studioId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          loadPage(pageRef.current)
        } else if (payload.eventType === 'UPDATE') {
          const appt = payload.new as Appointment
          if (appt.deleted_at) {
            setAppointments(prev => prev.filter(a => a.id !== appt.id))
            setTotal(t => Math.max(0, t - 1))
            setSelectedIds(prev => { const n = new Set(prev); n.delete(appt.id); return n })
          } else {
            setAppointments(prev => prev.map(a => a.id === appt.id ? appt : a))
            setModalAppt(prev => prev?.id === appt.id ? appt : prev)
          }
        } else if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id: string }).id
          setAppointments(prev => prev.filter(a => a.id !== id))
          setTotal(t => Math.max(0, t - 1))
          setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [studioId, loadPage])

  useEffect(() => {
    if (!menuOpenId) return
    function h(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenId(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpenId])

  useEffect(() => {
    onSelectionChange?.(selectedIds.size, () => setShowBulkDelete(true))
  }, [selectedIds, onSelectionChange])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (selectedIds.size === appointments.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(appointments.map(a => a.id)))
  }

  async function handleBulkDelete() {
    setDeletingBulk(true)
    const ids = [...selectedIds]
    await Promise.all(ids.map(id => deleteAppointment(id)))
    setAppointments(prev => prev.filter(a => !ids.includes(a.id)))
    setTotal(t => Math.max(0, t - ids.length))
    setSelectedIds(new Set())
    setShowBulkDelete(false)
    setDeletingBulk(false)
  }

  async function handleSingleDelete() {
    if (!deleteApptId) return
    setDeletingSingle(true)
    await deleteAppointment(deleteApptId)
    setAppointments(prev => prev.filter(a => a.id !== deleteApptId))
    setTotal(t => Math.max(0, t - 1))
    setSelectedIds(prev => { const n = new Set(prev); n.delete(deleteApptId!); return n })
    setDeleteApptId(null)
    setDeletingSingle(false)
  }

  async function handleStatusChange(apptId: string, newStatus: string) {
    const prevStatus = appointments.find(a => a.id === apptId)?.status ?? null
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: newStatus } : a))
    setModalAppt(prev => prev?.id === apptId ? { ...prev, status: newStatus } : prev)
    const result = await updateAppointmentStatus(
      apptId,
      newStatus as 'confirmed' | 'showed' | 'noshow' | 'cancelled' | 'invalid',
    )
    if (result.error) {
      setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, status: prevStatus } : a))
      setModalAppt(prev => prev?.id === apptId ? { ...prev, status: prevStatus } : prev)
      showError(result.error)
    }
  }

  function openMenu(apptId: string, btnEl: HTMLElement) {
    const rect = btnEl.getBoundingClientRect()
    setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setMenuOpenId(menuOpenId === apptId ? null : apptId)
  }

  const allSelected = appointments.length > 0 && selectedIds.size === appointments.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < appointments.length

  return (
    <div className="flex flex-col md:flex-1 md:min-h-0 gap-3">

      {/* Card — table only (pagination is outside) */}
      <div
        className="relative flex flex-col md:flex-1 md:min-h-0 rounded-2xl md:overflow-hidden"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        {isPending && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ backgroundColor: 'var(--color-bg)' }}>
            <Spinner />
          </div>
        )}

        {/* Scrollable table */}
        <div className="md:flex-1 overflow-x-auto md:overflow-auto md:min-h-0">
          <table className="w-full text-sm">
            <thead
              className="sticky top-0 z-10"
              style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
            >
              <tr>
                <th className="pl-4 pr-2 py-3 w-8 text-left">
                  <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} />
                </th>
                {['Title', 'Contact Name', 'Status', 'Appointment Time'].map(h => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-sm font-normal"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {h}
                  </th>
                ))}
                <th className="w-12 text-left" />
              </tr>
            </thead>
            <tbody>
              {isPending ? null : appointments.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--color-text-muted)' }}>
                      <CalendarIcon size={32} className="opacity-40" />
                      <p className="text-sm">No appointments found</p>
                    </div>
                  </td>
                </tr>
              ) : appointments.map(appt => {
                const isSelected = selectedIds.has(appt.id)
                return (
                  <tr
                    key={appt.id}
                    className="transition-colors"
                    style={{
                      borderTop: '1px solid var(--color-border)',
                      backgroundColor: isSelected ? 'var(--color-accent-subtle)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                  >
                    <td className="pl-4 pr-2 py-3.5">
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(appt.id)} />
                    </td>

                    <td className="px-4 py-3.5 max-w-[220px]">
                      <span className="block truncate text-sm" style={{ color: 'var(--color-text-body)' }}>
                        {appt.title || 'Appointment'}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      {appt.contact_name ? (() => {
                        const lead = appt.contact_id ? contactLeadMap[appt.contact_id] : undefined
                        return lead ? (
                          <button
                            onClick={e => { e.stopPropagation(); router.push(`/leads/${lead.id}`) }}
                            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium transition-all text-left bg-white dark:bg-[rgba(255,255,255,0.08)] border border-[#e4e4e2] dark:border-[rgba(255,255,255,0.12)] shadow-sm hover:border-[#c8c8c5] dark:hover:border-[rgba(255,255,255,0.22)] hover:shadow-md"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {appt.contact_name}
                          </button>
                        ) : (
                          <span
                            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-white dark:bg-[rgba(255,255,255,0.08)] border border-[#e4e4e2] dark:border-[rgba(255,255,255,0.12)] shadow-sm"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {appt.contact_name}
                          </span>
                        )
                      })() : (
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                      <SimpleSelect
                        value={appt.status ?? ''}
                        onChange={v => handleStatusChange(appt.id, v)}
                        options={STATUS_OPTIONS}
                        placeholder="Set status…"
                        clearable={false}
                        minWidth={120}
                      />
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-sm" style={{ color: 'var(--color-text-body)' }}>
                      {formatApptDateTime(appt.start_time)}
                    </td>

                    <td className="pr-3 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={e => openMenu(appt.id, e.currentTarget as HTMLElement)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--color-text-muted)' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>


      {/* Pagination — outside the card, matching leads style */}
      <div className="flex-shrink-0 flex flex-col md:flex-row items-center justify-between gap-2 md:gap-0 px-2 py-1 md:py-0.5 text-sm">
        {/* Page size */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Rows per page</span>
          <div className="flex">
            {PAGE_SIZE_OPTIONS.map((size, i) => (
              <button
                key={size}
                onClick={() => setPageSize(size)}
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
            <NavButton onClick={() => loadPage(0)} disabled={page === 0} title="First page">
              <ChevronsLeft size={16} />
            </NavButton>
            <NavButton onClick={() => loadPage(page - 1)} disabled={page === 0} title="Previous page">
              <ChevronLeft size={16} />
            </NavButton>
            <PageInput page={page} totalPages={totalPages} onJump={loadPage} />
            <NavButton onClick={() => loadPage(page + 1)} disabled={page >= totalPages - 1} title="Next page">
              <ChevronRight size={16} />
            </NavButton>
            <NavButton onClick={() => loadPage(totalPages - 1)} disabled={page >= totalPages - 1} title="Last page">
              <ChevronsRight size={16} />
            </NavButton>
          </div>
        </div>
      </div>

      {/* Three-dot dropdown menu */}
      {menuOpenId && menuAnchor && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-xl py-1 shadow-lg"
          style={{
            top: menuAnchor.top,
            right: menuAnchor.right,
            minWidth: 160,
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
          }}
        >
          {(() => {
            const appt = appointments.find(a => a.id === menuOpenId)
            if (!appt) return null
            return (
              <>
                <button
                  onClick={() => { setModalAppt(appt); setModalEditing(false); setMenuOpenId(null) }}
                  className="w-full text-left px-4 py-2 text-sm transition-colors"
                  style={{ color: 'var(--color-text-body)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  View Details
                </button>
                <button
                  onClick={() => { setModalAppt(appt); setModalEditing(true); setMenuOpenId(null) }}
                  className="w-full text-left px-4 py-2 text-sm transition-colors"
                  style={{ color: 'var(--color-text-body)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  Edit
                </button>
                <button
                  onClick={() => { setDeleteApptId(appt.id); setMenuOpenId(null) }}
                  className="w-full text-left px-4 py-2 text-sm transition-colors"
                  style={{ color: '#dc2626' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(220,38,38,0.08)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  Delete
                </button>
              </>
            )
          })()}
        </div>
      )}

      {/* Bulk delete confirmation */}
      {showBulkDelete && (
        <ConfirmDeleteModal
          title="Delete Appointments?"
          message={`Are you sure you want to delete ${selectedIds.size} appointment(s)? This action cannot be undone.`}
          isDeleting={deletingBulk}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDelete(false)}
        />
      )}

      {/* Single-row delete confirmation */}
      {deleteApptId && (
        <ConfirmDeleteModal
          title="Delete Appointment?"
          message="Are you sure you want to delete this appointment? This action cannot be undone."
          isDeleting={deletingSingle}
          onConfirm={handleSingleDelete}
          onCancel={() => setDeleteApptId(null)}
        />
      )}

      {/* Appointment view / edit modal */}
      {modalAppt && (
        <AppointmentModal
          appointment={modalAppt}
          lead={modalAppt.contact_id ? (contactLeadMap[modalAppt.contact_id] ?? null) : null}
          onClose={() => setModalAppt(null)}
          onDelete={async (id) => {
            await deleteAppointment(id)
            setAppointments(prev => prev.filter(a => a.id !== id))
            setTotal(t => Math.max(0, t - 1))
          }}
          onViewLead={(lead) => { setModalAppt(null); router.push(`/leads/${lead.id}`) }}
          onReschedule={(id, ns, ne, newId) => {
            const effectiveId = newId ?? id
            setAppointments(prev => prev.map(a =>
              a.id === id ? { ...a, id: effectiveId, start_time: ns, end_time: ne } : a
            ))
            setModalAppt(prev => prev ? { ...prev, id: effectiveId, start_time: ns, end_time: ne } : null)
          }}
          onUpdate={(id, changes) => {
            setAppointments(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a))
            setModalAppt(prev => prev?.id === id ? { ...prev, ...changes } : prev)
          }}
          studioId={studioId}
          slotConfig={slotConfig}
          initialEditing={modalEditing}
        />
      )}
    </div>
  )
}
