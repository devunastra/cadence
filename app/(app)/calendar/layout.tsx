import { ReactNode } from 'react'

export default function CalendarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      <h1 className="text-2xl font-semibold flex-shrink-0 px-3 md:px-5 pt-5 md:pt-10 pb-3" style={{ color: 'var(--color-text-primary)' }}>Calendar</h1>
      <div className="flex flex-col flex-1 min-h-0 px-3 md:px-5 pb-4">
        {children}
      </div>
    </div>
  )
}
