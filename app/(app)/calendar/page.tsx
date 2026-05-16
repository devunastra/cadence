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
    let cancelled = false
    async function fetchConfig() {
      const supabase = createClient()
      const { data: studio } = await supabase
        .from('studios')
        .select('calendar_start_hour, calendar_end_hour, appointment_duration_minutes, appointment_min_advance_weeks, appointment_slots')
        .eq('id', studioId)
        .single()

      if (cancelled) return
      setConfig({
        calStartHour: studio?.calendar_start_hour ?? 6,
        calEndHour: studio?.calendar_end_hour ?? 22,
        slotConfig: {
          appointment_duration_minutes: studio?.appointment_duration_minutes ?? 45,
          appointment_min_advance_weeks: studio?.appointment_min_advance_weeks ?? 1,
          appointment_slots: (studio?.appointment_slots as Record<string, string[]>) ?? {},
        },
      })
    }
    fetchConfig()
    return () => { cancelled = true }
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
