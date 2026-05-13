'use client'

import { useEffect } from 'react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
      <p className="text-sm">Something went wrong. Please try again.</p>
      <button
        onClick={reset}
        className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 transition-colors"
      >
        Retry
      </button>
    </div>
  )
}
