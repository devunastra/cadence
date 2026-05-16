'use client'

import { useEffect, useState } from 'react'
import { useCurrentStudio } from '@/components/studio-context'
import { createClient } from '@/lib/supabase/client'
import { CalendarShell } from '@/components/calendar/calendar-shell'
import { Spinner } from '@/components/spinner'
import type { StudioSlotConfig } from '@/lib/types'

interface StudioConfig {
  calStartHour: number
  calEndHour: number
  slotConfig: StudioSlotConfig
}

export default function CalendarPage() {
  const { studioId, userRole } = useCurrentStudio()
  const [config, setConfig] = useState<StudioConfig | null>(null)

  useEffect(() => {
    // Mock studio config for SIT branch
    setConfig({
      calStartHour: 6,
      calEndHour: 22,
      slotConfig: {
        appointment_duration_minutes: 45,
        appointment_min_advance_weeks: 1,
        appointment_slots: {
          '1': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
          '2': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
          '3': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
          '4': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
          '5': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
          '6': ['10:00', '11:00', '14:00', '15:00'],
        },
      },
    })
  }, [studioId])

  if (!config) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <CalendarShell
      studioId={studioId}
      calStartHour={config.calStartHour}
      calEndHour={config.calEndHour}
      slotConfig={config.slotConfig}
      userRole={userRole}
    />
  )
}
