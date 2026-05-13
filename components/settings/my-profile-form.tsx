'use client'

import { useState, useEffect, useRef } from 'react'
import { Camera, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import { uploadAvatar, removeAvatar, saveThemePreference, saveNotificationPreferences } from '@/app/actions'
import { useToast } from '@/components/ui/toast-provider'

interface MyProfileFormProps {
  email: string
  avatarUrl: string | null
  notifyCreated: boolean
  notifyUpdated: boolean
  notifyDeleted: boolean
}

const INPUT = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]'
const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'

export function MyProfileForm({ email, avatarUrl: initialAvatarUrl, notifyCreated: initialNotifyCreated, notifyUpdated: initialNotifyUpdated, notifyDeleted: initialNotifyDeleted }: MyProfileFormProps) {
  const { theme, setTheme } = useTheme()
  const { showError } = useToast()
  const [notifyCreated, setNotifyCreated] = useState(initialNotifyCreated)
  const [notifyUpdated, setNotifyUpdated] = useState(initialNotifyUpdated)
  const [notifyDeleted, setNotifyDeleted] = useState(initialNotifyDeleted)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const initials = email.charAt(0).toUpperCase()

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { showError('Image must be under 2 MB.'); return }
    setAvatarUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { url } = await uploadAvatar(formData)
      setAvatarUrl(`${url}?t=${Date.now()}`)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setAvatarUploading(false)
      e.target.value = ''
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPassword) { showError('Please enter your current password.'); return }
    if (!newPassword || newPassword.length < 8) { showError('New password must be at least 8 characters.'); return }
    if (currentPassword === newPassword) { showError('New password must be different from your current password.'); return }
    if (newPassword !== confirmPassword) { showError('Passwords do not match.'); return }
    setSaving(true)
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
    if (signInError) { setSaving(false); showError('Current password is incorrect.'); return }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword, data: { onboarding_complete: true } })
    setSaving(false)
    if (updateError) {
      showError(updateError.message)
    } else {
      setSaved(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setSaved(false), 2000)
    }
  }

  function handleSetTheme(t: 'light' | 'dark') {
    setTheme(t)
    saveThemePreference(t).catch(console.error)
  }

  function handleNotifyToggle(field: 'created' | 'updated' | 'deleted') {
    const next = { created: notifyCreated, updated: notifyUpdated, deleted: notifyDeleted }
    next[field] = !next[field]
    setNotifyCreated(next.created)
    setNotifyUpdated(next.updated)
    setNotifyDeleted(next.deleted)
    saveNotificationPreferences(next.created, next.updated, next.deleted).catch(console.error)
  }

  return (
    <div className="space-y-6">
      {/* Account card */}
      <form onSubmit={handlePasswordChange}>
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>

          {/* Avatar + email */}
          <div className="px-6 py-5 flex items-center gap-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="relative group flex-shrink-0">
              <div
                className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center"
                style={{ backgroundColor: 'var(--color-accent)', boxShadow: '0 0 0 2px var(--color-border)' }}
              >
                {avatarUrl
                  ? <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                  : <span className="text-white text-2xl font-semibold">{initials}</span>}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity disabled:cursor-wait"
              >
                <Camera size={16} className="text-white" />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{email}</p>
              {avatarUploading && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Uploading…</p>}
              {avatarUrl && !avatarUploading && (
                <button
                  type="button"
                  onClick={async () => { await removeAvatar(); setAvatarUrl(null) }}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors mt-0.5"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>

          {/* Change password */}
          <div className="px-6 py-5 space-y-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <p className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Change Password</p>
            <div>
              <label htmlFor="current-password" className={LABEL}>Current Password</label>
              <input id="current-password" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Enter your current password" className={INPUT} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="new-password" className={LABEL}>New Password</label>
                <input id="new-password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min. 8 characters" className={INPUT} />
              </div>
              <div>
                <label htmlFor="confirm-password" className={LABEL}>Confirm New Password</label>
                <input id="confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" className={INPUT} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ backgroundColor: 'var(--color-surface)' }}>
            <button
              type="submit"
              disabled={saving || !currentPassword || !newPassword || !confirmPassword}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {saving ? 'Updating…' : saved ? 'Updated ✓' : 'Update password'}
            </button>
          </div>
        </div>
      </form>

      {/* Appearance card */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="px-6 py-5">
          <p className="text-base font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Appearance</p>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => handleSetTheme('light')}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-colors"
              style={{
                borderColor: theme === 'light' ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: theme === 'light' ? 'var(--color-accent-subtle)' : 'transparent',
              }}
            >
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Sun size={20} className="text-amber-500" />
              </div>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Light</span>
              {theme === 'light' && <span className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>Active</span>}
            </button>

            <button
              type="button"
              onClick={() => handleSetTheme('dark')}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-colors"
              style={{
                borderColor: theme === 'dark' ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: theme === 'dark' ? 'var(--color-accent-subtle)' : 'transparent',
              }}
            >
              <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                <Moon size={20} className="text-slate-300" />
              </div>
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Dark</span>
              {theme === 'dark' && <span className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>Active</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Notifications card */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="px-6 py-5">
          <p className="text-base font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Lead Table Notifications</p>
          <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>Choose which real-time banners you see when other users make changes to the leads table.</p>
          <div className="space-y-4">
            {([
              { field: 'created', label: 'New lead added', description: 'Show a banner when another user creates a lead', value: notifyCreated },
              { field: 'updated', label: 'Lead updated',   description: 'Show a banner when another user edits a lead',   value: notifyUpdated },
              { field: 'deleted', label: 'Lead deleted',   description: 'Show a banner when another user deletes a lead', value: notifyDeleted },
            ] as const).map(({ field, label, description, value }) => (
              <div key={field} className="flex items-center justify-between gap-4 py-3 last:border-b-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div>
                  <p className="text-base font-medium" style={{ color: 'var(--color-text-primary)' }}>{label}</p>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={value}
                  onClick={() => handleNotifyToggle(field)}
                  className="relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2"
                  style={{
                    backgroundColor: value ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                  }}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${value ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
