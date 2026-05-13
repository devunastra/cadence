import { STATUS_COLORS } from '@/lib/constants'

interface StatusTagProps {
  value: string | null
}

export function StatusTag({ value }: StatusTagProps) {
  if (!value) return <span className="text-gray-300 text-xs">—</span>

  const colors = STATUS_COLORS[value] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} whitespace-nowrap`}
    >
      {value}
    </span>
  )
}
