'use client'

import { useCurrentStudio } from '@/components/studio-context'
import { CalendarShell } from '@/components/calendar/calendar-shell'

export default function CalendarPage() {
  const { studioId, userRole, currentStudio } = useCurrentStudio()

  return (
    <CalendarShell
      studioId={studioId}
      calStartHour={currentStudio.calendar_start_hour ?? 6}
      calEndHour={currentStudio.calendar_end_hour ?? 22}
      slotConfig={{
        appointment_duration_minutes: currentStudio.appointment_duration_minutes ?? 45,
        appointment_min_advance_weeks: currentStudio.appointment_min_advance_weeks ?? 1,
        appointment_slots: (currentStudio.appointment_slots as Record<string, string[]>) ?? {},
      }}
      userRole={userRole}
    />
  )
}
