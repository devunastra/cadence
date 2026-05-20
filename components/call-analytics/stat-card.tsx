'use client'

interface StatCardProps {
  title: string
  value: string
  sub?: string
  accent?: boolean
  valueColor?: string
}

export function StatCard({ title, value, sub, accent, valueColor }: StatCardProps) {
  const color = valueColor ?? (accent ? 'var(--color-accent)' : 'var(--color-text-primary)')
  return (
    <div className="rounded-2xl p-4 flex flex-col h-[120px]" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider leading-tight" style={{ color: 'var(--color-text-secondary)' }}>{title}</p>
      <p className="text-[28px] font-bold mt-auto" style={{ color }}>
        {value}
      </p>
      {sub ? <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{sub}</p> : <p className="text-xs">&nbsp;</p>}
    </div>
  )
}
