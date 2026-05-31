'use client'

import { useState, useEffect, useMemo } from 'react'
import { Trash2, ChevronRight } from 'lucide-react'
import { SimpleSelect } from '@/components/simple-select'
import { ConfirmDeleteModal } from '@/components/confirm-delete-modal'
import { useToast } from '@/components/ui/toast-provider'
import type { StudioUser, Role } from '@/lib/types'

interface MyStaffTableProps {
  studioId: string
  initialMembers: (StudioUser & { email: string; studio_name: string })[]
  currentUserId: string
  isSuperAdmin?: boolean
  studios: { id: string; name: string }[]
}

type Member = StudioUser & { email: string; studio_name: string }

const INPUT = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]'
const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'

const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  studio_owner: 'Owner',
  studio_staff: 'Staff',
}

const ROLE_ORDER: Record<Role, number> = {
  super_admin: 0,
  studio_owner: 1,
  studio_staff: 2,
}

const BASE_ROLE_OPTIONS = [
  { value: 'studio_staff', label: 'Staff' },
  { value: 'studio_owner', label: 'Owner' },
]

const SUPER_ROLE_OPTIONS = [
  ...BASE_ROLE_OPTIONS,
  { value: 'super_admin', label: 'Super Admin' },
]

// Sentinel studio value for inviting a brand-new studio owner with no studio yet.
const NEW_STUDIO = '__new_studio__'

interface UserGroup {
  user_id: string
  email: string
  avatar_url: string | null
  memberships: Member[]
}

function roleSummary(memberships: Member[]): string {
  const roles = Array.from(new Set(memberships.map(m => m.role))).sort(
    (a, b) => (ROLE_ORDER[a as Role] ?? 99) - (ROLE_ORDER[b as Role] ?? 99),
  )
  return roles.map(r => ROLE_LABELS[r as Role]).join(' / ')
}

export function MyStaffTable({ studioId, initialMembers, currentUserId, isSuperAdmin = false, studios }: MyStaffTableProps) {
  const [members, setMembers] = useState(initialMembers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('studio_staff')
  const [inviteStudioId, setInviteStudioId] = useState(studioId)
  const { showError, showSuccess, showDeferred } = useToast()
  const [inviting, setInviting] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<{ userId: string; studioId: string; studioName: string; membershipId: string } | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null)
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(new Set())
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    email: string; studioId: string; role: Role; currentRole: Role; newRole: Role; studioName: string
  } | null>(null)
  const [isConfirmingRoleChange, setIsConfirmingRoleChange] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Group memberships by user. Each user is one expandable row in the table.
  // Sort by primary role (super_admin → owner → staff), then email.
  const userGroups: UserGroup[] = useMemo(() => {
    const map = new Map<string, UserGroup>()
    for (const m of members) {
      const existing = map.get(m.user_id)
      if (existing) {
        existing.memberships.push(m)
      } else {
        map.set(m.user_id, {
          user_id: m.user_id,
          email: m.email,
          avatar_url: m.avatar_url,
          memberships: [m],
        })
      }
    }
    for (const g of map.values()) {
      g.memberships.sort((a, b) => a.studio_name.localeCompare(b.studio_name))
    }
    return Array.from(map.values()).sort((a, b) => {
      const primaryA = Math.min(...a.memberships.map(m => ROLE_ORDER[m.role as Role] ?? 99))
      const primaryB = Math.min(...b.memberships.map(m => ROLE_ORDER[m.role as Role] ?? 99))
      return primaryA - primaryB || a.email.localeCompare(b.email)
    })
  }, [members])

  if (!mounted) return null

  function toggleExpanded(userId: string) {
    setExpandedUserIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const isNewStudio = inviteStudioId === NEW_STUDIO
  const studioOptions = [
    ...(isSuperAdmin ? [{ value: NEW_STUDIO, label: '+ New studio (blank)' }] : []),
    ...studios.map(s => ({ value: s.id, label: s.name })),
  ]

  async function submitInvite(opts: { confirmRoleChange?: boolean } = {}): Promise<void> {
    const payload = isNewStudio
      ? { email: inviteEmail, role: 'studio_owner' }
      : { email: inviteEmail, role: inviteRole, studioId: inviteStudioId, confirmRoleChange: opts.confirmRoleChange }

    const res = await fetch('/api/staff/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))

    // (i) Role-change confirmation required — show modal, keep form intact.
    if (res.status === 409 && data?.requires_role_change_confirmation) {
      setPendingRoleChange({
        email: inviteEmail,
        studioId: inviteStudioId,
        role: inviteRole,
        currentRole: data.current_role as Role,
        newRole: data.new_role as Role,
        studioName: data.studio_name as string,
      })
      return
    }

    if (!res.ok) {
      showError(data.error ?? 'Invite failed')
      return
    }

    // (d) Already a member.
    if (data.already) {
      showSuccess('Already a member — no change.')
      setInviteEmail('')
      return
    }

    // (i) Role change confirmed. Defer the toast so it survives the reload.
    if (data.role_changed) {
      showDeferred('success', `Role updated to ${ROLE_LABELS[data.role_changed.to as Role]}.`)
      setInviteEmail('')
      window.location.reload()
      return
    }

    // Blank-studio invite (scenario a / c): no studio_users row is created yet
    // (invitee hasn't accepted), so the staff table has nothing new to show.
    // Skip the reload — keeps the success toast on screen.
    if (isNewStudio) {
      showSuccess(
        `Invite sent to ${inviteEmail}. They'll receive an email to set up their studio.`,
      )
      setInviteEmail('')
      return
    }

    // Defer the toast so it survives window.location.reload() — the in-memory
    // ToastStack would otherwise be wiped before the user could read it.
    if (data.warning) {
      showDeferred('success', `Done. ${data.warning}`)
    } else {
      showDeferred('success', `Invite sent to ${inviteEmail}.`)
    }

    setInviteEmail('')
    window.location.reload()
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    try {
      await submitInvite()
    } finally {
      setInviting(false)
    }
  }

  async function handleConfirmRoleChange() {
    if (!pendingRoleChange) return
    setIsConfirmingRoleChange(true)
    try {
      await submitInvite({ confirmRoleChange: true })
    } finally {
      setIsConfirmingRoleChange(false)
      setPendingRoleChange(null)
    }
  }

  async function handleRoleChange(member: Member, newRole: Role) {
    const prev = member.role
    // Optimistic update — match the specific membership row, not all of a user's rows
    setMembers(ms => ms.map(m => m.id === member.id ? { ...m, role: newRole } : m))
    setUpdatingRoleId(member.id)
    const res = await fetch('/api/staff/update-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: member.user_id, studioId: member.studio_id, role: newRole }),
    })
    setUpdatingRoleId(null)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      showError(data.error ?? 'Failed to update role')
      // Rollback
      setMembers(ms => ms.map(m => m.id === member.id ? { ...m, role: prev } : m))
      return
    }
    // Surface the same friendly confirmation the invite-form path produces.
    // `warning` from the server means the role updated but the notification
    // email didn't go through — flag that so the operator knows.
    if (data.warning) {
      showSuccess(`Role updated to ${ROLE_LABELS[newRole]}. ${data.warning}`)
    } else {
      showSuccess(`Role updated to ${ROLE_LABELS[newRole]}. ${member.email} has been notified.`)
    }
  }

  async function handleRemove() {
    if (!pendingRemove) return
    setIsRemoving(true)
    const res = await fetch('/api/staff/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: pendingRemove.userId, studioId: pendingRemove.studioId }),
    })
    if (!res.ok) {
      const data = await res.json()
      showError(data.error ?? 'Failed to remove')
      setIsRemoving(false)
      setPendingRemove(null)
      return
    }
    setMembers(prev => prev.filter(m => m.id !== pendingRemove.membershipId))
    setIsRemoving(false)
    setPendingRemove(null)
  }

  return (
    <>
    {pendingRemove && (
      <ConfirmDeleteModal
        title="Remove access?"
        message={`Remove this person's access to ${pendingRemove.studioName}? If it's their only studio, their account will be deleted entirely.`}
        confirmLabel="Remove"
        isDeleting={isRemoving}
        onConfirm={handleRemove}
        onCancel={() => setPendingRemove(null)}
      />
    )}
    {pendingRoleChange && (
      <RoleChangeConfirmModal
        email={pendingRoleChange.email}
        studioName={pendingRoleChange.studioName}
        currentRole={pendingRoleChange.currentRole}
        newRole={pendingRoleChange.newRole}
        isConfirming={isConfirmingRoleChange}
        onConfirm={handleConfirmRoleChange}
        onCancel={() => setPendingRoleChange(null)}
      />
    )}
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>My Staff</h2>
        <p className="text-base" style={{ color: 'var(--color-text-secondary)' }}>Manage who has access{isSuperAdmin ? ' across all studios' : ' to your studios'}.</p>
      </div>

      <form onSubmit={handleInvite}>
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>

          {/* Staff table — grouped by user; each row expands to show per-studio memberships */}
          <div className="overflow-x-auto" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <table className="w-full text-sm" style={{ minWidth: 400 }}>
              <thead style={{ backgroundColor: 'var(--color-surface)' }}>
                <tr>
                  <th className="text-left px-4 md:px-6 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Email</th>
                  <th className="text-left px-4 md:px-6 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Studios</th>
                  <th className="text-left px-4 md:px-6 py-3 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Role</th>
                  <th className="px-4 md:px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {userGroups.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      No other staff members yet.
                    </td>
                  </tr>
                ) : (
                  userGroups.map(group => {
                    const isExpanded = expandedUserIds.has(group.user_id)
                    const studioCount = group.memberships.length
                    return (
                      <UserGroupRows
                        key={group.user_id}
                        group={group}
                        isExpanded={isExpanded}
                        studioCount={studioCount}
                        onToggle={() => toggleExpanded(group.user_id)}
                        isSuperAdmin={isSuperAdmin}
                        currentUserId={currentUserId}
                        updatingRoleId={updatingRoleId}
                        onChangeRole={handleRoleChange}
                        onRemove={(m) => setPendingRemove({ userId: m.user_id, studioId: m.studio_id, studioName: m.studio_name, membershipId: m.id })}
                      />
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Invite form */}
          <div className="px-4 md:px-6 py-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex flex-col md:flex-row gap-3 md:gap-4 md:items-end">
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
              <div className="w-full md:w-64">
                <label className={LABEL}>Studio</label>
                <SimpleSelect
                  value={inviteStudioId}
                  onChange={v => {
                    setInviteStudioId(v)
                    if (v === NEW_STUDIO) setInviteRole('studio_owner')
                  }}
                  options={studioOptions}
                  fullWidth
                  clearable={false}
                  triggerBg="var(--color-bg)"
                  triggerClassName="py-2"
                />
              </div>
              <div className="w-full md:w-36">
                <label className={LABEL}>Role</label>
                <SimpleSelect
                  value={inviteRole}
                  onChange={v => setInviteRole(v as Role)}
                  options={isSuperAdmin ? SUPER_ROLE_OPTIONS : BASE_ROLE_OPTIONS}
                  fullWidth
                  clearable={false}
                  disabled={isNewStudio}
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

interface UserGroupRowsProps {
  group: UserGroup
  isExpanded: boolean
  studioCount: number
  onToggle: () => void
  isSuperAdmin: boolean
  currentUserId: string
  updatingRoleId: string | null
  onChangeRole: (member: Member, newRole: Role) => void
  onRemove: (member: Member) => void
}

function UserGroupRows({
  group,
  isExpanded,
  studioCount,
  onToggle,
  isSuperAdmin,
  currentUserId,
  updatingRoleId,
  onChangeRole,
  onRemove,
}: UserGroupRowsProps) {
  const summary = roleSummary(group.memberships)

  return (
    <>
      {/* Header row — click anywhere to expand */}
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-[var(--color-surface)] transition-colors"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <td className="px-4 md:px-6 py-3">
          <div className="flex items-center gap-2.5">
            <ChevronRight
              size={16}
              className="flex-shrink-0 transition-transform"
              style={{
                color: 'var(--color-text-muted)',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
            <div
              className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {group.avatar_url ? (
                <img src={group.avatar_url} alt={group.email} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-xs font-semibold">{group.email.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <span style={{ color: 'var(--color-text-body)' }}>{group.email}</span>
          </div>
        </td>
        <td className="px-4 md:px-6 py-3">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {studioCount} studio{studioCount === 1 ? '' : 's'}
          </span>
        </td>
        <td className="px-4 md:px-6 py-3">
          <span className="text-sm" style={{ color: 'var(--color-text-body)' }}>{summary}</span>
        </td>
        <td className="px-4 md:px-6 py-3" />
      </tr>

      {/* Expanded membership rows */}
      {isExpanded && group.memberships.map(member => {
        const canEditRole = (isSuperAdmin || (member.role !== 'super_admin' && member.user_id !== currentUserId)) && member.user_id !== currentUserId
        const canRemove = member.role !== 'super_admin' && member.user_id !== currentUserId
        return (
          <tr
            key={member.id}
            style={{
              borderTop: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <td className="px-4 md:px-6 py-2.5" style={{ paddingLeft: '56px' }}>
              <span className="text-sm" style={{ color: 'var(--color-text-body)' }}>{member.studio_name}</span>
            </td>
            <td className="px-4 md:px-6 py-2.5" />
            <td className="px-4 md:px-6 py-2.5">
              {canEditRole ? (
                <div style={{ width: 150 }}>
                  <SimpleSelect
                    value={member.role}
                    onChange={v => onChangeRole(member, v as Role)}
                    options={isSuperAdmin ? SUPER_ROLE_OPTIONS : BASE_ROLE_OPTIONS}
                    clearable={false}
                    disabled={updatingRoleId === member.id}
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
            <td className="px-2 py-2.5 text-center">
              {canRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(member)}
                  className="p-1 transition-colors"
                  style={{ color: '#dc2626' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#b91c1c'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#dc2626'}
                  title="Remove from this studio"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

interface RoleChangeConfirmModalProps {
  email: string
  studioName: string
  currentRole: Role
  newRole: Role
  isConfirming: boolean
  onConfirm: () => void
  onCancel: () => void
}

function RoleChangeConfirmModal({
  email,
  studioName,
  currentRole,
  newRole,
  isConfirming,
  onConfirm,
  onCancel,
}: RoleChangeConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-150"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="px-6 pt-6 pb-4">
          <p className="text-base font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Change role at {studioName}?
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{email}</span>{' '}
            is currently <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{ROLE_LABELS[currentRole]}</span>{' '}
            in {studioName}. Change their role to{' '}
            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{ROLE_LABELS[newRole]}</span>?
          </p>
        </div>
        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onCancel}
            disabled={isConfirming}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isConfirming}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-accent)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
          >
            {isConfirming ? 'Updating…' : 'Change role'}
          </button>
        </div>
      </div>
    </div>
  )
}
