'use client'

import { Check, Minus } from 'lucide-react'

interface CheckboxProps {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  className?: string
}

export function Checkbox({ checked, indeterminate = false, onChange, className = '' }: CheckboxProps) {
  const active = checked || indeterminate

  return (
    <button
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-center flex-shrink-0 cursor-pointer ${className}`}
      style={{
        width: 15,
        height: 15,
        borderRadius: 4,
        border: `1.5px solid ${active ? 'transparent' : 'var(--color-border-strong)'}`,
        backgroundColor: active ? 'var(--color-accent)' : 'transparent',
        opacity: active ? 1 : 0.55,
        transition: 'none',
        outline: 'none',
      }}
      onFocus={e => (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 2px var(--color-accent-subtle)`}
      onBlur={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
    >
      {indeterminate ? (
        <Minus
          size={9}
          strokeWidth={3}
          color="#fff"
          style={{
            opacity: 1,
            transition: 'none',
          }}
        />
      ) : (
        <Check
          size={9}
          strokeWidth={3}
          color="#fff"
          style={{
            opacity: checked ? 1 : 0,
            transition: 'none',
          }}
        />
      )}
    </button>
  )
}
