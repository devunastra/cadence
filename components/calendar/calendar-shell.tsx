'use client'

import { useState, useTransition, useEffect, useRef, useCallback } from 'react'
import { useMounted } from '@/lib/hooks'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { deleteAppointment, findLeadsByContactIds, savePageFilters } from '@/app/actions'
import { Spinner } from '@/components/spinner'
import { CalendarGrid } from './calendar-grid'
import { AppointmentModal } from './appointment-modal'
import { CalendarSettingsTab } from './calendar-settings-tab'
import { CreateAppointmentModal } from './create-appointment-modal'
import { AppointmentListFilterBar } from './appointment-list-filter-bar'
import { AppointmentListPanel } from './appointment-list-panel'
import { DatePickerPopup } from '@/components/leads/date-picker-popup'
import type { Appointment, Lead, StudioSlotConfig, Role } from '@/lib/types'
import { chicagoStartOfDay, chicagoEndOfDay } from '@/lib/date-utils'

const STUDIO_TZ = 'America/Chicago'

interface CalendarShellProps {
  studioId: string
  calStartHour: number
  calEndHour: number
  slotConfig: StudioSlotConfig
  userRole: Role
}

function getWeekStart(d: Date): Date {
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: STUDIO_TZ, weekday: 'short' }).format(d)
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName)
  return chicagoStartOfDay(new Date(d.getTime() - dow * 86_400_000))
}

function weekEnd(weekStart: Date): Date {
  return chicagoEndOfDay(new Date(weekStart.getTime() + 6 * 86_400_000))
}

function formatWeekRange(weekStart: Date): string {
  const end        = new Date(weekStart.getTime() + 6 * 86_400_000)
  const fmtMonth   = (d: Date) => d.toLocaleDateString('en-US', { timeZone: STUDIO_TZ, month: 'short' })
  const fmtDay     = (d: Date) => d.toLocaleDateString('en-US', { timeZone: STUDIO_TZ, day: 'numeric' })
  const year       = end.toLocaleDateString('en-US', { timeZone: STUDIO_TZ, year: 'numeric' })
  const startMonth = fmtMonth(weekStart)
  const endMonth   = fmtMonth(end)
  if (startMonth === endMonth) {
    return `${startMonth} ${fmtDay(weekStart)} – ${fmtDay(end)}, ${year}`
  }
  return `${startMonth} ${fmtDay(weekStart)} – ${endMonth} ${fmtDay(end)}, ${year}`
}

function buildContactMap(appts: Appointment[]): string[] {
  return [...new Set(appts.map(a => a.contact_id).filter(Boolean) as string[])]
}


export function CalendarShell({ studioId, calStartHour, calEndHour, slotConfig, userRole }: CalendarShellProps) {
  const router = useRouter()
  const [tab, setTab]                        = useState<'calendar' | 'list' | 'settings'>('calendar')
  const [weekStart, setWeekStart]            = useState<Date>(getWeekStart(new Date()))
  const [appointments, setAppointments]      = useState<Appointment[]>([])
  const [contactLeadMap, setContactLeadMap]  = useState<Record<string, Lead>>({})
  const [selected, setSelected]              = useState<Appointment | null>(null)
  const [isPending, startTransition]         = useTransition()

  // List tab filter state — owned here so filter bar (toolbar) and panel (content) share it
  const [listSearch,        setListSearch]        = useState('')
  const [listStatusFilter,  setListStatusFilter]  = useState<string[]>([])
  const [listDateFrom,      setListDateFrom]      = useState('')
  const [listDateTo,        setListDateTo]        = useState('')
  const [listSortField,     setListSortField]     = useState<'start_time' | 'title' | 'status'>('start_time')
  const [listSortAscending, setListSortAscending] = useState(true)
  const listFilterSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [listRefreshKey,    setListRefreshKey]    = useState(0)
  const [showCreate, setShowCreate]          = useState(false)
  const [spinning,   setSpinning]            = useState(false)
  const [listSelectedCount, setListSelectedCount] = useState(0)
  const listOnDeleteRef = useRef<(() => void) | null>(null)
  const [datePickerOpen,   setDatePickerOpen]   = useState(false)
  const [datePickerAnchor, setDatePickerAnchor] = useState<DOMRect | null>(null)
  const mounted = useMounted()

  // Fetch appointments on mount
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    const ws = weekStart
    const we = weekEnd(ws)
    supabase
      .from('appointments')
      .select('*')
      .eq('studio_id', studioId)
      .is('deleted_at', null)
      .gte('start_time', ws.toISOString())
      .lte('start_time', we.toISOString())
      .order('start_time', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        if (data) setAppointments(data as Appointment[])
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ids = buildContactMap(appointments)
    if (!ids.length) return
    findLeadsByContactIds(ids, studioId).then(setContactLeadMap)
  }, [appointments, studioId])

  // Keep a ref to weekStart so the Realtime handler always sees the current value
  const weekStartRef = useRef(weekStart)
  useEffect(() => { weekStartRef.current = weekStart }, [weekStart])

  // Persist list filter + sort changes to Supabase (debounced 1s)
  useEffect(() => {
    if (!mounted) return
    if (listFilterSaveTimer.current) clearTimeout(listFilterSaveTimer.current)
    listFilterSaveTimer.current = setTimeout(() => {
      savePageFilters(studioId, {
        appointmentList: {
          statusFilters: listStatusFilter,
          dateFrom: listDateFrom,
          dateTo: listDateTo,
          sortField: listSortField,
          sortAscending: listSortAscending,
        },
      }).catch(() => {})
    }, 1000)
    return () => { if (listFilterSaveTimer.current) clearTimeout(listFilterSaveTimer.current) }
  }, [studioId, listStatusFilter, listDateFrom, listDateTo, listSortField, listSortAscending]) // eslint-disable-line react-hooks/exhaustive-deps

  // Direct Supabase client fetch — no Next.js server round-trip
  const fetchAppointments = useCallback(async (ws: Date) => {
    const supabase = createClient()
    const { data } = await supabase
      .from('appointments')
      .select('*')
      .eq('studio_id', studioId)
      .is('deleted_at', null)
      .gte('start_time', ws.toISOString())
      .lte('start_time', weekEnd(ws).toISOString())
      .order('start_time', { ascending: true })
    if (data) setAppointments(data as Appointment[])
  }, [studioId])

  // Supabase Realtime — live appointment updates
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`appointments:${studioId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `studio_id=eq.${studioId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const appt = payload.new as Appointment
            const ws = weekStartRef.current
            const we = weekEnd(ws)
            const apptTime = new Date(appt.start_time).getTime()
            if (apptTime >= ws.getTime() && apptTime <= we.getTime()) {
              setAppointments(prev => {
                if (prev.some(a => a.id === appt.id)) return prev
                return [...prev, appt]
              })
              if (appt.contact_id) {
                findLeadsByContactIds([appt.contact_id], studioId).then(map =>
                  setContactLeadMap(p => ({ ...p, ...map }))
                )
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            const appt = payload.new as Appointment
            if (appt.deleted_at) {
              setAppointments(prev => prev.filter(a => a.id !== appt.id))
              setSelected(prev => prev?.id === appt.id ? null : prev)
            } else {
              setAppointments(prev => prev.map(a => a.id === appt.id ? appt : a))
              setSelected(prev => prev?.id === appt.id ? appt : prev)
            }
          } else if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id
            setAppointments(prev => prev.filter(a => a.id !== id))
            setSelected(prev => prev?.id === id ? null : prev)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [studioId])

  // 30s polling fallback — catches any events Realtime misses
  useEffect(() => {
    const id = setInterval(() => fetchAppointments(weekStartRef.current), 30_000)
    return () => clearInterval(id)
  }, [fetchAppointments])

  function navigateTo(newWeekStart: Date) {
    const ws = getWeekStart(newWeekStart)
    if (ws.getTime() === weekStart.getTime()) return
    setWeekStart(ws)
    startTransition(() => fetchAppointments(ws))
  }

  function prevWeek() { const d = new Date(weekStart); d.setDate(d.getDate() - 7); navigateTo(d) }
  function nextWeek() { const d = new Date(weekStart); d.setDate(d.getDate() + 7); navigateTo(d) }
  function goToday()  { navigateTo(new Date()) }
  function handleRefresh() {
    setSpinning(true)
    setTimeout(() => setSpinning(false), 600)
    startTransition(() => fetchAppointments(weekStart))
  }

  function handleReschedule(id: string, newStart: string, newEnd: string, newId?: string) {
    const effectiveId = newId ?? id
    setAppointments(prev => prev.map(a =>
      a.id === id ? { ...a, id: effectiveId, start_time: newStart, end_time: newEnd } : a
    ))
    setSelected(prev => prev?.id === id ? { ...prev, id: effectiveId, start_time: newStart, end_time: newEnd } : prev)
  }

  function handleAppointmentUpdate(id: string, changes: Partial<Appointment>) {
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, ...changes } : a))
    setSelected(prev => prev?.id === id ? { ...prev, ...changes } : prev)
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Row 1: Tab strip — stable, never shifts */}
      <div className="flex items-end flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {(['calendar', 'list'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 pb-2.5 pt-2 text-sm font-medium border-b-2 transition-colors"
            style={{
              borderBottomColor: tab === t ? 'var(--color-accent)' : 'transparent',
              color: tab === t ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: tab === t ? 600 : 500,
              marginBottom: -1,
            }}
            onMouseEnter={e => { if (tab !== t) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
            onMouseLeave={e => { if (tab !== t) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)' }}
          >
            {t === 'calendar' ? 'Calendar View' : 'Appointment List'}
          </button>
        ))}
        {(userRole === 'studio_owner' || userRole === 'super_admin') && (
          <>
            <span className="self-center mx-1 text-xs select-none" style={{ color: 'var(--color-border-strong)' }}>|</span>
            <button
              onClick={() => setTab('settings')}
              className="flex items-center gap-1.5 px-4 pb-2.5 pt-2 text-sm font-medium border-b-2 transition-colors"
              style={{
                borderBottomColor: tab === 'settings' ? 'var(--color-accent)' : 'transparent',
                color: tab === 'settings' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontWeight: tab === 'settings' ? 600 : 500,
                marginBottom: -1,
              }}
              onMouseEnter={e => { if (tab !== 'settings') (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
              onMouseLeave={e => { if (tab !== 'settings') (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)' }}
            >
              <Settings size={16} />
              Calendar Settings
            </button>
          </>
        )}
      </div>

      {/* Row 2: Actions — context-sensitive, hidden on settings tab */}
      {tab !== 'settings' && (
        <div className="flex items-center gap-2 flex-shrink-0" style={{ height: 34 }}>
          {tab === 'list' ? (
            <AppointmentListFilterBar
              search={listSearch}
              onSearchChange={setListSearch}
              statusFilters={listStatusFilter}
              onStatusFiltersChange={setListStatusFilter}
              dateFrom={listDateFrom}
              onDateFromChange={setListDateFrom}
              dateTo={listDateTo}
              onDateToChange={setListDateTo}
              sortField={listSortField}
              sortAscending={listSortAscending}
              onSortChange={(field, ascending) => {
                setListSortField(field as 'start_time' | 'title' | 'status')
                setListSortAscending(ascending)
              }}
              onRefresh={() => setListRefreshKey(k => k + 1)}
            />
          ) : (
            <>
              <button
                onClick={handleRefresh}
                title="Refresh calendar"
                style={{
                  display: 'flex', alignItems: 'center', padding: '9px 10px',
                  borderRadius: 8, cursor: 'pointer',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-secondary)',
                  transition: 'background var(--transition-fast), color var(--transition-fast)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)' }}
              >
                <RefreshCw size={14} className={spinning ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={goToday}
                disabled={isPending}
                className="px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
              >
                Today
              </button>
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, display: 'flex', alignItems: 'stretch', backgroundColor: 'var(--color-bg)' }}>
                <button
                  onClick={prevWeek}
                  disabled={isPending}
                  className="flex items-center justify-center px-2 py-1.5 disabled:opacity-40 transition-colors"
                  style={{ color: 'var(--color-text-secondary)', borderRadius: '8px 0 0 8px' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={e => { setDatePickerAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()); setDatePickerOpen(true) }}
                  className="flex items-center justify-center px-3 py-1.5 text-sm font-semibold transition-colors rounded-lg"
                  style={{ color: 'var(--color-text-primary)', minWidth: 200, boxShadow: datePickerOpen ? '0 0 0 2px var(--color-accent)' : 'none' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-accent)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)'}
                >
                  {formatWeekRange(weekStart)}
                </button>
                <button
                  onClick={nextWeek}
                  disabled={isPending}
                  className="flex items-center justify-center px-2 py-1.5 disabled:opacity-40 transition-colors"
                  style={{ color: 'var(--color-text-secondary)', borderRadius: '0 8px 8px 0' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
          {tab === 'list' && listSelectedCount > 0 ? (
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                {listSelectedCount} selected
              </span>
              <button
                onClick={() => listOnDeleteRef.current?.()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                style={{ backgroundColor: '#dc2626', transition: 'background var(--transition-fast)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#b91c1c'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#dc2626'}
              >
                <Trash2 size={14} />
                Delete ({listSelectedCount})
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
            >
              <span className="text-base leading-none">+</span>
              New Appointment
            </button>
          )}
        </div>
      )}

      {/* Date picker popup for week nav */}
      {datePickerOpen && datePickerAnchor && (
        <DatePickerPopup
          currentValue={weekStart.toISOString()}
          anchorRect={datePickerAnchor}
          showTime={false}
          onSelect={iso => { if (iso) navigateTo(new Date(iso)) }}
          onClose={() => setDatePickerOpen(false)}
        />
      )}

      {/* Calendar View */}
      {isPending && tab === 'calendar' ? (
        <div className="flex-1 flex items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div style={{ display: tab === 'calendar' ? 'contents' : 'none' }}>
          <CalendarGrid
            weekStart={weekStart}
            appointments={appointments}
            onSelect={setSelected}
            hourStart={calStartHour}
            hourEnd={calEndHour}
          />
        </div>
      )}

      {/* Appointment List View */}
      <div style={{ display: tab === 'list' ? 'contents' : 'none' }}>
        <AppointmentListPanel
          key={listRefreshKey}
          studioId={studioId}
          userRole={userRole}
          slotConfig={slotConfig}
          search={listSearch}
          statusFilters={listStatusFilter}
          dateFrom={listDateFrom}
          dateTo={listDateTo}
          sortField={listSortField}
          sortAscending={listSortAscending}
          onSelectionChange={(count, onDelete) => {
            setListSelectedCount(count)
            listOnDeleteRef.current = onDelete
          }}
        />
      </div>

      {/* Calendar Settings Tab — always mounted */}
      <div style={{ display: tab === 'settings' ? 'contents' : 'none' }}>
        {(userRole === 'studio_owner' || userRole === 'super_admin') && (
          <CalendarSettingsTab
            studioId={studioId}
            initialConfig={slotConfig}
            calStartHour={calStartHour}
            calEndHour={calEndHour}
          />
        )}
      </div>

      {/* Appointment detail modal */}
      {selected && (
        <AppointmentModal
          appointment={selected}
          lead={selected.contact_id ? (contactLeadMap[selected.contact_id] ?? null) : null}
          onClose={() => setSelected(null)}
          onDelete={async (id) => {
            await deleteAppointment(id)
            setAppointments(prev => prev.filter(a => a.id !== id))
            setSelected(null)
          }}
          onViewLead={(lead) => { setSelected(null); router.push(`/leads/${lead.id}`) }}
          onReschedule={(id, ns, ne, newId) => handleReschedule(id, ns, ne, newId)}
          onUpdate={handleAppointmentUpdate}
          studioId={studioId}
          slotConfig={slotConfig}
        />
      )}

      {/* Create appointment modal */}
      {showCreate && (
        <CreateAppointmentModal
          studioId={studioId}
          slotConfig={slotConfig}
          onClose={() => setShowCreate(false)}
          onCreated={(appt) => {
            const ws = weekStartRef.current
            const we = weekEnd(ws)
            const apptTime = new Date(appt.start_time).getTime()
            if (apptTime >= ws.getTime() && apptTime <= we.getTime()) {
              setAppointments(prev => [...prev, appt])
            }
          }}
        />
      )}
    </div>
  )
}
