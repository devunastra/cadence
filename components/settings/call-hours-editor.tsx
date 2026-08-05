'use client'

import { useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { SimpleSelect } from '@/components/simple-select'
import {
  DAY_LABELS,
  emptyCallHours,
  formatCallHoursSummary,
  formatHHMM,
  parseHHMM,
  toHHMM,
  windowMinutes,
  type CallHours,
  type DayWindow,
} from '@/lib/call-hours'

// Monday-first for display. Storage keys stay 0-indexed from Sunday to match
// studios.appointment_slots, so this is presentation order only.
const DISPLAY_DAYS = ['1', '2', '3', '4', '5', '6', '0']

const FULL_DAY_LABELS: Record<string, string> = {
  '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday',
  '4': 'Thursday', '5': 'Friday', '6': 'Saturday',
}

// 30-minute granularity. The dialer sweep runs every 30 minutes, so finer steps
// here would promise a precision the calls can't actually honour.
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const value = toHHMM(i * 30)
  return { value, label: formatHHMM(value) }
})

const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'

interface CallHoursEditorProps {
  value: CallHours | null
  onChange: (next: CallHours | null) => void
  /** Studio IANA timezone — shown so nobody has to guess whose clock these are. */
  timezone: string
}

export function CallHoursEditor({ value, onChange, timezone }: CallHoursEditorProps) {
  const restricted = value !== null

  // A day whose close <= open can only be reached mid-edit (the DB normalizer
  // fails it closed on save). Surfacing it inline stops a silent "we saved it as
  // closed" surprise after the fact.
  const invalidDays = useMemo(() => {
    if (!value) return []
    return DISPLAY_DAYS.filter(d => {
      const win = value[d]
      return win !== null && win !== undefined && windowMinutes(win) === null
    })
  }, [value])

  function setDay(day: string, win: DayWindow) {
    onChange({ ...(value ?? emptyCallHours()), [day]: win })
  }

  function toggleRestricted(on: boolean) {
    if (!on) { onChange(null); return }
    // Opening the editor from "any time" starts at a sane default rather than
    // seven closed days, which would silently mean "never call" if saved as-is.
    onChange(Object.fromEntries(
      DISPLAY_DAYS.map(d => [d, { open: '09:00', close: '20:00' }]),
    ) as CallHours)
  }

  function copyToAllDays(day: string) {
    const win = value?.[day] ?? null
    onChange(Object.fromEntries(DISPLAY_DAYS.map(d => [d, win ? { ...win } : null])) as CallHours)
  }

  return (
    <div className="px-6 py-5 space-y-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          AI Calling Hours
        </h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          When the AI voice agent is allowed to place outbound calls, in this studio&apos;s
          local time ({timezone}). Leads that come in outside these hours aren&apos;t dropped —
          they&apos;re queued and called at the next opening.
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Inbound calls are answered around the clock and aren&apos;t affected by this setting.
        </p>
      </div>

      {/* Master switch — off means the column is NULL, i.e. no restriction. */}
      <div
        className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Restrict calling hours
          </p>
          <p className="text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {restricted
              ? formatCallHoursSummary(value)
              : 'The agent may call at any hour, any day.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={restricted}
          aria-label="Restrict calling hours"
          onClick={() => toggleRestricted(!restricted)}
          className="relative flex-shrink-0 rounded-full transition-colors"
          style={{
            width: 44,
            height: 26,
            backgroundColor: restricted ? 'var(--color-accent)' : 'var(--color-border-strong)',
            transition: 'background-color var(--transition-base)',
          }}
        >
          <span
            className="absolute rounded-full bg-white"
            style={{
              width: 20, height: 20, top: 3,
              left: restricted ? 21 : 3,
              transition: 'left var(--transition-base)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
            }}
          />
        </button>
      </div>

      {restricted && (
        <div className="space-y-2">
          {DISPLAY_DAYS.map(day => {
            const win = value?.[day] ?? null
            const open = win !== null
            const invalid = invalidDays.includes(day)

            return (
              <div
                key={day}
                className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-3 py-2.5 rounded-lg"
                style={{ border: `1px solid ${invalid ? 'rgba(220,38,38,0.4)' : 'var(--color-border)'}` }}
              >
                {/* Day + open/closed toggle */}
                <div className="flex items-center gap-3 md:w-44 flex-shrink-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={open}
                    aria-label={`${FULL_DAY_LABELS[day]} calling enabled`}
                    onClick={() => setDay(day, open ? null : { open: '09:00', close: '20:00' })}
                    className="relative flex-shrink-0 rounded-full"
                    style={{
                      width: 36, height: 21,
                      backgroundColor: open ? 'var(--color-accent)' : 'var(--color-border-strong)',
                      transition: 'background-color var(--transition-base)',
                    }}
                  >
                    <span
                      className="absolute rounded-full bg-white"
                      style={{
                        width: 15, height: 15, top: 3,
                        left: open ? 18 : 3,
                        transition: 'left var(--transition-base)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                      }}
                    />
                  </button>
                  <span
                    className="text-sm font-medium"
                    style={{ color: open ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
                  >
                    <span className="md:hidden">{FULL_DAY_LABELS[day]}</span>
                    <span className="hidden md:inline">{DAY_LABELS[day]}</span>
                  </span>
                </div>

                {open ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <SimpleSelect
                        value={win!.open}
                        onChange={v => { if (v) setDay(day, { ...win!, open: v }) }}
                        options={TIME_OPTIONS}
                        clearable={false}
                        fullWidth
                        triggerBg="var(--color-bg)"
                        triggerClassName="py-2"
                      />
                    </div>
                    <span className="text-sm flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>to</span>
                    <div className="flex-1 min-w-0">
                      <SimpleSelect
                        value={win!.close}
                        onChange={v => { if (v) setDay(day, { ...win!, close: v }) }}
                        options={TIME_OPTIONS}
                        clearable={false}
                        fullWidth
                        triggerBg="var(--color-bg)"
                        triggerClassName="py-2"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToAllDays(day)}
                      title={`Apply ${FULL_DAY_LABELS[day]}'s hours to every day`}
                      className="flex-shrink-0 px-2.5 py-2 md:py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
                      style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                    >
                      Copy to all
                    </button>
                  </div>
                ) : (
                  <span className="text-sm flex-1" style={{ color: 'var(--color-text-muted)' }}>
                    No calls
                  </span>
                )}
              </div>
            )
          })}

          {invalidDays.length > 0 && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span className="leading-snug">
                {invalidDays.map(d => FULL_DAY_LABELS[d]).join(', ')}
                {invalidDays.length === 1 ? ' has an' : ' have an'} end time at or before its start time.
                Saving now would turn {invalidDays.length === 1 ? 'that day' : 'those days'} off.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** True when every enabled day has a usable window — gates the Save button. */
export function callHoursAreValid(value: CallHours | null): boolean {
  if (!value) return true
  return DISPLAY_DAYS.every(d => {
    const win = value[d]
    if (win === null || win === undefined) return true
    return windowMinutes(win) !== null
  })
}

/** Exported for tests — the parse helper the editor relies on for ordering. */
export { parseHHMM }
