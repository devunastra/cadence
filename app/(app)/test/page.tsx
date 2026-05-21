'use client'

import { useEffect, useState } from 'react'
import { Phone, UserPlus, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { SimpleSelect } from '@/components/simple-select'

type CallStatus = 'idle' | 'calling' | 'success' | 'error'
type AgentOption = { id: string; label: string }

export default function TestPage() {
  // ── Agent list (fetched from server-side TEST_AGENTS env var) ──
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)

  // ── Quick Call state ──
  const [quickPhone, setQuickPhone] = useState('')
  const [quickAgentId, setQuickAgentId] = useState<string>('')
  const [quickStatus, setQuickStatus] = useState<CallStatus>('idle')
  const [quickError, setQuickError] = useState('')

  // ── Form state ──
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [requestingDetails, setRequestingDetails] = useState('')
  const [message, setMessage] = useState('')
  const [formAgentId, setFormAgentId] = useState<string>('')
  const [formStatus, setFormStatus] = useState<CallStatus>('idle')
  const [formError, setFormError] = useState('')

  // Load available test agents from server on mount
  useEffect(() => {
    fetch('/api/test-agents')
      .then(r => r.json())
      .then(data => {
        const list: AgentOption[] = data?.agents ?? []
        setAgentOptions(list)
        if (list.length > 0) {
          setQuickAgentId(list[0].id)
          setFormAgentId(list[0].id)
        }
      })
      .catch(err => console.error('Failed to load test agents:', err))
      .finally(() => setAgentsLoading(false))
  }, [])

  const REQUESTING_OPTIONS = ['Just for fun', 'Wedding', 'Special Occasion'] as const

  async function triggerCall(
    phoneNumber: string,
    opts: { name?: string; email?: string; reason?: string; message?: string; agentId?: string },
    setStatus: (s: CallStatus) => void,
    setError: (e: string) => void,
  ) {
    setStatus('calling')
    setError('')

    try {
      const res = await fetch('/api/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, ...opts }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(data.details || data.error || `Error ${res.status}`)
      }

      setStatus('success')
      setTimeout(() => setStatus('idle'), 4000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  function handleQuickCall() {
    if (!quickPhone.trim()) return
    triggerCall(quickPhone.trim(), { agentId: quickAgentId }, setQuickStatus, setQuickError)
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formPhone.trim() || !firstName.trim() || !lastName.trim() || !formEmail.trim()) return
    const fullName = `${firstName.trim()} ${lastName.trim()}`
    triggerCall(
      formPhone.trim(),
      {
        name: fullName,
        email: formEmail.trim(),
        reason: requestingDetails || undefined,
        message: message || undefined,
        agentId: formAgentId,
      },
      setFormStatus,
      setFormError,
    )
  }

  function AgentDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    if (agentsLoading) {
      return (
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
            Which agent should call?
          </label>
          <div className="px-3 py-2.5 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
            Loading agents...
          </div>
        </div>
      )
    }
    if (agentOptions.length === 0) {
      return (
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
            Which agent should call?
          </label>
          <div className="px-3 py-2.5 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: '#C4554D' }}>
            No agents configured. Set TEST_AGENTS env var.
          </div>
        </div>
      )
    }
    return (
      <div>
        <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
          Which agent should call?
        </label>
        <SimpleSelect
          value={value}
          onChange={onChange}
          options={agentOptions.map(a => ({ value: a.id, label: a.label }))}
          placeholder="Select agent…"
          fullWidth
          clearable={false}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="px-5 pt-5 md:pt-10 pb-3 flex-shrink-0">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Test Call Center
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Trigger the AI agent to make outbound calls for testing purposes.
        </p>
      </div>

      <div className="px-5 pb-8 flex flex-col lg:flex-row gap-5 max-w-5xl">
        {/* ── Quick Call Card ── */}
        <div
          className="flex-1 rounded-xl p-6 shadow-sm"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
        >
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-accent-subtle)' }}
            >
              <Phone size={20} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Quick Call
              </h2>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Trigger the agent to call your number
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <AgentDropdown value={quickAgentId} onChange={setQuickAgentId} />
            <div className="flex gap-3">
              <input
                type="tel"
                placeholder="+1 (555) 123-4567"
                value={quickPhone}
                onChange={e => setQuickPhone(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
              <button
                onClick={handleQuickCall}
                disabled={!quickPhone.trim() || !quickAgentId || quickStatus === 'calling'}
              className="px-5 py-2.5 rounded-lg text-sm font-medium text-white flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: quickStatus === 'success' ? '#448361' : 'var(--color-accent)',
                transition: 'var(--transition-fast)',
              }}
              onMouseEnter={e => {
                if (quickStatus !== 'calling' && quickStatus !== 'success')
                  (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-accent-hover)'
              }}
              onMouseLeave={e => {
                if (quickStatus !== 'success')
                  (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-accent)'
              }}
            >
                {quickStatus === 'calling' && <Loader2 size={16} className="animate-spin" />}
                {quickStatus === 'success' && <CheckCircle2 size={16} />}
                {quickStatus === 'calling' ? 'Calling...' : quickStatus === 'success' ? 'Call Initiated' : 'Call Me'}
              </button>
            </div>
          </div>

          {quickStatus === 'error' && (
            <div className="mt-3 flex items-start gap-2 text-sm" style={{ color: '#C4554D' }}>
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{quickError}</span>
            </div>
          )}
        </div>

        {/* ── Signup Simulation Card ── */}
        <div
          className="flex-1 rounded-xl p-6 shadow-sm"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
        >
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-accent-subtle)' }}
            >
              <UserPlus size={20} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Simulate Website Signup
              </h2>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Mock a lead signing up and receiving a call
              </p>
            </div>
          </div>

          <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
            {/* Agent picker */}
            <AgentDropdown value={formAgentId} onChange={setFormAgentId} />

            {/* First Name + Last Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
                  First Name <span style={{ color: '#C4554D' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="First Name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
                  Last Name <span style={{ color: '#C4554D' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="Last Name"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
                Email <span style={{ color: '#C4554D' }}>*</span>
              </label>
              <input
                type="email"
                placeholder="Email"
                value={formEmail}
                onChange={e => setFormEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
                Phone <span style={{ color: '#C4554D' }}>*</span>
              </label>
              <input
                type="tel"
                placeholder="Phone"
                value={formPhone}
                onChange={e => setFormPhone(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>

            {/* Requesting Details — pill buttons */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
                Reason for dancing
              </label>
              <div className="flex gap-2 flex-wrap">
                {REQUESTING_OPTIONS.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRequestingDetails(requestingDetails === option ? '' : option)}
                    className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors"
                    style={{
                      border: '1px solid var(--color-border)',
                      backgroundColor: requestingDetails === option ? 'var(--color-accent)' : 'var(--color-bg)',
                      color: requestingDetails === option ? '#ffffff' : 'var(--color-text-primary)',
                      borderColor: requestingDetails === option ? 'var(--color-accent)' : 'var(--color-border)',
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {/* How can we help? */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
                Anything else we should know?
              </label>
              <textarea
                placeholder="Message"
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={4}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors resize-y"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={!formPhone.trim() || !firstName.trim() || !lastName.trim() || !formEmail.trim() || formStatus === 'calling'}
              className="w-full px-5 py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: formStatus === 'success' ? '#448361' : 'var(--color-accent)',
                transition: 'var(--transition-fast)',
              }}
              onMouseEnter={e => {
                if (formStatus !== 'calling' && formStatus !== 'success')
                  (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-accent-hover)'
              }}
              onMouseLeave={e => {
                if (formStatus !== 'success')
                  (e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-accent)'
              }}
            >
              {formStatus === 'calling' && <Loader2 size={16} className="animate-spin" />}
              {formStatus === 'success' && <CheckCircle2 size={16} />}
              {formStatus === 'calling'
                ? 'Submitting & Calling...'
                : formStatus === 'success'
                  ? 'Signup Simulated — Call Initiated'
                  : 'Submit'}
            </button>

            {formStatus === 'error' && (
              <div className="flex items-start gap-2 text-sm" style={{ color: '#C4554D' }}>
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              This will NOT add the lead to the live database. The AI agent will call the number with the provided context.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
