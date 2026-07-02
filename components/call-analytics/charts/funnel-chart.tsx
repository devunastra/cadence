'use client'

import { NOTION_COLORS } from '@/lib/constants'

interface FunnelChartProps {
  funnel: { created: number; booked: number; showed: number; bought: number }
}

const STAGES: Array<{ key: keyof FunnelChartProps['funnel']; label: string; color: string }> = [
  { key: 'created', label: 'Created', color: NOTION_COLORS.blue.text },
  { key: 'booked',  label: 'Booked',  color: NOTION_COLORS.purple.text },
  { key: 'showed',  label: 'Showed',  color: NOTION_COLORS.yellow.text },
  { key: 'bought',  label: 'Bought',  color: NOTION_COLORS.green.text },
]

export function FunnelChart({ funnel }: FunnelChartProps) {
  const max = Math.max(funnel.created, 1)
  return (
    <div className="flex flex-col justify-center h-full gap-2.5 pt-1">
      {STAGES.map((stage, i) => {
        const value = funnel[stage.key]
        const widthPct = (value / max) * 100
        const prior = i === 0 ? null : funnel[STAGES[i - 1].key]
        const rate = prior && prior > 0 ? Math.round((value / prior) * 100) : null
        return (
          <div key={stage.key} className="flex items-center gap-3 text-xs">
            <div className="w-14 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{stage.label}</div>
            <div
              className="flex-1 h-6 rounded-md relative overflow-hidden"
              style={{ backgroundColor: 'var(--color-surface)' }}
            >
              <div
                className="h-full rounded-md transition-all"
                style={{ width: `${widthPct}%`, backgroundColor: stage.color, opacity: 0.85 }}
              />
            </div>
            <div className="w-24 flex-shrink-0 flex items-baseline justify-end gap-1.5">
              <span className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
              {rate != null && (
                <span style={{ color: 'var(--color-text-muted)' }}>({rate}%)</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
