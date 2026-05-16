'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export function ProgressBar() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const [opacity, setOpacity] = useState(1)

  useEffect(() => {
    // Reset and start on every route change
    setOpacity(1)
    setWidth(0)
    setVisible(true)

    const t1 = setTimeout(() => setWidth(30), 10)
    const t2 = setTimeout(() => setWidth(80), 80)
    // Complete
    const t3 = setTimeout(() => setWidth(100), 250)
    // Fade out
    const t4 = setTimeout(() => setOpacity(0), 400)
    // Unmount
    const t5 = setTimeout(() => {
      setVisible(false)
      setWidth(0)
      setOpacity(1)
    }, 600)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
      clearTimeout(t5)
    }
  }, [pathname])

  if (!visible) return null

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999,
        height: 3,
        width: `${width}%`,
        backgroundColor: 'var(--color-accent)',
        pointerEvents: 'none',
        opacity,
        // Use only the transition shorthand — no mixing with transitionDuration
        transition: opacity === 0
          ? 'opacity 300ms ease'
          : width >= 100
          ? 'width 200ms ease'
          : 'width 400ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    />
  )
}
