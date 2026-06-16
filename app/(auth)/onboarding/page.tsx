'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, Copy, Trash2, Check, AlertCircle, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast-provider'
import { completeStudioOnboarding } from '@/app/actions'
import type { OnboardingStudioInput } from '@/lib/types'
import { makeEmptyStudio } from '@/components/onboarding/onboarding-types'
import { StepBusinessProfile } from '@/components/onboarding/step-business-profile'
// Integrations step is hidden — Myrrh provisions GHL sub-accounts and Retell agents
// for clients now, so owners no longer paste IDs/keys in the wizard. The
// step-integrations.tsx component and the GHL/Retell fields on OnboardingStudioInput
// are intentionally left in place — re-arm by adding 'Integrations' back to STEPS,
// re-adding the import below, and re-adding the `step === N && <StepIntegrations…/>` render.
// import { StepIntegrations } from '@/components/onboarding/step-integrations'
import { StepLeadSources } from '@/components/onboarding/step-lead-sources'
import { StepSchedule } from '@/components/onboarding/step-schedule'

const STEPS = ['Business Profile', 'Lead Sources', 'Schedule'] as const

// Address-only key, matches the server-side onboardingDupeKey in app/actions.ts.
// Name is intentionally excluded — "Duplicate location" appends " (copy)" to the
// name, so including it would let identical-address dupes slip past this guard.
function dupeKey(s: OnboardingStudioInput): string {
  return [s.street_address, s.city, s.state, s.postal_code, s.country]
    .map(v => (v ?? '').trim().toLowerCase())
    .join('|')
}

export default function OnboardingPage() {
  const router = useRouter()
  const { showError } = useToast()

  const [studios, setStudios] = useState<OnboardingStudioInput[]>([makeEmptyStudio()])
  // Per-studio flag: true while the timezone still tracks the state auto-default.
  const [timezoneAuto, setTimezoneAuto] = useState<boolean[]>([true])
  const [activeIndex, setActiveIndex] = useState(0)
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  // Names of sources whose detail field is blank when the user clicks Next out
  // of the Lead Sources step. Shown in a soft confirm so they can fill in now
  // or proceed (sales call covers gaps). Scoped to the active studio — each
  // studio's Lead Sources step is visited individually.
  const [pendingMissingDetail, setPendingMissingDetail] = useState<string[] | null>(null)

  const active = studios[activeIndex]

  function patchActive(patch: Partial<OnboardingStudioInput>) {
    setStudios(prev => prev.map((s, i) => (i === activeIndex ? { ...s, ...patch } : s)))
  }

  function markTimezoneOverridden() {
    setTimezoneAuto(prev => prev.map((v, i) => (i === activeIndex ? false : v)))
  }

  function addLocation() {
    const fresh = makeEmptyStudio()
    setStudios(prev => [...prev, fresh])
    setTimezoneAuto(prev => [...prev, true])
    setActiveIndex(studios.length)
    setStep(0)
  }

  function duplicateLocation() {
    const clone: OnboardingStudioInput = {
      ...active,
      name: active.name ? `${active.name} (copy)` : '',
      appointment_slots: Object.fromEntries(
        Object.entries(active.appointment_slots).map(([d, times]) => [d, [...times]]),
      ),
      sources: active.sources.map(s => ({ ...s })),
    }
    setStudios(prev => [...prev, clone])
    // A duplicate inherits the source's timezone explicitly — treat as overridden.
    setTimezoneAuto(prev => [...prev, false])
    setActiveIndex(studios.length)
    setStep(0)
  }

  function removeLocation(index: number) {
    if (studios.length === 1) return
    setStudios(prev => prev.filter((_, i) => i !== index))
    setTimezoneAuto(prev => prev.filter((_, i) => i !== index))
    setActiveIndex(prev => {
      const next = prev >= index && prev > 0 ? prev - 1 : prev
      return Math.min(next, studios.length - 2)
    })
    setStep(0)
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!active.name.trim()) return 'Please enter a studio name.'
      if (!active.street_address.trim()) return 'Please enter a street address.'
      if (!active.country.trim()) return 'Please select a country.'
      if (!active.state.trim()) return 'Please select a state.'
      if (!active.city.trim()) return 'Please enter a city.'
      if (!active.postal_code.trim()) return 'Please enter a postal / zip code.'
    }
    return null
  }

  // Cheap UX-gate: disable Next on step 0 when country is blank so the dependent
  // region picker isn't sitting there empty. validateStep() above still catches
  // the rest if the user somehow gets past this.
  const nextDisabled = step === 0 && !active.country.trim()

  function goNext() {
    const err = validateStep()
    if (err) { showError(err); return }

    // Leaving the Lead Sources step (index 1): soft-confirm any selected source
    // with an empty detail field. Owners can fill now or proceed; sales call
    // covers gaps. Walk-In and other 'none'-kind sources are exempt.
    if (step === 1) {
      const missing = active.sources
        .filter(src => src.kind !== 'none' && !src.value.trim())
        .map(src => src.name)
      if (missing.length > 0) {
        setPendingMissingDetail(missing)
        return
      }
    }

    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  function goBack() {
    setStep(s => Math.max(s - 1, 0))
  }

  async function handleSubmit() {
    // Validate every location, not just the active one.
    for (let i = 0; i < studios.length; i++) {
      const s = studios[i]
      if (!s.name.trim() || !s.street_address.trim() || !s.city.trim() || !s.state.trim() || !s.postal_code.trim()) {
        showError(`Location ${i + 1} is missing required business profile details.`)
        setActiveIndex(i)
        setStep(0)
        return
      }
    }

    // Block duplicate physical address across the submitted set. Matches the
    // server-side dedupe so the user gets immediate feedback before submit.
    const seen = new Set<string>()
    for (let i = 0; i < studios.length; i++) {
      const key = dupeKey(studios[i])
      if (seen.has(key)) {
        showError('Two locations share the same physical address. Please give each location a unique address.')
        setActiveIndex(i)
        setStep(0)
        return
      }
      seen.add(key)
    }

    setSubmitting(true)
    try {
      const result = await completeStudioOnboarding(studios)
      // Server returns { error } for user-facing validation failures (instead of
      // throwing, which Next.js production masks). Genuine unexpected throws are
      // still caught by the catch below.
      if ('error' in result) {
        showError(result.error)
        setSubmitting(false)
        return
      }
      const supabase = createClient()
      // Refresh the session so the new studio_setup_complete flag lands in the JWT.
      await supabase.auth.refreshSession()
      router.push('/leads')
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  const isLastStep = step === STEPS.length - 1
  const isLastLocation = activeIndex === studios.length - 1

  return (
    <div className="w-full max-w-2xl">
      {pendingMissingDetail && (
        <MissingSourceDetailModal
          sourceNames={pendingMissingDetail}
          onCancel={() => setPendingMissingDetail(null)}
          onContinue={() => {
            setPendingMissingDetail(null)
            setStep(s => Math.min(s + 1, STEPS.length - 1))
          }}
        />
      )}

      <div className="rounded-xl shadow-sm overflow-hidden" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>

        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Set up your studio</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Tell us about your studio so we can get your dashboard ready.
          </p>

          {/* Location tabs (multi-studio) */}
          {studios.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {studios.map((s, i) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: i === activeIndex ? 'var(--color-accent)' : 'var(--color-surface)',
                    color: i === activeIndex ? '#ffffff' : 'var(--color-text-secondary)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => { setActiveIndex(i); setStep(0) }}
                    className="truncate max-w-[140px]"
                  >
                    {s.name.trim() || `Location ${i + 1}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLocation(i)}
                    aria-label={`Remove location ${i + 1}`}
                    className="p-1 rounded-full transition-opacity hover:opacity-70"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Step progress */}
          <div className="flex items-center gap-2 mt-4">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold"
                    style={{
                      backgroundColor: i < step ? 'var(--color-accent)' : i === step ? 'var(--color-accent)' : 'var(--color-surface)',
                      color: i <= step ? '#ffffff' : 'var(--color-text-muted)',
                      border: i > step ? '1px solid var(--color-border)' : 'none',
                    }}
                  >
                    {i < step ? <Check size={13} /> : i + 1}
                  </span>
                  <span
                    className="text-xs font-medium truncate hidden sm:block"
                    style={{ color: i === step ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
                  >
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="flex-1 h-px" style={{ backgroundColor: i < step ? 'var(--color-accent)' : 'var(--color-border)' }} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step body */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
          {step === 0 && (
            <StepBusinessProfile studio={active} timezoneAuto={timezoneAuto[activeIndex]} onChange={patchActive} />
          )}
          {step === 1 && <StepLeadSources studio={active} onChange={patchActive} />}
          {step === 2 && (
            <StepSchedule studio={active} onChange={patchActive} onTimezoneOverride={markTimezoneOverridden} />
          )}
        </div>

        {/* Footer nav */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ backgroundColor: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}>
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0 || submitting}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
          >
            <ChevronLeft size={16} />
            Back
          </button>

          {/* Multi-location controls live on the last step */}
          {isLastStep && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={addLocation}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
              >
                <Plus size={15} />
                Add location
              </button>
              <button
                type="button"
                onClick={duplicateLocation}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
              >
                <Copy size={15} />
                Duplicate
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {!isLastStep ? (
              <button
                type="button"
                onClick={goNext}
                disabled={nextDisabled}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--color-accent)' }}
                onMouseEnter={e => { if (!nextDisabled) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)' }}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
              >
                Next
                <ChevronRight size={16} />
              </button>
            ) : !isLastLocation ? (
              <button
                type="button"
                onClick={() => { setActiveIndex(i => i + 1); setStep(0) }}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: 'var(--color-accent)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
              >
                Next location
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 transition-colors"
                style={{ backgroundColor: 'var(--color-accent)' }}
                onMouseEnter={e => { if (!submitting) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)' }}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
              >
                {submitting ? 'Setting up…' : 'Finish setup'}
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="text-center text-xs mt-4" style={{ color: 'var(--color-text-muted)' }}>
        Have multiple studios? Add each location before finishing.
      </p>
    </div>
  )
}

interface MissingSourceDetailModalProps {
  sourceNames: string[]
  onCancel: () => void
  onContinue: () => void
}

function MissingSourceDetailModal({ sourceNames, onCancel, onContinue }: MissingSourceDetailModalProps) {
  const isPlural = sourceNames.length > 1
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      <div
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-150"
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
        >
          <X size={20} />
        </button>

        <div className="px-6 pt-6 pb-4">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: 'rgba(203,145,47,0.12)' }}
          >
            <AlertCircle size={20} style={{ color: '#CB912F' }} />
          </div>

          <p className="text-base font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
            {isPlural ? 'Some lead source details are blank' : 'A lead source detail is blank'}
          </p>
          <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            You can fill {isPlural ? 'these' : 'this'} in now or during your onboarding call. We&apos;ll save what you have and you can update details from Settings later.
          </p>

          <div
            className="rounded-lg p-3 text-sm"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <span style={{ color: 'var(--color-text-primary)' }}>{sourceNames.join(', ')}</span>
          </div>
        </div>

        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'}
          >
            Go back and fill
          </button>
          <button
            onClick={onContinue}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ backgroundColor: 'var(--color-accent)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent-hover)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-accent)'}
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  )
}
