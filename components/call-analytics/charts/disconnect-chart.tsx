'use client'

import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import type { ChartType } from '../kpi-card'
import { NOTION_COLORS } from '@/lib/constants'

interface DisconnectChartProps {
  counts: Record<string, number>
  type: ChartType
}

const REASON_LABELS: Record<string, string> = {
  agent_hangup:   'Agent Ended',
  user_hangup:    'User Ended',
  voicemail:          'Voicemail',
  voicemail_reached:  'Voicemail',
  dial_no_answer: 'No Answer',
  dial_busy:      'Busy',
  call_transfer:  'Transfer',
}

const REASON_COLORS: Record<string, string> = {
  agent_hangup:   NOTION_COLORS.blue.text,
  user_hangup:    NOTION_COLORS.green.text,
  voicemail:          NOTION_COLORS.yellow.text,
  voicemail_reached:  NOTION_COLORS.yellow.text,
  dial_no_answer: NOTION_COLORS.gray.text,
  dial_busy:      NOTION_COLORS.red.text,
  call_transfer:  NOTION_COLORS.purple.text,
}

export function DisconnectChart({ counts, type }: DisconnectChartProps) {
  // All known reasons always shown in legend
  const allData = Object.entries(REASON_LABELS).map(([key, name]) => ({
    name,
    value: counts[key] ?? 0,
    color: REASON_COLORS[key] ?? '#787774',
  }))
  const data = allData.filter(d => d.value > 0)

  const total = allData.reduce((s, d) => s + d.value, 0)

  if (type === 'bar') return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={allData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={40}>
          {allData.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )

  const emptyData = [{ name: 'No data', value: 1, color: NOTION_COLORS.gray.bg }]
  return (
    <div className="flex flex-col items-center gap-3">
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie
            data={total === 0 ? emptyData : data}
            dataKey="value"
            innerRadius={52}
            outerRadius={75}
            paddingAngle={total === 0 ? 0 : 2}
            stroke="none"
          >
            {(total === 0 ? emptyData : data).map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          {total > 0 && <Tooltip separator="" formatter={(v) => [`${v} (${total ? Math.round(Number(v) / total * 100) : 0}%)`, '']} contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />}
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs" style={{ fontSize: 12 }}>
        {allData.map(d => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>{d.name}</span>
            <span className="font-semibold ml-1" style={{ color: 'var(--color-text-primary)' }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
