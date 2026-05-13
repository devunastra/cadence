import { ReactNode } from 'react'

export default function LeadsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--color-bg)' }}>
      {children}
    </div>
  )
}
