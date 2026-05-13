'use client'

import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { ChartType } from '../kpi-card'
import { formatShortDate } from '@/lib/date-utils'

interface RateChartProps {
  /** Each point: { date: string; rate: number } where rate is 0–1 */
  data: { date: string; rate: number }[]
  type: ChartType
  label: string
  color?: string
}

function pct(v: number) { return `${Math.round(v * 100)}%` }

export function RateChart({ data, type, label, color = '#2383E2' }: RateChartProps) {
  const chartData = data.length > 0 ? data : [{ date: new Date().toISOString().slice(0, 10), rate: 0 }]
  const common = {
    data: chartData,
    margin: { top: 4, right: 4, left: -10, bottom: 0 },
  }
  const axis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
      <XAxis dataKey="date" tickFormatter={d => formatShortDate(d)} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
      <YAxis tickFormatter={pct} domain={[0, 1]} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
      <Tooltip
        formatter={(v) => [pct(Number(v)), label]}
        labelFormatter={(d) => formatShortDate(String(d))}
        contentStyle={{ fontSize: 12, borderRadius: 8 }}
      />
    </>
  )

  if (type === 'area') return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart {...common}>{axis}
        <Area dataKey="rate" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  )

  if (type === 'bar') return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart {...common}>{axis}
        <Bar dataKey="rate" fill={color} radius={[3, 3, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  )

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart {...common}>{axis}
        <Line dataKey="rate" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
