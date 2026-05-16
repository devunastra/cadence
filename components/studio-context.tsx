'use client'

import { createContext, useContext, useState } from 'react'
import type { Studio, Role } from '@/lib/types'

interface Membership {
  studio_id: string
  role: string
}

interface StudioContextValue {
  currentStudio: Studio
  setCurrentStudio: (studio: Studio) => void
  updateCurrentStudio: (patch: Partial<Studio>) => void
  studioId: string
  userRole: Role
  isSuper: boolean
  memberships: Membership[]
}

const StudioContext = createContext<StudioContextValue | null>(null)

export function StudioProvider({
  studio,
  memberships,
  children,
}: {
  studio: Studio
  memberships: Membership[]
  children: React.ReactNode
}) {
  const [currentStudio, setCurrentStudio] = useState<Studio>(studio)

  function updateCurrentStudio(patch: Partial<Studio>) {
    setCurrentStudio(prev => ({ ...prev, ...patch }))
  }

  const isSuper = memberships.some(m => m.role === 'super_admin')
  const membership = memberships.find(m => m.studio_id === currentStudio.id) ?? memberships[0]
  const userRole: Role = (membership?.role ?? 'studio_staff') as Role

  return (
    <StudioContext.Provider value={{
      currentStudio,
      setCurrentStudio,
      updateCurrentStudio,
      studioId: currentStudio.id,
      userRole,
      isSuper,
      memberships,
    }}>
      {children}
    </StudioContext.Provider>
  )
}

export function useCurrentStudio() {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useCurrentStudio must be used inside StudioProvider')
  return ctx
}
