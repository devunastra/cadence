'use client'

import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { ChartType } from '../kpi-card'
import { formatShortDate } from '@/lib/date-utils'
import { useCurrentStudio } from '@/components/studio-context'

interface VolumeChartProps {
  data: { date: string; count: number }[]
  type: ChartType
}

const BRAND       = '#2383E2'
const BRAND_LIGHT = '#2383E2'

export function VolumeChart({ data, type }: VolumeChartProps) {
  const { currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xFormat = (date: any) => formatShortDate(String(date), tz)
  const chartData = data.length > 0 ? data : [{ date: new Date().toISOString().slice(0, 10), count: 0 }]
  const common = {
    data: chartData,
    margin: { top: 4, right: 4, left: -20, bottom: 0 },
  }
  const axis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
      <XAxis dataKey="date" tickFormatter={xFormat} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
      <YAxis allowDecimals={false} domain={[0, 'auto']} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
      <Tooltip
        formatter={(v) => [v, 'Calls']}
        labelFormatter={xFormat}
        contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
      />
    </>
  )

  const chart = type === 'line' ? (
    <LineChart {...common}>{axis}
      <Line type="monotone" dataKey="count" stroke={BRAND} strokeWidth={2.5} dot={{ r: 4, fill: BRAND, strokeWidth: 0 }} activeDot={{ r: 5, fill: BRAND }} />
    </LineChart>
  ) : type === 'area' ? (
    <AreaChart {...common}>{axis}
      <Area type="monotone" dataKey="count" stroke={BRAND} fill={BRAND_LIGHT} fillOpacity={0.15} strokeWidth={2.5} dot={{ r: 4, fill: BRAND, strokeWidth: 0 }} />
    </AreaChart>
  ) : (
    <BarChart {...common}>{axis}
      <Bar dataKey="count" fill={BRAND} radius={[3, 3, 0, 0]} maxBarSize={32} />
    </BarChart>
  )

  return (
    <div className="absolute inset-0">
      <ResponsiveContainer width="100%" height="100%">
        {chart}
      </ResponsiveContainer>
    </div>
  )
}
