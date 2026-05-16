'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentStudio } from '@/components/studio-context'
import { BusinessProfileForm } from '@/components/settings/business-profile-form'

export default function BusinessProfilePage() {
  const router = useRouter()
  const { currentStudio, userRole } = useCurrentStudio()
  const isOwner = userRole === 'studio_owner' || userRole === 'super_admin'

  useEffect(() => {
    if (!isOwner) router.replace('/settings/my-profile')
  }, [isOwner, router])

  if (!isOwner) return null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Business Profile</h2>
        <p className="text-base" style={{ color: 'var(--color-text-secondary)' }}>Manage your studio details and integration credentials.</p>
      </div>
      <BusinessProfileForm studio={currentStudio} />
    </div>
  )
}
