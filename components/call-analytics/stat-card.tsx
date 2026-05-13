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
    <div className="rounded-2xl p-5 flex flex-col gap-1 h-[120px]" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>{title}</p>
      <p className="text-[28px] font-bold" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
    </div>
  )
}
