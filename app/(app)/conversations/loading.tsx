import { SkeletonBar } from '@/components/skeletons'

function ConversationItemSkeleton() {
  return (
    <div
      className="px-4 py-4"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="skeleton-shimmer"
          style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }}
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SkeletonBar width={100} height={12} />
            <SkeletonBar width={40} height={10} />
          </div>
          <SkeletonBar width="80%" height={10} />
        </div>
      </div>
    </div>
  )
}

export default function ConversationsLoading() {
  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      {/* Header */}
      <div
        className="px-5 pt-5 md:pt-10 pb-5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <h1
          className="text-2xl font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Conversations
        </h1>
      </div>
      {/* Two-panel layout (single panel on mobile) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel: conversation list */}
        <div
          className="w-full md:w-[340px] md:shrink-0 flex flex-col"
          style={{ borderRight: '1px solid var(--color-border)' }}
        >
          {/* Search bar placeholder */}
          <div className="p-3">
            <div
              className="skeleton-shimmer"
              style={{ height: 34, width: '100%', borderRadius: 8 }}
            />
          </div>
          {/* Conversation items */}
          {Array.from({ length: 8 }).map((_, i) => (
            <ConversationItemSkeleton key={i} />
          ))}
        </div>
        {/* Right panel: empty state — hidden on mobile */}
        <div className="hidden md:flex flex-1 items-center justify-center">
          <SkeletonBar width={180} height={14} />
        </div>
      </div>
    </div>
  )
}
