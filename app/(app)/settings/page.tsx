'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentStudio } from '@/components/studio-context'

export default function SettingsPage() {
  const router = useRouter()
  const { userRole } = useCurrentStudio()
  const isOwner = userRole === 'studio_owner' || userRole === 'super_admin'

  useEffect(() => {
    router.replace(isOwner ? '/settings/business-profile' : '/settings/my-profile')
  }, [router, isOwner])

  return null
}
