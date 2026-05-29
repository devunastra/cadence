'use client'

import { SimpleSelect } from '@/components/simple-select'
import type { OnboardingStudioInput } from '@/lib/types'
import { INPUT, LABEL, US_STATE_OPTIONS, defaultTimezoneForState } from './onboarding-types'

interface StepBusinessProfileProps {
  studio: OnboardingStudioInput
  // True until the owner manually overrides the timezone — keeps it in sync with state.
  timezoneAuto: boolean
  onChange: (patch: Partial<OnboardingStudioInput>) => void
}

export function StepBusinessProfile({ studio, timezoneAuto, onChange }: StepBusinessProfileProps) {
  function handleStateChange(state: string) {
    // When the timezone is still on its auto default, follow the state selection.
    if (timezoneAuto) {
      onChange({ state, timezone: defaultTimezoneForState(state) })
    } else {
      onChange({ state })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="name" className={LABEL}>Studio Name</label>
        <input
          id="name"
          type="text"
          value={studio.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="e.g. Arthur Murray Lincolnshire"
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="streetAddress" className={LABEL}>Street Address</label>
        <input
          id="streetAddress"
          type="text"
          value={studio.street_address}
          onChange={e => onChange({ street_address: e.target.value })}
          placeholder="e.g. 175 Olde Half Day Road"
          className={INPUT}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="city" className={LABEL}>City</label>
          <input
            id="city"
            type="text"
            value={studio.city}
            onChange={e => onChange({ city: e.target.value })}
            placeholder="e.g. Lincolnshire"
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="postalCode" className={LABEL}>Postal / Zip Code</label>
          <input
            id="postalCode"
            type="text"
            value={studio.postal_code}
            onChange={e => onChange({ postal_code: e.target.value })}
            placeholder="e.g. 60069"
            className={INPUT}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>State / Prov / Region</label>
          <SimpleSelect
            value={studio.state}
            onChange={handleStateChange}
            options={US_STATE_OPTIONS}
            placeholder="Select State"
            fullWidth
            triggerBg="var(--color-bg)"
            triggerClassName="py-2"
          />
        </div>
        <div>
          <label htmlFor="country" className={LABEL}>Country</label>
          <input
            id="country"
            type="text"
            value={studio.country}
            onChange={e => onChange({ country: e.target.value })}
            placeholder="e.g. United States"
            className={INPUT}
          />
        </div>
      </div>
    </div>
  )
}
