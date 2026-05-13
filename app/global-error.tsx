'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px', color: '#6b7280', fontFamily: 'system-ui, sans-serif' }}>
          <p style={{ fontSize: '14px' }}>Something went wrong. Please try again.</p>
          <button
            onClick={reset}
            style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '4px', border: '1px solid #d1d5db', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  )
}
