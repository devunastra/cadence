'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'

export function ThemeInitializer({ theme }: { theme?: 'light' | 'dark' }) {
  const { setTheme } = useTheme()

  useEffect(() => {
    if (theme) setTheme(theme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
