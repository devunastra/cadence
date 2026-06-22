import { ReactNode } from 'react'

export default function CallAnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--color-bg)' }}>
      <h1 className="text-2xl font-semibold flex-shrink-0 px-5 pt-5 pb-3" style={{ color: 'var(--color-text-primary)' }}>
        Call Analytics
      </h1>
      <div className="flex flex-col flex-1 min-h-0 px-5 pb-4">
        {children}
      </div>
    </div>
  )
}
