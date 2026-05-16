'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useMounted } from '@/lib/hooks'
import { Spinner } from '@/components/spinner'
import { fetchCallsAnalytics, saveAnalyticsPreferences, savePageFilters } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { groupCallsByDay } from '@/lib/date-utils'
import { getMockCallAnalytics } from '@/lib/mock-data'
import { NOTION_COLORS } from '@/lib/constants'
import type { CallAnalyticsData, DateRange, DatePreset, Call } from '@/lib/types'
import { formatTotalDuration, getPresetRange } from '@/lib/date-utils'
import { applyTranscriptFilters } from '@/lib/call-filters'
import { ChevronDown, RefreshCw } from 'lucide-react'

import { StatCard } from './stat-card'
import { KpiCard } from './kpi-card'
import { VolumeChart } from './charts/volume-chart'
import { DisconnectChart } from './charts/disconnect-chart'
import { SuccessChart } from './charts/success-chart'
import { SentimentChart } from './charts/sentiment-chart'
import { TranscriptsPanel } from './transcripts-panel'
import { DateRangePickerPopup } from './date-range-picker-popup'
import { TranscriptsFilterBar, TranscriptFilters, DEFAULT_FILTERS } from './transcripts-filter-bar'

const EMPTY_ANALYTICS: CallAnalyticsData = {
  calls: [],
  volumeByDay: [],
  totalCalls: 0,
  totalDurationSeconds: 0,
  appointmentsBooked: 0,
  avgQualityScore: null,
  successRate: 0,
  pickupRate: 0,
  sentimentCounts: {},
  disconnectCounts: {},
  outcomeCounts: {},
}

interface AnalyticsShellProps {
  studioId: string
  initialTab?: 'analytics' | 'transcripts'
}

type Tab = 'analytics' | 'transcripts'

const PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'today',          label: 'Today'          },
  { value: '7d',             label: 'Last 7 Days'    },
  { value: '4w',             label: 'Last 4 Weeks'   },
  { value: '3m',             label: 'Last 3 Months'  },
  { value: 'week-to-date',   label: 'Week to Date'   },
  { value: 'month-to-date',  label: 'Month to Date'  },
  { value: 'year-to-date',   label: 'Year to Date'   },
  { value: 'all',            label: 'All Time'       },
]

const DISCONNECT_LABELS: Record<string, string> = {
  agent_hangup:   'Agent hangup',
  user_hangup:    'User hangup',
  voicemail:      'Voicemail',
  dial_no_answer: 'No answer',
  dial_busy:      'Busy',
  call_transfer:  'Transfer',
}

export function AnalyticsShell({ studioId, initialTab }: AnalyticsShellProps) {
  const defaultRange: DateRange = (() => {
    const { from, to } = getPresetRange('7d' as DatePreset)
    return { from, to, preset: '7d' as DatePreset }
  })()
  const [data,       setData]      = useState<CallAnalyticsData>(EMPTY_ANALYTICS)
  const [range,      setRange]     = useState<DateRange>(defaultRange)
  const [initialLoading, setInitialLoading] = useState(true)
  const [filters,    setFilters]   = useState<TranscriptFilters>({ ...DEFAULT_FILTERS })
  const filterSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeTab,  setActiveTab] = useState<Tab>(initialTab ?? 'analytics')
  const [isPending, startTransition] = useTransition()
  const [spinning,   setSpinning]  = useState(false)
  const [chartKey,   setChartKey]  = useState(0)
  const [transcriptRefreshTrigger, setTranscriptRefreshTrigger] = useState(0)
  const mounted = useMounted()

  // Custom range picker state
  const [datePickerOpen,   setDatePickerOpen]   = useState(false)
  const [datePickerAnchor, setDatePickerAnchor] = useState<DOMRect | null>(null)

  // Fetch initial data on mount — uses mock data for SIT branch
  useEffect(() => {
    const result = getMockCallAnalytics(defaultRange.from.toISOString(), defaultRange.to.toISOString())
    setData(result)
    setInitialLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter save — disabled for mock data branch
  // useEffect(() => { ... }, [studioId, filters])

  function handleFilterChange(newFilters: TranscriptFilters) {
    setFilters(newFilters)
  }

  function applyRange(from: Date, to: Date, preset: DatePreset) {
    const newRange: DateRange = { from, to, preset }
    setRange(newRange)
    const result = getMockCallAnalytics(from.toISOString(), to.toISOString())
    setData(result)
    setChartKey(k => k + 1)
  }

  function handleRefresh() {
    setSpinning(true)
    setTimeout(() => setSpinning(false), 600)
    if (activeTab === 'transcripts') {
      setTranscriptRefreshTrigger(n => n + 1)
      return
    }
    const result = getMockCallAnalytics(range.from.toISOString(), range.to.toISOString())
    setData(result)
    setChartKey(k => k + 1)
  }

  function fmtChicago(d: Date) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })
  }
  const dateRangeLabel = range.preset === 'custom'
    ? `${fmtChicago(range.from)} – ${fmtChicago(range.to)}`
    : PRESET_OPTIONS.find(p => p.value === range.preset)?.label ?? range.preset

  // Apply all filters client-side
  const allCalls = data.calls as Omit<Call, 'transcript'>[]
  const calls = applyTranscriptFilters(allCalls, filters)

  const totalDuration       = calls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0)
  const appointmentsBooked  = calls.filter(c => c.appointment_booked).length
  const qualityCalls        = calls.filter(c => c.quality_score != null)
  const avgQuality          = qualityCalls.length
    ? Math.round(qualityCalls.reduce((s, c) => s + (c.quality_score ?? 0), 0) / qualityCalls.length * 10) / 10
    : null

  const disconnectCounts: Record<string, number> = {}
  const outcomeCounts: Record<string, number> = {}
  const sentimentCounts: Record<string, number> = {}
  for (const c of calls) {
    if (c.disconnected_reason) disconnectCounts[c.disconnected_reason] = (disconnectCounts[c.disconnected_reason] ?? 0) + 1
    if (c.outcome)             outcomeCounts[c.outcome]                = (outcomeCounts[c.outcome]                ?? 0) + 1
    if (c.sentiment)           sentimentCounts[c.sentiment]            = (sentimentCounts[c.sentiment]            ?? 0) + 1
  }
  const disconnectTotal = Object.values(disconnectCounts).reduce((a, b) => a + b, 0)

  const fromStr = range.from.toISOString()
  const toStr   = range.to.toISOString()

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Row 1: Tab strip — stable, never shifts */}
      <div className="flex items-end flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {(['analytics', 'transcripts'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 pb-2.5 pt-2 text-sm font-medium capitalize transition-colors border-b-2"
            style={{
              borderBottomColor: activeTab === tab ? 'var(--color-accent)' : 'transparent',
              color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: activeTab === tab ? 600 : 500,
              marginBottom: -1,
            }}
            onMouseEnter={e => { if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
            onMouseLeave={e => { if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)' }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Row 2: Actions — same for both tabs */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleRefresh}
          title="Refresh analytics"
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

        <TranscriptsFilterBar filters={filters} onChange={handleFilterChange} />

        <button
          onMouseDown={e => {
            e.stopPropagation()
            if (datePickerOpen) { setDatePickerOpen(false) } else {
              setDatePickerAnchor(e.currentTarget.getBoundingClientRect())
              setDatePickerOpen(true)
            }
          }}
          className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors focus:outline-none"
          style={{
            border: '1px solid var(--color-border)',
            boxShadow: datePickerOpen ? '0 0 0 2px var(--color-accent)' : 'none',
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text-secondary)',
            minWidth: 160,
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
        >
          <span>{dateRangeLabel}</span>
          <ChevronDown
            size={14}
            className={`transition-transform ${datePickerOpen ? 'rotate-180' : ''}`}
            style={{ color: 'var(--color-text-muted)' }}
          />
        </button>
      </div>

      {/* GHL-style custom range picker popup */}
      {datePickerOpen && datePickerAnchor && (
        <DateRangePickerPopup
          anchorRect={datePickerAnchor}
          initialFrom={range.from}
          initialTo={range.to}
          onApply={(from, to, preset) => applyRange(from, to, (preset as DatePreset) ?? 'custom')}
          onClose={() => setDatePickerOpen(false)}
        />
      )}

      {/* Analytics tab — scrollable */}
      {activeTab === 'analytics' && (
        <div key={chartKey} className="flex-1 flex flex-col min-h-0">
          {isPending || initialLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pb-5">
              <div className="space-y-5">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Calls"         value={String(calls.length)} />
            <StatCard title="Total Duration"      value={formatTotalDuration(totalDuration)} />
            <StatCard title="Appointments Booked" value={String(appointmentsBooked)} />
            <StatCard
              title="Avg Quality Score"
              value={avgQuality != null ? `${avgQuality}` : '—'}
              sub={avgQuality != null ? 'out of 10' : undefined}
              valueColor={
                avgQuality == null ? undefined :
                avgQuality >= 8   ? NOTION_COLORS.green.text :
                avgQuality >= 6   ? NOTION_COLORS.yellow.text :
                                    NOTION_COLORS.red.text
              }
            />
          </div>

          {/* Volume trend — full width */}
          <KpiCard
            title="Call Volume Trend"
            description="Number of calls per day in the selected date range."
            summary={<>
              <p><span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{calls.length}</span> total calls in the selected range.</p>
              {data.volumeByDay.length > 0 && (
                <p>Busiest day: <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {data.volumeByDay.reduce((a, b) => b.count > a.count ? b : a).date}
                </span> with <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {data.volumeByDay.reduce((a, b) => b.count > a.count ? b : a).count}
                </span> calls.</p>
              )}
            </>}
            availableChartTypes={['line']}
            defaultChartType="line"
          >
            {type => <VolumeChart data={data.volumeByDay} type={type} />}
          </KpiCard>

          {/* Three donut charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <KpiCard
              title="Call Results"
              description="Breakdown of how each call ended — who hung up, voicemail, transferred, or unanswered."
              value={`${calls.length} calls`}
              summary={<>
                {Object.entries(DISCONNECT_LABELS).map(([key, label]) => (
                  <p key={key}>
                    <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{disconnectCounts[key] ?? 0}</span>{' '}
                    {label} ({disconnectTotal ? Math.round((disconnectCounts[key] ?? 0) / disconnectTotal * 100) : 0}%)
                  </p>
                ))}
              </>}
              availableChartTypes={['donut']}
              defaultChartType="donut"
            >
              {type => <DisconnectChart counts={disconnectCounts} type={type} />}
            </KpiCard>

            <KpiCard
              title="Call Successful"
              description="Whether calls achieved their intended goal, based on Retell's call analysis."
              value={`${outcomeCounts['successful'] ?? 0} successful`}
              summary={<>
                <p><span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{outcomeCounts['successful'] ?? 0}</span> successful</p>
                <p><span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{outcomeCounts['unsuccessful'] ?? 0}</span> unsuccessful</p>
              </>}
              availableChartTypes={['donut']}
              defaultChartType="donut"
            >
              {() => <SuccessChart counts={outcomeCounts} />}
            </KpiCard>

            <KpiCard
              title="User Sentiment"
              description="How the caller felt during the conversation, detected by Retell's AI analysis."
              value={`${sentimentCounts['positive'] ?? 0} positive`}
              summary={<>
                <p><span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{sentimentCounts['positive'] ?? 0}</span> positive</p>
                <p><span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{sentimentCounts['neutral'] ?? 0}</span> neutral</p>
                <p><span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{sentimentCounts['negative'] ?? 0}</span> negative</p>
              </>}
              availableChartTypes={['donut']}
              defaultChartType="donut"
            >
              {() => <SentimentChart counts={sentimentCounts} />}
            </KpiCard>
          </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transcripts tab — fills remaining height */}
      {activeTab === 'transcripts' && (
        <div className="flex flex-1 min-h-0">
          <TranscriptsPanel studioId={studioId} from={fromStr} to={toStr} filters={filters} transcriptRefreshTrigger={transcriptRefreshTrigger} />
        </div>
      )}

    </div>
  )
}
