'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { NOTION_COLORS } from '@/lib/constants'

interface LeadSourceChartProps {
  bySource: Array<{ source: string; count: number; color: string }>
}

export function LeadSourceChart({ bySource }: LeadSourceChartProps) {
  const data = bySource.filter(d => d.count > 0)
  const total = bySource.reduce((s, d) => s + d.count, 0)
  const emptyData = [{ source: 'No data', count: 1, color: NOTION_COLORS.gray.bg }]

  return (
    <div className="flex flex-col items-center gap-3">
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie
            data={total === 0 ? emptyData : data}
            dataKey="count"
            nameKey="source"
            innerRadius={52}
            outerRadius={75}
            paddingAngle={total === 0 ? 0 : 2}
            stroke="none"
          >
            {(total === 0 ? emptyData : data).map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          {total > 0 && (
            <Tooltip
              separator=""
              formatter={(v) => [`${v} (${Math.round(Number(v) / total * 100)}%)`, '']}
              contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs" style={{ fontSize: 12 }}>
        {bySource.map(d => (
          <div key={d.source} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>{d.source}</span>
            <span className="font-semibold ml-1" style={{ color: 'var(--color-text-primary)' }}>{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
