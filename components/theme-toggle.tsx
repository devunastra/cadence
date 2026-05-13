'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

const SunIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="4"/>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
  </svg>
)

const MoonIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
  </svg>
)

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="w-16 h-8" />

  const isDark = theme === 'dark'
  const TRANSITION = 'width 0.38s ease-in-out'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative flex items-center h-8 w-[4.6rem] rounded-full p-0.5 overflow-hidden transition-colors duration-300"
      style={{ backgroundColor: 'var(--color-surface-hover)' }}
    >
      {/* Sliding background highlight */}
      <span
        className="absolute top-0.5 bottom-0.5 rounded-full shadow-sm"
        style={{
          backgroundColor: 'var(--color-bg)',
          left: isDark ? '30%' : '2px',
          right: isDark ? '2px' : '30%',
          transition: 'left 0.38s ease-in-out, right 0.38s ease-in-out',
        }}
      />

      {/* Sun zone — 70% when light, 30% when dark */}
      <span
        className="relative z-10 flex items-center justify-center"
        style={{ width: isDark ? '30%' : '70%', transition: TRANSITION }}
      >
        <SunIcon className={isDark ? 'text-gray-400' : 'text-amber-500'} />
      </span>

      {/* Moon zone — 30% when light, 70% when dark */}
      <span
        className="relative z-10 flex items-center justify-center"
        style={{ width: isDark ? '70%' : '30%', transition: TRANSITION }}
      >
        <MoonIcon className={isDark ? 'text-slate-300' : 'text-gray-400'} />
      </span>
    </button>
  )
}
