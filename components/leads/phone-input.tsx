'use client'

import { useState, useRef, useMemo } from 'react'
import { ChevronDown, Check } from 'lucide-react'

interface Country {
  code: string
  flag: string
  dial: string
  name: string
  placeholder: string
}

const COUNTRIES: Country[] = [
  { code: 'US',    flag: '🇺🇸', dial: '1',  name: 'United States',  placeholder: '3125551234'    },
  { code: 'CA',    flag: '🇨🇦', dial: '1',  name: 'Canada',         placeholder: '4165551234'    },
  { code: 'GB',    flag: '🇬🇧', dial: '44', name: 'United Kingdom', placeholder: '07700900123'   },
  { code: 'AU',    flag: '🇦🇺', dial: '61', name: 'Australia',      placeholder: '0412345678'    },
  { code: 'NZ',    flag: '🇳🇿', dial: '64', name: 'New Zealand',    placeholder: '0211234567'    },
  { code: 'DE',    flag: '🇩🇪', dial: '49', name: 'Germany',        placeholder: '015112345678'  },
  { code: 'FR',    flag: '🇫🇷', dial: '33', name: 'France',         placeholder: '0612345678'    },
  { code: 'IT',    flag: '🇮🇹', dial: '39', name: 'Italy',          placeholder: '3123456789'    },
  { code: 'ES',    flag: '🇪🇸', dial: '34', name: 'Spain',          placeholder: '612345678'     },
  { code: 'NL',    flag: '🇳🇱', dial: '31', name: 'Netherlands',    placeholder: '0612345678'    },
  { code: 'JP',    flag: '🇯🇵', dial: '81', name: 'Japan',          placeholder: '09012345678'   },
  { code: 'KR',    flag: '🇰🇷', dial: '82', name: 'South Korea',    placeholder: '01012345678'   },
  { code: 'CN',    flag: '🇨🇳', dial: '86', name: 'China',          placeholder: '13123456789'   },
  { code: 'IN',    flag: '🇮🇳', dial: '91', name: 'India',          placeholder: '9876543210'    },
  { code: 'MY',    flag: '🇲🇾', dial: '60', name: 'Malaysia',       placeholder: '123456789'     },
  { code: 'SG',    flag: '🇸🇬', dial: '65', name: 'Singapore',      placeholder: '91234567'      },
  { code: 'MX',    flag: '🇲🇽', dial: '52', name: 'Mexico',         placeholder: '5512345678'    },
  { code: 'BR',    flag: '🇧🇷', dial: '55', name: 'Brazil',         placeholder: '11987654321'   },
  { code: 'ZA',    flag: '🇿🇦', dial: '27', name: 'South Africa',   placeholder: '0711234567'    },
  { code: 'OTHER', flag: '🌐',  dial: '',   name: 'Other',          placeholder: '15551234567'   },
]

const US    = COUNTRIES[0]
const OTHER = COUNTRIES.find(c => c.code === 'OTHER')!

function parseE164(value: string): { country: Country; local: string } {
  if (!value) return { country: US, local: '' }
  const trimmed = value.trim()
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1)
    const sorted = [...COUNTRIES.filter(c => c.dial)].sort((a, b) => b.dial.length - a.dial.length)
    for (const c of sorted) {
      if (digits.startsWith(c.dial)) return { country: c, local: digits.slice(c.dial.length) }
    }
    // No match — store digits only in Other
    return { country: OTHER, local: digits }
  }
  return { country: US, local: trimmed.replace(/\D/g, '') }
}

interface PhoneInputProps {
  defaultValue?: string
  onChange?: (e164: string) => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  autoFocus?: boolean
}

export function PhoneInput({ defaultValue = '', onChange, onBlur, onKeyDown, autoFocus }: PhoneInputProps) {
  const parsed = parseE164(defaultValue)
  const [country, setCountry] = useState<Country>(parsed.country)
  const [local, setLocal]     = useState(parsed.local)
  const [open, setOpen]       = useState(false)
  const [focused, setFocused] = useState(false)
  const [toast, setToast]     = useState(false)
  const [toastKey, setToastKey] = useState(0)
  const containerRef          = useRef<HTMLDivElement>(null)
  const toastTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isOther = country.code === 'OTHER'

  // Selected country first, rest alphabetically, Other always last
  const sortedCountries = useMemo(() => {
    const rest = COUNTRIES
      .filter(c => c.code !== country.code && c.code !== 'OTHER')
      .sort((a, b) => a.name.localeCompare(b.name))
    return isOther ? [OTHER, ...rest] : [country, ...rest, OTHER]
  }, [country, isOther])

  function showToast() {
    setToast(true)
    setToastKey(k => k + 1)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(false), 2000)
  }

  function emit(c: Country, digits: string) {
    if (!c.dial) {
      onChange?.(digits ? `+${digits}` : '')
      return
    }
    onChange?.(digits ? `+${c.dial}${digits}` : '')
  }

  function handleLocalChange(raw: string) {
    if (isOther) {
      if (/[^0-9]/.test(raw)) showToast()
      const digits = raw.replace(/\D/g, '')
      setLocal(digits)
      onChange?.(digits ? `+${digits}` : '')
      return
    }

    // Named country: detect pasted E.164 and auto-switch
    if (raw.trim().startsWith('+')) {
      const p = parseE164(raw.trim())
      const digits = p.local.replace(/\D/g, '')
      setCountry(p.country)
      setLocal(digits)
      emit(p.country, digits)
      return
    }

    if (/[^0-9]/.test(raw)) showToast()
    const digits = raw.replace(/\D/g, '')
    setLocal(digits)
    emit(country, digits)
  }

  function handleCountrySelect(c: Country) {
    setCountry(c)
    setOpen(false)
    // Reset local when switching to/from Other since format changes
    if ((c.code === 'OTHER') !== isOther) {
      setLocal('')
      onChange?.('')
    } else {
      const digits = local.replace(/\D/g, '')
      emit(c, digits)
    }
  }

  function handleContainerBlur(e: React.FocusEvent) {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false)
      setFocused(false)
      onBlur?.()
    }
  }

  return (
    <div className="relative w-full">
      <div
        ref={containerRef}
        onFocus={() => setFocused(true)}
        onBlur={handleContainerBlur}
        className="flex w-full rounded-lg"
        style={{ border: '1px solid var(--color-border)', boxShadow: focused ? '0 0 0 2px var(--color-accent)' : 'none', backgroundColor: 'var(--color-surface)', overflow: 'visible' }}
      >
        {/* Country selector */}
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex items-center justify-center gap-1 h-full rounded-l-lg transition-colors"
            style={{ width: '76px', flexShrink: 0, borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <span className="text-sm relative -top-px">{country.flag}</span>
            {!isOther && (
              <span className="relative top-[1px] text-xs tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                +{country.dial}
              </span>
            )}
            <ChevronDown size={11} style={{ color: 'var(--color-text-muted)' }} />
          </button>

          {open && (
            <div
              className="absolute left-0 top-full z-[200] mt-1 w-60 rounded-lg shadow-xl"
              style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border-strong)' }}
            >
              <div className="max-h-52 overflow-y-auto">
                {sortedCountries.map(c => (
                  <div key={c.code}>
                    {c.code === 'OTHER' && (
                      <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
                    )}
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => handleCountrySelect(c)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
                      style={{ 
                        color: c.code === country.code ? '#ffffff' : 'var(--color-text-primary)',
                        backgroundColor: c.code === country.code ? 'var(--color-accent)' : 'transparent',
                        transition: 'none'
                      }}
                      onMouseEnter={e => {
                        if (c.code !== country.code) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'
                      }}
                      onMouseLeave={e => {
                        if (c.code !== country.code) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                      }}
                    >
                      <span className="w-6 flex-shrink-0 text-center text-sm relative -top-px">{c.flag}</span>
                      <span className="flex-1 truncate text-xs">{c.name}</span>
                      {c.dial && (
                        <span className="text-xs tabular-nums" style={{ color: c.code === country.code ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}>
                          +{c.dial}
                        </span>
                      )}
                      {c.code === country.code && <Check size={12} style={{ color: '#ffffff' }} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Number input */}
        <div className="flex-1 flex items-center min-w-0 rounded-r-lg overflow-hidden" style={{ backgroundColor: 'var(--color-surface)' }}>
          {isOther && (
            <span className="pl-3 text-sm select-none flex-shrink-0" style={{ color: 'var(--color-text-primary)' }}>+</span>
          )}
          <input
            type="tel"
            autoFocus={autoFocus}
            value={local}
            onChange={e => handleLocalChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={country.placeholder}
            maxLength={15}
            className={`flex-1 py-2 text-sm focus:outline-none ${isOther ? 'pl-1 pr-3' : 'px-3'}`}
            style={{ color: 'var(--color-text-primary)', minWidth: 0, backgroundColor: 'var(--color-surface)' }}
          />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          key={toastKey}
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 text-xs px-2.5 py-1.5 rounded-md z-10 pointer-events-none whitespace-nowrap"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: '#ef4444',
            border: '1px solid rgba(220, 38, 38, 0.3)',
            animation: 'phone-shake 0.4s ease',
          }}
        >
          Use digits only (0–9)
        </div>
      )}
    </div>
  )
}
