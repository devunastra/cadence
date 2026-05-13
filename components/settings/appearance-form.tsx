'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { saveThemePreference } from '@/app/actions'

export function AppearanceForm() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  function handleSetTheme(t: 'light' | 'dark') {
    setTheme(t)
    saveThemePreference(t).catch(console.error)
  }

  return (
    <div className="max-w-xl px-8 py-8">
      <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Appearance</h2>
      <p className="text-base mb-8" style={{ color: 'var(--color-text-secondary)' }}>Choose how the app looks for you.</p>

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => handleSetTheme('light')}
          disabled={!mounted}
          className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-colors"
          style={{
            borderColor: mounted && theme === 'light' ? 'var(--color-accent)' : 'var(--color-border)',
            backgroundColor: mounted && theme === 'light' ? 'var(--color-accent-subtle)' : 'transparent',
          }}
        >
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <Sun size={20} className="text-amber-500" />
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Light</span>
          {mounted && theme === 'light' && (
            <span className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>Active</span>
          )}
        </button>

        <button
          onClick={() => handleSetTheme('dark')}
          disabled={!mounted}
          className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-colors"
          style={{
            borderColor: mounted && theme === 'dark' ? 'var(--color-accent)' : 'var(--color-border)',
            backgroundColor: mounted && theme === 'dark' ? 'var(--color-accent-subtle)' : 'transparent',
          }}
        >
          <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
            <Moon size={20} className="text-slate-300" />
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Dark</span>
          {mounted && theme === 'dark' && (
            <span className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>Active</span>
          )}
        </button>
      </div>
    </div>
  )
}
