import { redirect } from 'next/navigation'
import { getCurrentUser, getMemberships, getSelectedStudioId } from '@/lib/data-cache'
import { getCalendarAppointments, getPageFilters } from '@/app/actions'
import { createClient } from '@/lib/supabase/server'
import { CalendarShell } from '@/components/calendar/calendar-shell'
import type { Role, StudioSlotConfig } from '@/lib/types'

const STUDIO_TZ = 'America/Chicago'

function getWeekStart(d: Date): Date {
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: STUDIO_TZ, weekday: 'short' }).format(d)
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName)
  // Go back to Sunday, then return midnight Chicago as UTC
  const sundayRef = new Date(d.getTime() - dow * 86_400_000)
  const dateStr   = sundayRef.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
  const utcMidnight = new Date(dateStr + 'T00:00:00Z')
  const h = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: STUDIO_TZ, hour: 'numeric', hourCycle: 'h23' }).format(utcMidnight),
    10,
  )
  return new Date(utcMidnight.getTime() + (h === 0 ? 0 : 24 - h) * 3_600_000)
}

export default async function CalendarPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships(user.id)
  const selectedStudioId = await getSelectedStudioId()
  const studioId = selectedStudioId ?? memberships[0]?.studio_id ?? null

  if (!studioId) redirect('/login')

  // Derive role for the selected studio
  const membership = memberships.find(m => m.studio_id === studioId) ?? memberships[0]
  const userRole: Role = (membership?.role ?? 'studio_staff') as Role

  const weekStart = getWeekStart(new Date())
  const weekEnd   = new Date(weekStart.getTime() + 6 * 86_400_000 + 86_400_000 - 1) // Saturday 23:59:59.999 Chicago

  const supabase = await createClient()
  const { data: studio } = await supabase
    .from('studios')
    .select('calendar_start_hour, calendar_end_hour, appointment_duration_minutes, appointment_min_advance_weeks, appointment_slots')
    .eq('id', studioId)
    .single()

  const calStartHour = studio?.calendar_start_hour ?? 6
  const calEndHour   = studio?.calendar_end_hour   ?? 22

  const slotConfig: StudioSlotConfig = {
    appointment_duration_minutes:  studio?.appointment_duration_minutes  ?? 45,
    appointment_min_advance_weeks: studio?.appointment_min_advance_weeks ?? 1,
    appointment_slots:             (studio?.appointment_slots as Record<string, string[]>) ?? {},
  }

  const [initialAppointments, pageFilters] = await Promise.all([
    getCalendarAppointments(studioId, weekStart.toISOString(), weekEnd.toISOString()).catch(() => []),
    getPageFilters(studioId).catch(() => ({ appointmentList: undefined })),
  ])

  return (
    <CalendarShell
      studioId={studioId}
      initialAppointments={initialAppointments}
      initialWeekStart={weekStart}
      calStartHour={calStartHour}
      calEndHour={calEndHour}
      slotConfig={slotConfig}
      userRole={userRole}
      initialListFilters={pageFilters.appointmentList}
    />
  )
}
