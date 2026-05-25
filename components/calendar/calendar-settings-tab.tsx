'use client'

import { useState, useEffect, useRef } from 'react'
import { X, AlertCircle, Copy, TriangleAlert } from 'lucide-react'
import { saveCalendarSettings } from '@/app/actions'
import { useToast } from '@/components/ui/toast-provider'
import { SimpleSelect } from '@/components/simple-select'
import type { StudioSlotConfig } from '@/lib/types'

interface CalendarSettingsTabProps {
  studioId: string
  initialConfig: StudioSlotConfig
  calStartHour: number
  calEndHour: number
}

const DAY_LABELS: Record<string, string> = {
  '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed',
  '4': 'Thu', '5': 'Fri', '6': 'Sat',
}
const ALL_DAYS = ['0', '1', '2', '3', '4', '5', '6']

const HOURS   = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']
const PERIODS = ['AM', 'PM'] as const

const INPUT = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]'
const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'

/** Parse "HH:MM" into total minutes since midnight. */
function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Format total minutes since midnight as "H:MM AM/PM". */
function formatMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const period = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

/** Convert picker state → "HH:MM" 24-hour string. */
function toHHMM(hour: number, minute: string, period: 'AM' | 'PM'): string {
  let h = hour
  if (period === 'AM' && hour === 12) h = 0
  if (period === 'PM' && hour !== 12) h = hour + 12
  return `${String(h).padStart(2, '0')}:${minute}`
}

/** Format a 24-hour integer as "11 AM", "9 PM", "12 PM", etc. */
function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// ─── Time Column Picker ───────────────────────────────────────────────────────

interface TimePickerProps {
  hour: number
  minute: string
  period: 'AM' | 'PM'
  onHour: (h: number) => void
  onMinute: (m: string) => void
  onPeriod: (p: 'AM' | 'PM') => void
}

function TimeColumnPicker({ hour, minute, period, onHour, onMinute, onPeriod }: TimePickerProps) {
  const colClass = 'flex-1 md:flex-none flex flex-col gap-0.5 overflow-y-auto max-h-44 pr-1 scrollbar-thin'
  const itemBase = 'px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer select-none transition-colors text-center'
  const active   = 'text-white'
  const inactive = 'hover:bg-[var(--color-surface)]'

  const hourColRef   = useRef<HTMLDivElement>(null)
  const minuteColRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const col = hourColRef.current
    if (!col) return
    const idx = HOURS.indexOf(hour)
    if (idx >= 0) col.scrollTop = idx * 36  // approx item height
  }, [])

  useEffect(() => {
    const col = minuteColRef.current
    if (!col) return
    const idx = MINUTES.indexOf(minute)
    if (idx >= 0) col.scrollTop = idx * 36
  }, [])

  return (
    <div className="flex gap-1 p-2 rounded-xl shadow-sm w-full md:w-fit" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <div className={colClass} ref={hourColRef}>
        {HOURS.map(h => (
          <div
            key={h}
            onClick={() => onHour(h)}
            className={`${itemBase} ${hour === h ? active : inactive}`}
            style={hour === h ? { backgroundColor: 'var(--color-accent)' } : { color: 'var(--color-text-secondary)' }}
          >
            {String(h).padStart(2, '00')}
          </div>
        ))}
      </div>
      <div className={colClass} ref={minuteColRef}>
        {MINUTES.map(m => (
          <div
            key={m}
            onClick={() => onMinute(m)}
            className={`${itemBase} ${minute === m ? active : inactive}`}
            style={minute === m ? { backgroundColor: 'var(--color-accent)' } : { color: 'var(--color-text-secondary)' }}
          >
            {m}
          </div>
        ))}
      </div>
      <div className="flex-1 md:flex-none flex flex-col gap-0.5">
        {PERIODS.map(p => (
          <div
            key={p}
            onClick={() => onPeriod(p)}
            className={`${itemBase} ${period === p ? active : inactive}`}
            style={period === p ? { backgroundColor: 'var(--color-accent)' } : { color: 'var(--color-text-secondary)' }}
          >
            {p}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CalendarSettingsTab({ studioId, initialConfig, calStartHour: initCalStart, calEndHour: initCalEnd }: CalendarSettingsTabProps) {
  const { showError } = useToast()
  const [duration, setDuration]   = useState(initialConfig.appointment_duration_minutes)
  const [advWeeks, setAdvWeeks]   = useState(initialConfig.appointment_min_advance_weeks)
  const [calStart, setCalStart]   = useState(initCalStart)
  const [calEnd, setCalEnd]       = useState(initCalEnd)
  const [slots, setSlots]         = useState<Record<string, string[]>>(
    Object.fromEntries(ALL_DAYS.map(d => [d, initialConfig.appointment_slots[d] ?? []]))
  )
  const [selectedDay, setSelectedDay] = useState('2')

  const initPickPeriod: 'AM' | 'PM' = initCalStart < 12 ? 'AM' : 'PM'
  const initPickHour = initCalStart === 0 ? 12 : initCalStart > 12 ? initCalStart - 12 : initCalStart
  const [pickHour, setPickHour]     = useState(initPickHour)
  const [pickMinute, setPickMinute] = useState('00')
  const [pickPeriod, setPickPeriod] = useState<'AM' | 'PM'>(initPickPeriod)

  const [pendingDuration, setPendingDuration] = useState<number | null>(null)
  const [pendingCalHours, setPendingCalHours] = useState<{ start: number; end: number } | null>(null)

  function slotsOutOfRange(newStart: number, newEnd: number): number {
    return Object.values(slots).reduce((count, times) =>
      count + times.filter(t => {
        const h = Math.floor(parseMinutes(t) / 60)
        return h < newStart || h >= newEnd
      }).length, 0)
  }

  function applyCalHours(newStart: number, newEnd: number) {
    setSlots(prev => Object.fromEntries(
      ALL_DAYS.map(d => [d, (prev[d] ?? []).filter(t => {
        const h = Math.floor(parseMinutes(t) / 60)
        return h >= newStart && h < newEnd
      })])
    ))
    setCalStart(newStart)
    setCalEnd(newEnd)
    setPendingCalHours(null)
  }

  function handleCalHoursChange(newStart: number, newEnd: number) {
    if (slotsOutOfRange(newStart, newEnd) > 0) {
      setPendingCalHours({ start: newStart, end: newEnd })
    } else {
      setCalStart(newStart)
      setCalEnd(newEnd)
    }
  }

  const [addError, setAddError]   = useState<string | null>(null)
  const [copying, setCopying]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)

  function addSlot() {
    setAddError(null)
    const newTime = toHHMM(pickHour, pickMinute, pickPeriod)
    const existing = slots[selectedDay] ?? []

    if (existing.includes(newTime)) {
      setAddError('That time is already in the list.')
      return
    }

    const newStart = parseMinutes(newTime)
    const slotHour = Math.floor(newStart / 60)
    if (slotHour < calStart || slotHour >= calEnd) {
      setAddError(`Slot must be within calendar hours (${formatHour(calStart)} – ${formatHour(calEnd)}).`)
      return
    }

    const newEnd = newStart + duration
    const overlapping = existing.find(t => {
      const s = parseMinutes(t)
      const e = s + duration
      return newStart < e && newEnd > s
    })
    if (overlapping) {
      setAddError(`Overlaps with ${formatMinutes(parseMinutes(overlapping))} – ${formatMinutes(parseMinutes(overlapping) + duration)}.`)
      return
    }

    const sorted = [...existing, newTime].sort((a, b) => parseMinutes(a) - parseMinutes(b))
    setSlots(prev => ({ ...prev, [selectedDay]: sorted }))
  }

  function removeSlot(day: string, time: string) {
    setSlots(prev => ({ ...prev, [day]: prev[day].filter(t => t !== time) }))
  }

  function copyToDay(targetDay: string) {
    setSlots(prev => ({ ...prev, [targetDay]: [...(prev[selectedDay] ?? [])] }))
    setCopying(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)

    const cleanSlots = Object.fromEntries(
      Object.entries(slots).filter(([, times]) => times.length > 0)
    )

    const result = await saveCalendarSettings(
      studioId,
      {
        appointment_duration_minutes:  duration,
        appointment_min_advance_weeks: advWeeks,
        appointment_slots:             cleanSlots,
      },
      calStart,
      calEnd,
    )

    setSaving(false)
    if (result.error) { showError(result.error); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const daySlots = slots[selectedDay] ?? []

  const CARD = 'rounded-xl px-6 py-5 shadow-sm'

  return (
    <div className="flex-1 overflow-y-auto py-2 space-y-4">

        {/* Appointment Duration */}
        <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Appointment Duration</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>How long each booked appointment lasts.</p>
          <label className={LABEL}>Duration (minutes)</label>
          <input
            type="number"
            min={5}
            max={480}
            step={5}
            value={pendingDuration ?? duration}
            onChange={e => {
              const val = Number(e.target.value)
              if (val !== duration) setPendingDuration(val)
              else setPendingDuration(null)
            }}
            className={`${INPUT} max-w-[120px]`}
          />
          <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
            All slots use this duration. e.g. start 2:00 PM + 45 min → 2:00 PM – 2:45 PM.
          </p>
          {pendingDuration !== null && (
            <div className="mt-3 flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
              <TriangleAlert size={15} className="flex-shrink-0 text-amber-500 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Change duration from {duration} to {pendingDuration} min?
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  Existing slot times will remain but end times will shift to match the new duration.
                </p>
                <div className="flex gap-2 mt-2.5">
                  <button
                    onClick={() => { setDuration(pendingDuration); setPendingDuration(null) }}
                    className="px-3 py-1 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setPendingDuration(null)}
                    className="px-3 py-1 text-xs font-medium rounded-lg text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Minimum Advance Notice */}
        <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Minimum Advance Notice</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>How far ahead appointments must be booked.</p>
          <label className={LABEL}>Notice period (days)</label>
          <input
            type="number"
            min={1}
            value={advWeeks}
            onChange={e => setAdvWeeks(Number(e.target.value))}
            className={`${INPUT} max-w-[120px]`}
          />
          <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
            1 = appointments can be booked from tomorrow onwards.
          </p>
        </div>

        {/* Calendar View Hours */}
        <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Calendar View Hours</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            Controls how many hours are visible on the calendar grid. Slots outside this range cannot be added.
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-xs">
            <div>
              <label className={LABEL}>Start hour</label>
              <SimpleSelect
                value={String(pendingCalHours?.start ?? calStart)}
                onChange={v => handleCalHoursChange(Number(v), pendingCalHours?.end ?? calEnd)}
                options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: formatHour(i) }))}
                clearable={false}
                fullWidth
              />
            </div>
            <div>
              <label className={LABEL}>End hour</label>
              <SimpleSelect
                value={String(pendingCalHours?.end ?? calEnd)}
                onChange={v => handleCalHoursChange(pendingCalHours?.start ?? calStart, Number(v))}
                options={Array.from({ length: 24 }, (_, i) => ({ value: String(i + 1), label: formatHour(i + 1) }))}
                clearable={false}
                fullWidth
              />
            </div>
          </div>
          {pendingCalHours !== null && (() => {
            const affected = slotsOutOfRange(pendingCalHours.start, pendingCalHours.end)
            return (
              <div className="mt-3 flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                <TriangleAlert size={15} className="flex-shrink-0 text-amber-500 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Change hours to {formatHour(pendingCalHours.start)} – {formatHour(pendingCalHours.end)}?
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    {affected} available slot{affected === 1 ? '' : 's'} fall outside the new range and will be removed from the booking schedule. Existing calendar appointments are not affected.
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => applyCalHours(pendingCalHours.start, pendingCalHours.end)}
                      className="px-3 py-1 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setPendingCalHours(null)}
                      className="px-3 py-1 text-xs font-medium rounded-lg text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Available Time Slots */}
        <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Available Time Slots</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            Set which times are bookable for each day of the week.
          </p>

          {/* Day tabs */}
          <div className="flex rounded-lg overflow-x-auto mb-4" style={{ border: '1px solid var(--color-border)' }}>
            {ALL_DAYS.map(d => (
              <button
                key={d}
                onClick={() => { setSelectedDay(d); setAddError(null); setCopying(false) }}
                className="flex-1 py-2 text-xs font-medium transition-colors relative border-r last:border-r-0"
                style={{
                  borderRightColor: 'var(--color-border)',
                  backgroundColor: selectedDay === d ? 'var(--color-accent)' : 'var(--color-bg)',
                  color: selectedDay === d ? '#ffffff' : 'var(--color-text-secondary)',
                }}
                onMouseEnter={e => { if (selectedDay !== d) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
                onMouseLeave={e => { if (selectedDay !== d) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)' }}
              >
                {DAY_LABELS[d]}
                {slots[d]?.length > 0 && (
                  <span className="block text-[10px] font-semibold" style={{ color: selectedDay === d ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}>
                    {slots[d].length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Picker + slot list */}
          <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-start">
            {/* Time picker */}
            <div className="flex-shrink-0 w-full md:w-[200px] self-stretch md:self-start">
              <p className={LABEL}>Select time</p>
              <div className="md:w-fit">
                <TimeColumnPicker
                  hour={pickHour}
                  minute={pickMinute}
                  period={pickPeriod}
                  onHour={h => { setPickHour(h); setAddError(null) }}
                  onMinute={m => { setPickMinute(m); setAddError(null) }}
                  onPeriod={p => { setPickPeriod(p); setAddError(null) }}
                />
                <button
                  onClick={addSlot}
                  className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-white transition-colors"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
                >
                  + Add Slot
                </button>
              </div>
              {addError && (
                <div className="flex items-start gap-1 mt-2 text-xs text-red-600 dark:text-red-400 md:max-w-[200px]">
                  <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                  <span className="leading-snug">{addError}</span>
                </div>
              )}
            </div>

            {/* Divider — desktop only */}
            <div className="hidden md:block w-px self-stretch flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />

            {/* Slot list */}
            <div className="flex-1 min-w-0">
              <p className={LABEL}>
                {DAY_LABELS[selectedDay]} — {daySlots.length === 0 ? 'no slots' : `${daySlots.length} slot${daySlots.length === 1 ? '' : 's'}`}
              </p>
              {/* Mobile: horizontal scroll chips — Desktop: vertical list */}
              <div className="hidden md:block space-y-1.5 min-h-[40px]">
                {daySlots.length === 0 ? (
                  <p className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>No slots added yet.</p>
                ) : (
                  daySlots.map(time => {
                    const startMin = parseMinutes(time)
                    const endMin   = startMin + duration
                    return (
                      <div key={time} className="flex items-center justify-between px-3 py-2 rounded-lg group" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                        <span className="text-sm tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                          {formatMinutes(startMin)}
                          <span className="mx-1" style={{ color: 'var(--color-text-muted)' }}>–</span>
                          {formatMinutes(endMin)}
                        </span>
                        <button
                          onClick={() => removeSlot(selectedDay, time)}
                          className="ml-2 transition-colors"
                          style={{ color: 'var(--color-text-muted)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#C4554D'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
              <div className="flex md:hidden overflow-x-auto gap-2 min-h-[40px] pb-1 -mx-1 px-1 max-w-[calc(100vw-4rem)]">
                {daySlots.length === 0 ? (
                  <p className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>No slots added yet.</p>
                ) : (
                  daySlots.map(time => {
                    const startMin = parseMinutes(time)
                    const endMin   = startMin + duration
                    return (
                      <div key={time} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-shrink-0" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                        <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                          {formatMinutes(startMin)}
                          <span className="mx-0.5" style={{ color: 'var(--color-text-muted)' }}>–</span>
                          {formatMinutes(endMin)}
                        </span>
                        <button
                          onClick={() => removeSlot(selectedDay, time)}
                          className="transition-colors"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>

              {daySlots.length > 0 && (
                <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                  {!copying ? (
                    <button
                      onClick={() => setCopying(true)}
                      className="flex items-center gap-1.5 text-xs transition-colors"
                      style={{ color: 'var(--color-text-muted)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                    >
                      <Copy size={11} />
                      Copy {DAY_LABELS[selectedDay]}'s slots to another day
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Copy to:</span>
                      {ALL_DAYS.filter(d => d !== selectedDay).map(d => (
                        <button
                          key={d}
                          onClick={() => copyToDay(d)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                          style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                          onMouseEnter={e => {
                            const el = e.currentTarget as HTMLElement
                            el.style.backgroundColor = 'var(--color-accent)'
                            el.style.color = '#ffffff'
                          }}
                          onMouseLeave={e => {
                            const el = e.currentTarget as HTMLElement
                            el.style.backgroundColor = 'var(--color-surface)'
                            el.style.color = 'var(--color-text-secondary)'
                          }}
                        >
                          {DAY_LABELS[d]}
                        </button>
                      ))}
                      <button
                        onClick={() => setCopying(false)}
                        className="text-xs ml-1 transition-colors"
                        style={{ color: 'var(--color-text-muted)' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="mt-5 pt-4 flex items-center justify-end gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-colors"
              style={{ backgroundColor: 'var(--color-accent)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
            </button>
          </div>
        </div>

    </div>
  )
}
