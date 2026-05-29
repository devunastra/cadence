'use client'

import { useState, useEffect, useRef } from 'react'
import { X, AlertCircle, Copy } from 'lucide-react'
import { SimpleSelect } from '@/components/simple-select'
import type { OnboardingStudioInput } from '@/lib/types'
import { INPUT, LABEL, TIMEZONE_OPTIONS } from './onboarding-types'

interface StepScheduleProps {
  studio: OnboardingStudioInput
  onChange: (patch: Partial<OnboardingStudioInput>) => void
  onTimezoneOverride: () => void
}

const DAY_LABELS: Record<string, string> = {
  '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed',
  '4': 'Thu', '5': 'Fri', '6': 'Sat',
}
const ALL_DAYS = ['0', '1', '2', '3', '4', '5', '6']

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']
const PERIODS = ['AM', 'PM'] as const

function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function formatMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const period = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

function toHHMM(hour: number, minute: string, period: 'AM' | 'PM'): string {
  let h = hour
  if (period === 'AM' && hour === 12) h = 0
  if (period === 'PM' && hour !== 12) h = hour + 12
  return `${String(h).padStart(2, '0')}:${minute}`
}

function formatHour(h: number): string {
  if (h === 0 || h === 24) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

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
  const active = 'text-white'
  const inactive = 'hover:bg-[var(--color-surface)]'

  const hourColRef = useRef<HTMLDivElement>(null)
  const minuteColRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const col = hourColRef.current
    if (!col) return
    const idx = HOURS.indexOf(hour)
    if (idx >= 0) col.scrollTop = idx * 36
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

export function StepSchedule({ studio, onChange, onTimezoneOverride }: StepScheduleProps) {
  const slots = studio.appointment_slots
  const duration = studio.appointment_duration_minutes
  const calStart = studio.calendar_start_hour
  const calEnd = studio.calendar_end_hour

  const [selectedDay, setSelectedDay] = useState('2')
  const [pickHour, setPickHour] = useState(9)
  const [pickMinute, setPickMinute] = useState('00')
  const [pickPeriod, setPickPeriod] = useState<'AM' | 'PM'>('AM')
  const [addError, setAddError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)

  function setSlots(next: Record<string, string[]>) {
    onChange({ appointment_slots: next })
  }

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
    setSlots({ ...slots, [selectedDay]: sorted })
  }

  function removeSlot(day: string, time: string) {
    setSlots({ ...slots, [day]: (slots[day] ?? []).filter(t => t !== time) })
  }

  function copyToDay(targetDay: string) {
    setSlots({ ...slots, [targetDay]: [...(slots[selectedDay] ?? [])] })
    setCopying(false)
  }

  function handleCalHoursChange(newStart: number, newEnd: number) {
    // Prune slots that fall outside the new range so they never persist invalid.
    const pruned = Object.fromEntries(
      ALL_DAYS.map(d => [d, (slots[d] ?? []).filter(t => {
        const h = Math.floor(parseMinutes(t) / 60)
        return h >= newStart && h < newEnd
      })]),
    )
    onChange({ calendar_start_hour: newStart, calendar_end_hour: newEnd, appointment_slots: pruned })
  }

  const daySlots = slots[selectedDay] ?? []
  const CARD = 'rounded-xl px-5 py-4 shadow-sm'

  return (
    <div className="space-y-4">
      {/* Timezone */}
      <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Timezone</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Used for booking and displaying appointment times. We&apos;ve suggested one based on your studio&apos;s state.
        </p>
        <div className="max-w-xs">
          <SimpleSelect
            value={studio.timezone}
            onChange={v => { if (v) { onTimezoneOverride(); onChange({ timezone: v }) } }}
            options={TIMEZONE_OPTIONS}
            clearable={false}
            fullWidth
            triggerBg="var(--color-bg)"
            triggerClassName="py-2"
          />
        </div>
      </div>

      {/* Appointment Duration */}
      <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Appointment Duration</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>How long each booked appointment lasts.</p>
        <label className={LABEL}>Duration (minutes)</label>
        <input
          type="number"
          min={5}
          max={480}
          step={5}
          value={duration}
          onChange={e => onChange({ appointment_duration_minutes: Number(e.target.value) })}
          className={`${INPUT} max-w-[120px]`}
        />
      </div>

      {/* Minimum Advance Notice */}
      <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Minimum Advance Notice</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>How far ahead appointments must be booked.</p>
        <label className={LABEL}>Notice period (days)</label>
        <input
          type="number"
          min={1}
          value={studio.appointment_min_advance_weeks}
          onChange={e => onChange({ appointment_min_advance_weeks: Number(e.target.value) })}
          className={`${INPUT} max-w-[120px]`}
        />
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
          1 = appointments can be booked from tomorrow onwards.
        </p>
      </div>

      {/* Calendar View Hours */}
      <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Calendar View Hours</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Controls how many hours are visible on the calendar grid. Slots outside this range cannot be added.
        </p>
        <div className="grid grid-cols-2 gap-4 max-w-xs">
          <div>
            <label className={LABEL}>Start hour</label>
            <SimpleSelect
              value={String(calStart)}
              onChange={v => handleCalHoursChange(Number(v), calEnd)}
              options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: formatHour(i) }))}
              clearable={false}
              fullWidth
            />
          </div>
          <div>
            <label className={LABEL}>End hour</label>
            <SimpleSelect
              value={String(calEnd)}
              onChange={v => handleCalHoursChange(calStart, Number(v))}
              options={Array.from({ length: 24 }, (_, i) => ({ value: String(i + 1), label: formatHour(i + 1) }))}
              clearable={false}
              fullWidth
            />
          </div>
        </div>
      </div>

      {/* Available Time Slots */}
      <div className={CARD} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Available Time Slots</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Set which times are bookable for each day of the week. You can refine these later in Settings.
        </p>

        {/* Day tabs */}
        <div className="flex rounded-lg overflow-x-auto mb-4" style={{ border: '1px solid var(--color-border)' }}>
          {ALL_DAYS.map(d => (
            <button
              key={d}
              type="button"
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
              {(slots[d]?.length ?? 0) > 0 && (
                <span className="block text-[10px] font-semibold" style={{ color: selectedDay === d ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}>
                  {slots[d].length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-start">
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
                type="button"
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

          <div className="hidden md:block w-px self-stretch flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />

          <div className="flex-1 min-w-0">
            <p className={LABEL}>
              {DAY_LABELS[selectedDay]} — {daySlots.length === 0 ? 'no slots' : `${daySlots.length} slot${daySlots.length === 1 ? '' : 's'}`}
            </p>
            <div className="hidden md:block space-y-1.5 min-h-[40px]">
              {daySlots.length === 0 ? (
                <p className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>No slots added yet.</p>
              ) : (
                daySlots.map(time => {
                  const startMin = parseMinutes(time)
                  const endMin = startMin + duration
                  return (
                    <div key={time} className="flex items-center justify-between px-3 py-2 rounded-lg group" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                      <span className="text-sm tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                        {formatMinutes(startMin)}
                        <span className="mx-1" style={{ color: 'var(--color-text-muted)' }}>–</span>
                        {formatMinutes(endMin)}
                      </span>
                      <button
                        type="button"
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
                  const endMin = startMin + duration
                  return (
                    <div key={time} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg whitespace-nowrap flex-shrink-0" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                        {formatMinutes(startMin)}
                        <span className="mx-0.5" style={{ color: 'var(--color-text-muted)' }}>–</span>
                        {formatMinutes(endMin)}
                      </span>
                      <button
                        type="button"
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
                    type="button"
                    onClick={() => setCopying(true)}
                    className="flex items-center gap-1.5 text-xs transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                  >
                    <Copy size={11} />
                    Copy {DAY_LABELS[selectedDay]}&apos;s slots to another day
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Copy to:</span>
                    {ALL_DAYS.filter(d => d !== selectedDay).map(d => (
                      <button
                        key={d}
                        type="button"
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
                      type="button"
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
      </div>
    </div>
  )
}
