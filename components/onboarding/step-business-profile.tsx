'use client'

import { SimpleSelect } from '@/components/simple-select'
import {
  getCountryOptions,
  getSubdivisionsFor,
  getRegionLabelFor,
  defaultTimezoneForCountryRegion,
} from '@/lib/locale-data'
import type { OnboardingStudioInput } from '@/lib/types'
import { INPUT, LABEL } from './onboarding-types'

interface StepBusinessProfileProps {
  studio: OnboardingStudioInput
  /** True until the owner manually overrides the timezone — keeps it in sync with country/region. */
  timezoneAuto: boolean
  onChange: (patch: Partial<OnboardingStudioInput>) => void
}

const COUNTRY_OPTIONS = getCountryOptions()

export function StepBusinessProfile({ studio, timezoneAuto, onChange }: StepBusinessProfileProps) {
  const subdivisions = getSubdivisionsFor(studio.country)
  const regionLabel = getRegionLabelFor(studio.country)

  function handleCountryChange(country: string) {
    // Country change resets the region (it's now meaningless under a different country).
    const patch: Partial<OnboardingStudioInput> = { country, state: '' }
    if (timezoneAuto) {
      const guess = defaultTimezoneForCountryRegion(country, '')
      if (guess) patch.timezone = guess
    }
    onChange(patch)
  }

  function handleRegionChange(state: string) {
    // Region rarely narrows tz further today, but keep the hook in place for the
    // future. defaultTimezoneForCountryRegion ignores the region for now.
    if (timezoneAuto) {
      const guess = defaultTimezoneForCountryRegion(studio.country, state)
      if (guess) onChange({ state, timezone: guess })
      else onChange({ state })
    } else {
      onChange({ state })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="name" className={LABEL}>
          Studio Name <span className="text-red-500">*</span>
        </label>
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
        <label htmlFor="streetAddress" className={LABEL}>
          Street Address <span className="text-red-500">*</span>
        </label>
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
          <label className={LABEL}>
            Country <span className="text-red-500">*</span>
          </label>
          <SimpleSelect
            value={studio.country}
            onChange={handleCountryChange}
            options={COUNTRY_OPTIONS}
            placeholder="Select country"
            searchable
            searchPlaceholder="Search countries…"
            fullWidth
            triggerBg="var(--color-bg)"
            triggerClassName="py-2"
          />
        </div>
        <div>
          <label className={LABEL}>
            {regionLabel} <span className="text-red-500">*</span>
          </label>
          {subdivisions ? (
            <SimpleSelect
              value={studio.state}
              onChange={handleRegionChange}
              options={subdivisions.options.map(o => ({ value: o, label: o }))}
              placeholder={`Select ${subdivisions.label.toLowerCase()}`}
              searchable
              searchPlaceholder={`Search ${subdivisions.label.toLowerCase()}…`}
              fullWidth
              triggerBg="var(--color-bg)"
              triggerClassName="py-2"
            />
          ) : (
            <input
              type="text"
              value={studio.state}
              onChange={e => handleRegionChange(e.target.value)}
              placeholder="e.g. London"
              className={INPUT}
              disabled={!studio.country}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="city" className={LABEL}>
            City <span className="text-red-500">*</span>
          </label>
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
          <label htmlFor="postalCode" className={LABEL}>
            Postal / Zip Code <span className="text-red-500">*</span>
          </label>
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
    </div>
  )
}
