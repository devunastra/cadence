'use client'

import { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SimpleSelect } from '@/components/simple-select'
import { useCurrentStudio } from '@/components/studio-context'
import { TIMEZONE_OPTIONS } from '@/components/onboarding/onboarding-types'
import type { Studio } from '@/lib/types'

const US_STATE_OPTIONS = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
].map(s => ({ value: s, label: s }))

interface BusinessProfileFormProps {
  studio: Studio
}

const INPUT = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-base md:text-sm text-[var(--color-text-primary)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]'
const LABEL = 'block text-sm font-medium text-[var(--color-text-secondary)] mb-1'

export function BusinessProfileForm({ studio }: BusinessProfileFormProps) {
  const { updateCurrentStudio } = useCurrentStudio()
  const [name, setName] = useState(studio.name)
  const [streetAddress, setStreetAddress] = useState(studio.street_address ?? '')
  const [city, setCity] = useState(studio.city ?? '')
  const [postalCode, setPostalCode] = useState(studio.postal_code ?? '')
  const [state, setState] = useState(studio.state ?? '')
  const [country, setCountry] = useState(studio.country ?? '')
  const [ghlId, setGhlId] = useState(studio.ghl_account_id)
  const [ghlApiKey, setGhlApiKey] = useState(studio.ghl_api_key ?? '')
  const [showGhlApiKey, setShowGhlApiKey] = useState(false)
  const [calendarId, setCalendarId] = useState(studio.ghl_calendar_id ?? '')
  const [retellId, setRetellId] = useState(studio.retell_agent_id)
  const [retellApiKey, setRetellApiKey] = useState(studio.retell_api_key ?? '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [timezone, setTimezone] = useState<string>(studio.timezone)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase
      .from('studios')
      .update({
        name,
        street_address: streetAddress,
        city,
        postal_code: postalCode,
        state,
        country,
        ghl_account_id: ghlId,
        ghl_api_key: ghlApiKey || null,
        ghl_calendar_id: calendarId,
        retell_agent_id: retellId,
        retell_api_key: retellApiKey || null,
        timezone,
      })
      .eq('id', studio.id)

    setSaving(false)
    if (error) {
      setError(error.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      updateCurrentStudio({ name, city, state, timezone })
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit}>
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>

          {/* Studio Name */}
          <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div>
              <label htmlFor="name" className={LABEL}>Studio Name</label>
              <input id="name" type="text" value={name} onChange={e => setName(e.target.value)} className={INPUT} />
            </div>
          </div>

          {/* Location */}
          <div className="px-6 py-5 space-y-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div>
              <label htmlFor="streetAddress" className={LABEL}>Street Address</label>
              <input id="streetAddress" type="text" value={streetAddress} onChange={e => setStreetAddress(e.target.value)} placeholder="e.g. 175 Olde Half Day Road" className={INPUT} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="city" className={LABEL}>City</label>
                <input id="city" type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Lincolnshire" className={INPUT} />
              </div>
              <div>
                <label htmlFor="postalCode" className={LABEL}>Postal / Zip Code</label>
                <input id="postalCode" type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)} placeholder="e.g. 60069" className={INPUT} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="state" className={LABEL}>State / Prov / Region</label>
                <SimpleSelect
                  value={state}
                  onChange={setState}
                  options={US_STATE_OPTIONS}
                  placeholder="Select State"
                  fullWidth
                  triggerBg="var(--color-bg)"
                  triggerClassName="py-2"
                />
              </div>
              <div>
                <label htmlFor="country" className={LABEL}>Country</label>
                <input id="country" type="text" value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. United States" className={INPUT} />
              </div>
            </div>
            <div>
              <label htmlFor="timezone" className={LABEL}>Timezone</label>
              <SimpleSelect
                value={timezone}
                onChange={(v) => { if (v) setTimezone(v) }}
                options={TIMEZONE_OPTIONS}
                placeholder="Select Timezone"
                fullWidth
                triggerBg="var(--color-bg)"
                triggerClassName="py-2"
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>Drives calendar, appointment slots, and analytics date ranges for this studio.</p>
            </div>
          </div>

          {/* Integrations */}
          <div className="px-6 py-5 space-y-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ghlId" className={LABEL}>GHL Account ID</label>
                <input id="ghlId" type="text" value={ghlId} onChange={e => setGhlId(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label htmlFor="calendarId" className={LABEL}>GHL Calendar ID</label>
                <input id="calendarId" type="text" value={calendarId} onChange={e => setCalendarId(e.target.value)} placeholder="e.g. TYARmrJpYZIj4lGbA9iS" className={INPUT} />
              </div>
            </div>
            <div>
              <label htmlFor="ghlApiKey" className={LABEL}>GHL API Key</label>
              <div className="relative">
                <input
                  id="ghlApiKey"
                  type={showGhlApiKey ? 'text' : 'password'}
                  value={ghlApiKey}
                  onChange={e => setGhlApiKey(e.target.value)}
                  placeholder="pit-••••••••••••••••"
                  className={INPUT + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowGhlApiKey(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                >
                  {showGhlApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>Private Integration API Key for this GHL sub-account.</p>
            </div>
            <div>
              <label htmlFor="retellId" className={LABEL}>Retell Agent ID</label>
              <input id="retellId" type="text" value={retellId} onChange={e => setRetellId(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="retellApiKey" className={LABEL}>Retell API Key</label>
              <div className="relative">
                <input
                  id="retellApiKey"
                  type={showApiKey ? 'text' : 'password'}
                  value={retellApiKey}
                  onChange={e => setRetellApiKey(e.target.value)}
                  placeholder="key_••••••••••••••••"
                  className={INPUT + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>Used to sync call data from Retell. Find it in your Retell dashboard under API Keys.</p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ backgroundColor: 'var(--color-surface)' }}>
            {error && <p className="text-sm text-red-600 mr-auto">{error}</p>}
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
