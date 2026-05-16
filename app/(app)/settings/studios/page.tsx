'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentStudio } from '@/components/studio-context'
import { createClient } from '@/lib/supabase/client'
import { StudiosForm } from '@/components/settings/studios-form'
import { Spinner } from '@/components/spinner'
import type { Studio } from '@/lib/types'

export default function StudiosPage() {
  const router = useRouter()
  const { userRole, isSuper, memberships } = useCurrentStudio()
  const isOwner = userRole === 'studio_owner' || isSuper

  const [studios, setStudios] = useState<Studio[] | null>(null)

  useEffect(() => {
    if (!isOwner) {
      router.replace('/settings/my-profile')
      return
    }

    let cancelled = false
    async function fetchStudios() {
      const supabase = createClient()
      const studioIds = memberships.map(m => m.studio_id)
      let query = supabase.from('studios').select('*').is('deleted_at', null).order('name')
      if (!isSuper) {
        query = query.in('id', studioIds)
      }
      const { data } = await query
      if (!cancelled) setStudios((data ?? []) as Studio[])
    }
    fetchStudios()
    return () => { cancelled = true }
  }, [isOwner, isSuper, memberships, router])

  if (!isOwner) return null
  if (!studios) return <div className="flex items-center justify-center py-12"><Spinner /></div>

  return <StudiosForm initialStudios={studios} />
}
