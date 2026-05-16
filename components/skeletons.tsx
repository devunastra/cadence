/**
 * Shared skeleton building blocks for loading.tsx files.
 * Uses the .skeleton-shimmer class defined in globals.css.
 */

export function SkeletonBar({ width = '100%', height = 12 }: { width?: string | number; height?: number }) {
  return (
    <div
      className="skeleton-shimmer"
      style={{ width, height, borderRadius: 4, flexShrink: 0 }}
    />
  )
}

export function SkeletonTableRow({ cols = 6 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div
            className="skeleton-shimmer"
            style={{
              height: 14,
              width: i === 0 ? '70%' : i === 1 ? '55%' : '45%',
              borderRadius: 4,
            }}
          />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonTableHeader({ cols = 6 }: { cols?: number }) {
  return (
    <thead
      className="sticky top-0 z-10"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <tr>
        {Array.from({ length: cols }).map((_, i) => (
          <th
            key={i}
            className="pl-3 pr-4 py-3 text-left"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div
              className="skeleton-shimmer"
              style={{ height: 10, width: i === 0 ? 60 : i < 3 ? 80 : 50, borderRadius: 4 }}
            />
          </th>
        ))}
      </tr>
    </thead>
  )
}

export function SkeletonTable({ cols = 6, rows = 8 }: { cols?: number; rows?: number }) {
  return (
    <div
      className="relative flex-1 min-h-0 rounded-xl overflow-hidden shadow-sm"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <div
        className="h-full overflow-hidden no-theme-transition"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <table className="w-full text-sm border-collapse">
          <SkeletonTableHeader cols={cols} />
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <SkeletonTableRow key={i} cols={cols} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function SkeletonTabs({ count = 2, widths }: { count?: number; widths?: number[] }) {
  const defaultWidths = [80, 90, 70, 60, 50]
  return (
    <div
      className="flex items-end flex-shrink-0"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-4 pb-2.5 pt-2">
          <div
            className="skeleton-shimmer"
            style={{
              height: 14,
              width: widths?.[i] ?? defaultWidths[i % defaultWidths.length],
              borderRadius: 4,
            }}
          />
        </div>
      ))}
    </div>
  )
}

export function SkeletonToolbar() {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div
        className="skeleton-shimmer"
        style={{ height: 36, width: 36, borderRadius: 8 }}
      />
      <div
        className="skeleton-shimmer"
        style={{ height: 36, width: 200, borderRadius: 8 }}
      />
      <div
        className="skeleton-shimmer"
        style={{ height: 36, width: 80, borderRadius: 8 }}
      />
    </div>
  )
}

export function SkeletonKpiCard() {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-2"
      style={{
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg)',
      }}
    >
      <div className="skeleton-shimmer" style={{ height: 12, width: 80, borderRadius: 4 }} />
      <div className="skeleton-shimmer" style={{ height: 28, width: 60, borderRadius: 4 }} />
    </div>
  )
}
