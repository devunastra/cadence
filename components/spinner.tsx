export function Spinner() {
  return (
    <>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '3px solid var(--color-border)',
          borderTopColor: 'var(--color-accent)',
          animation: 'spin 0.7s linear infinite',
          flexShrink: 0,
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  )
}

export function SpinnerPage() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <Spinner />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
