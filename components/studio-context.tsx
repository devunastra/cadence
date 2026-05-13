'use client'

import { createContext, useContext, useState } from 'react'
import type { Studio } from '@/lib/types'

interface StudioContextValue {
  currentStudio: Studio
  setCurrentStudio: (studio: Studio) => void
  updateCurrentStudio: (patch: Partial<Studio>) => void
}

const StudioContext = createContext<StudioContextValue | null>(null)

export function StudioProvider({ studio, children }: { studio: Studio; children: React.ReactNode }) {
  const [currentStudio, setCurrentStudio] = useState<Studio>(studio)

  function updateCurrentStudio(patch: Partial<Studio>) {
    setCurrentStudio(prev => ({ ...prev, ...patch }))
  }

  return (
    <StudioContext.Provider value={{ currentStudio, setCurrentStudio, updateCurrentStudio }}>
      {children}
    </StudioContext.Provider>
  )
}

export function useCurrentStudio() {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useCurrentStudio must be used inside StudioProvider')
  return ctx
}
