'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { OnboardingStudioInput } from '@/lib/types'
import { INPUT, LABEL, HELP } from './onboarding-types'

interface StepIntegrationsProps {
  studio: OnboardingStudioInput
  onChange: (patch: Partial<OnboardingStudioInput>) => void
}

interface MaskedInputProps {
  id: string
  label: string
  value: string
  placeholder: string
  help: string
  onChange: (v: string) => void
}

function MaskedInput({ id, label, value, placeholder, help, onChange }: MaskedInputProps) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={INPUT + ' pr-10'}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          aria-label={show ? 'Hide key' : 'Show key'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2.5 md:p-1 transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      <p className={HELP} style={{ color: 'var(--color-text-muted)' }}>{help}</p>
    </div>
  )
}

export function StepIntegrations({ studio, onChange }: StepIntegrationsProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Connect your GoHighLevel and Retell accounts. You can find these IDs and keys in each
        platform&apos;s settings — your onboarding specialist can help if you&apos;re unsure.
        Keys are stored securely and never shared.
      </p>

      {/* GoHighLevel */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>GoHighLevel</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ghlAccountId" className={LABEL}>GHL Account ID</label>
            <input
              id="ghlAccountId"
              type="text"
              value={studio.ghl_account_id}
              onChange={e => onChange({ ghl_account_id: e.target.value })}
              placeholder="e.g. slTYdxI…"
              className={INPUT}
            />
            <p className={HELP} style={{ color: 'var(--color-text-muted)' }}>
              The Location / sub-account ID for this studio in GoHighLevel.
            </p>
          </div>
          <div>
            <label htmlFor="ghlCalendarId" className={LABEL}>GHL Calendar ID</label>
            <input
              id="ghlCalendarId"
              type="text"
              value={studio.ghl_calendar_id}
              onChange={e => onChange({ ghl_calendar_id: e.target.value })}
              placeholder="e.g. TYARmrJpYZIj4lGbA9iS"
              className={INPUT}
            />
            <p className={HELP} style={{ color: 'var(--color-text-muted)' }}>
              The calendar appointments will be booked into.
            </p>
          </div>
        </div>
        <MaskedInput
          id="ghlApiKey"
          label="GHL API Key"
          value={studio.ghl_api_key}
          placeholder="pit-••••••••••••••••"
          help="Private Integration API Key for this GHL sub-account. Used to sync contacts and appointments."
          onChange={v => onChange({ ghl_api_key: v })}
        />
      </div>

      {/* Retell */}
      <div className="space-y-4 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        <h3 className="text-sm font-semibold pt-4" style={{ color: 'var(--color-text-primary)' }}>Retell AI</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="retellAgentId" className={LABEL}>Retell Agent ID (Outbound)</label>
            <input
              id="retellAgentId"
              type="text"
              value={studio.retell_agent_id}
              onChange={e => onChange({ retell_agent_id: e.target.value })}
              placeholder="e.g. agent_…"
              className={INPUT}
            />
            <p className={HELP} style={{ color: 'var(--color-text-muted)' }}>
              The voice agent that makes outbound calls to your leads.
            </p>
          </div>
          <div>
            <label htmlFor="retellInboundAgentId" className={LABEL}>Retell Agent ID (Inbound)</label>
            <input
              id="retellInboundAgentId"
              type="text"
              value={studio.retell_inbound_agent_id}
              onChange={e => onChange({ retell_inbound_agent_id: e.target.value })}
              placeholder="e.g. agent_…"
              className={INPUT}
            />
            <p className={HELP} style={{ color: 'var(--color-text-muted)' }}>
              The agent that answers calls to your studio number. Leave blank if not used.
            </p>
          </div>
        </div>
        <div>
          <label htmlFor="retellPhone" className={LABEL}>Retell Phone Number</label>
          <input
            id="retellPhone"
            type="tel"
            value={studio.retell_phone_number}
            onChange={e => onChange({ retell_phone_number: e.target.value })}
            placeholder="e.g. +18475551234"
            className={INPUT}
          />
          <p className={HELP} style={{ color: 'var(--color-text-muted)' }}>
            The phone number your AI agent calls from and receives calls on (E.164 format).
          </p>
        </div>
        <MaskedInput
          id="retellApiKey"
          label="Retell API Key"
          value={studio.retell_api_key}
          placeholder="key_••••••••••••••••"
          help="Used to sync call data from Retell. Find it in your Retell dashboard under API Keys."
          onChange={v => onChange({ retell_api_key: v })}
        />
      </div>
    </div>
  )
}
