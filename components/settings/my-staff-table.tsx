'use client'

import { useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { SimpleSelect } from '@/components/simple-select'
import { ConfirmDeleteModal } from '@/components/confirm-delete-modal'
import { useToast } from '@/components/ui/toast-provider'
import type { StudioUser, Role } from '@/lib/types'

interface MyStaffTableProps {
  studioId: string
  initialMembers: (StudioUser & { email: string })[]
  currentUserId: string
  isSuperAdmin?: boolean
  studios: { id: string; name: string }[]
}

const INPUT = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]'
const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  studio_owner: 'Owner',
  studio_staff: 'Staff',
}

const BASE_ROLE_OPTIONS = [
  { value: 'studio_staff', label: 'Staff' },
  { value: 'studio_owner', label: 'Owner' },
]

const SUPER_ROLE_OPTIONS = [
  ...BASE_ROLE_OPTIONS,
  { value: 'super_admin', label: 'Super Admin' },
]

export function MyStaffTable({ studioId, initialMembers, currentUserId, isSuperAdmin = false, studios }: MyStaffTableProps) {
  const [members, setMembers] = useState(initialMembers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('studio_staff')
  const [inviteStudioId, setInviteStudioId] = useState(studioId)
  const { showError } = useToast()
  const [inviting, setInviting] = useState(false)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const studioOptions = studios.map(s => ({ value: s.id, label: s.name }))

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)

    const res = await fetch('/api/staff/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, studioId: inviteStudioId }),
    })

    setInviting(false)

    if (!res.ok) {
      const data = await res.json()
      showError(data.error ?? 'Invite failed')
      return
    }

    setInviteEmail('')
    window.location.reload()
  }

  async function handleRoleChange(userId: string, newRole: Role) {
    const prev = members.find(m => m.user_id === userId)?.role
    // Optimistic update
    setMembers(ms => ms.map(m => m.user_id === userId ? { ...m, role: newRole } : m))
    setUpdatingRoleId(userId)
    const res = await fetch('/api/staff/update-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, studioId, role: newRole }),
    })
    setUpdatingRoleId(null)
    if (!res.ok) {
      const data = await res.json()
      showError(data.error ?? 'Failed to update role')
      // Rollback
      setMembers(ms => ms.map(m => m.user_id === userId ? { ...m, role: prev as Role } : m))
    }
  }

  async function handleRemove() {
    if (!pendingRemoveId) return
    setIsRemoving(true)
    await fetch('/api/staff/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: pendingRemoveId, studioId }),
    })
    setMembers(prev => prev.filter(m => m.user_id !== pendingRemoveId))
    setIsRemoving(false)
    setPendingRemoveId(null)
  }

  return (
    <>
    {pendingRemoveId && (
      <ConfirmDeleteModal
        title="Remove Staff Member?"
        message="Are you sure you want to remove this staff member? They will lose access to this studio."
        confirmLabel="Remove"
        isDeleting={isRemoving}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemoveId(null)}
      />
    )}
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>My Staff</h2>
        <p className="text-base" style={{ color: 'var(--color-text-secondary)' }}>Manage who has access to this studio.</p>
      </div>

      <form onSubmit={handleInvite}>
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>

          {/* Staff table */}
          <div style={{ borderBottom: '1px solid var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--color-surface)' }}>
                <tr>
                  <th className="text-left px-6 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Email</th>
                  <th className="text-left px-6 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Role</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      No other staff members yet.
                    </td>
                  </tr>
                ) : (
                  members.map(member => (
                    <tr key={member.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                          >
                            {member.avatar_url ? (
                              <img src={member.avatar_url} alt={member.email} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-white text-xs font-semibold">{member.email.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <span style={{ color: 'var(--color-text-body)' }}>{member.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        {/* Inline role edit: super_admin can edit everyone; studio_owner can edit non-super_admin rows that aren't themselves */}
                        {(isSuperAdmin || (member.role !== 'super_admin' && member.user_id !== currentUserId)) && member.user_id !== currentUserId ? (
                          <div style={{ width: 150 }}>
                            <SimpleSelect
                              value={member.role}
                              onChange={v => handleRoleChange(member.user_id, v as Role)}
                              options={isSuperAdmin ? SUPER_ROLE_OPTIONS : BASE_ROLE_OPTIONS}
                              clearable={false}
                              disabled={updatingRoleId === member.user_id}
                              fullWidth
                              triggerBg="transparent"
                              triggerClassName="py-1 text-sm"
                            />
                          </div>
                        ) : (
                          <span className="text-sm" style={{ color: 'var(--color-text-body)' }}>
                            {ROLE_LABELS[member.role as Role]}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-center">
                        {member.role !== 'super_admin' && member.user_id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => setPendingRemoveId(member.user_id)}
                            className="p-1 transition-colors"
                            style={{ color: '#dc2626' }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#b91c1c'}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#dc2626'}
                            title="Remove staff member"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Invite form */}
          <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className={LABEL}>Invite by email</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="staff@example.com"
                  className={INPUT}
                />
              </div>
              <div className="w-64">
                <label className={LABEL}>Studio</label>
                <SimpleSelect
                  value={inviteStudioId}
                  onChange={v => setInviteStudioId(v)}
                  options={studioOptions}
                  fullWidth
                  clearable={false}
                  triggerBg="var(--color-bg)"
                  triggerClassName="py-2"
                />
              </div>
              <div className="w-36">
                <label className={LABEL}>Role</label>
                <SimpleSelect
                  value={inviteRole}
                  onChange={v => setInviteRole(v as Role)}
                  options={isSuperAdmin ? SUPER_ROLE_OPTIONS : BASE_ROLE_OPTIONS}
                  fullWidth
                  clearable={false}
                  triggerBg="var(--color-bg)"
                  triggerClassName="py-2"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ backgroundColor: 'var(--color-surface)' }}>
            <button
              type="submit"
              disabled={inviting || !inviteEmail}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {inviting ? 'Inviting…' : 'Send Invite'}
            </button>
          </div>
        </div>
      </form>
    </div>
    </>
  )
}
