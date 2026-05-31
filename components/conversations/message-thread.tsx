'use client'

import { MessageSquare, AlertTriangle } from 'lucide-react'
import { Spinner } from '@/components/spinner'
import { useCurrentStudio } from '@/components/studio-context'
import type React from 'react'

// ── Types shared between conversations page and lead profile ──────────────────

export interface ThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  dateAdded: string
  messageType: string
  status?: string
  attachments?: string[]
  error?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isCallMsg(msg: ThreadMessage): boolean {
  const t = String(msg.messageType ?? '').toLowerCase()
  return t.includes('call') || t === '3' || t === 'type_call'
}

function isActivityMsg(msg: ThreadMessage): boolean {
  const t = String(msg.messageType ?? '').toLowerCase()
  return t.startsWith('type_activity') || t.startsWith('activity_')
}

function isVoicemailMsg(msg: ThreadMessage): boolean {
  const t = String(msg.messageType ?? '').toLowerCase()
  if (t.includes('voice') || t === 'voicemail') return true
  if (msg.status?.toLowerCase() === 'voicemail') return true
  if ((t.includes('call') || t === '3') && msg.attachments && msg.attachments.length > 0) return true
  return false
}

function callStatusLabel(status: string | undefined): { label: string; success: boolean } {
  const s = (status ?? '').toLowerCase().replace(/[-_]/g, ' ')
  if (s === 'completed') return { label: 'Call completed', success: true }
  if (s === 'no answer') return { label: 'No answer', success: false }
  if (s === 'busy') return { label: 'Line busy', success: false }
  if (s === 'failed') return { label: 'Call failed', success: false }
  if (s === 'cancelled' || s === 'canceled') return { label: 'Call cancelled', success: false }
  if (s === 'missed') return { label: 'Missed call', success: false }
  if (status) return { label: status.charAt(0).toUpperCase() + status.slice(1), success: true }
  return { label: 'Call', success: true }
}

function formatTime24H(dateStr: string | null, tz: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  })
}

function getDateKey(dateStr: string, tz: string): string {
  return new Date(dateStr).toLocaleDateString('en-CA', { timeZone: tz })
}

function getDateLabel(dateStr: string, tz: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const todayKey = now.toLocaleDateString('en-CA', { timeZone: tz })
  const yesterdayKey = new Date(now.getTime() - 86_400_000).toLocaleDateString('en-CA', { timeZone: tz })
  const weekAgoKey = new Date(now.getTime() - 6 * 86_400_000).toLocaleDateString('en-CA', { timeZone: tz })
  const key = date.toLocaleDateString('en-CA', { timeZone: tz })
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  if (key >= weekAgoKey) return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz })
}

// ── Thread items builder ──────────────────────────────────────────────────────

type ThreadItem =
  | { type: 'separator'; date: string; label: string }
  | { type: 'message'; msg: ThreadMessage }

function buildThreadItems(messages: ThreadMessage[], tz: string): ThreadItem[] {
  const items: ThreadItem[] = []
  let lastDateKey = ''
  for (const msg of messages) {
    const key = getDateKey(msg.dateAdded, tz)
    if (key !== lastDateKey) {
      lastDateKey = key
      items.push({ type: 'separator', date: key, label: getDateLabel(msg.dateAdded, tz) })
    }
    items.push({ type: 'message', msg })
  }
  return items
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface MessageThreadProps {
  messages: ThreadMessage[]
  loading: boolean
  error?: string | null
  bottomRef?: React.RefObject<HTMLDivElement | null>
  onScroll?: React.UIEventHandler<HTMLDivElement>
  /** Extra content at the top (e.g. "load older" spinner) */
  headerSlot?: React.ReactNode
  contactEmail?: string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MessageThread({
  messages,
  loading,
  error,
  bottomRef,
  onScroll,
  headerSlot,
  contactEmail,
}: MessageThreadProps) {
  const { currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  const threadItems = buildThreadItems(messages, tz)

  return (
    <div
      className="h-full overflow-y-auto px-5 py-4 space-y-3"
      style={{ backgroundColor: 'var(--color-bg)' }}
      onScroll={onScroll}
    >
      {headerSlot}

      {loading && (
        <div className="flex items-center justify-center h-full">
          <Spinner />
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>{error}</p>
      )}

      {!loading && !error && messages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare size={28} className="mb-2 opacity-30" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>No messages yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Start the conversation below</p>
        </div>
      )}

      {!loading && threadItems.map((item, idx) => {
        if (item.type === 'separator') {
          return (
            <div key={`sep-${item.date}`} className="flex items-center justify-center py-1">
              <span
                className="px-3 py-1 text-xs font-medium rounded-full select-none"
                style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}
              >
                {item.label}
              </span>
            </div>
          )
        }

        const { msg } = item
        const isOutbound = msg.direction === 'outbound'
        const isActivity = isActivityMsg(msg)
        const isVoicemail = !isActivity && isVoicemailMsg(msg)
        const isCall = !isActivity && !isVoicemail && isCallMsg(msg)
        const callInfo = isCall ? callStatusLabel(msg.status) : null
        const audioUrl = msg.attachments?.find(a => a?.match(/\.(mp3|wav|ogg|m4a|aac|webm)(\?|$)/i)) ?? msg.attachments?.[0]

        return (
          <div
            key={msg.id}
            className={`flex flex-col ${isActivity ? 'items-center' : isOutbound ? 'items-end' : 'items-start'}`}
          >
            {isActivity ? (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs select-none"
                style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}
              >
                <span>{msg.body || 'Activity'}</span>
              </div>
            ) : isVoicemail ? (
              <div
                className="max-w-sm w-72 rounded-2xl overflow-hidden"
                style={{
                  backgroundColor: isOutbound ? 'var(--color-accent)' : 'var(--color-bubble-inbound)',
                  borderBottomLeftRadius: isOutbound ? undefined : 4,
                  borderBottomRightRadius: isOutbound ? 4 : undefined,
                }}
              >
                <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: (audioUrl || msg.body) ? `1px solid ${isOutbound ? 'rgba(255,255,255,0.2)' : 'var(--color-border)'}` : undefined }}>
                  <span className="text-sm font-medium" style={{ color: isOutbound ? '#ffffff' : 'var(--color-text-primary)' }}>Voicemail</span>
                </div>
                {audioUrl && (
                  <div className="px-4 py-3" style={{ borderBottom: msg.body ? `1px solid ${isOutbound ? 'rgba(255,255,255,0.2)' : 'var(--color-border)'}` : undefined }}>
                    <audio controls src={audioUrl} className="w-full" style={{ height: 36, accentColor: 'var(--color-accent)' }} />
                  </div>
                )}
                {msg.body ? (
                  <div className="px-4 py-2.5">
                    <p className="text-xs mb-1 uppercase tracking-wide" style={{ color: isOutbound ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}>Transcript</p>
                    <p className="text-sm whitespace-pre-wrap" style={{ color: isOutbound ? 'rgba(255,255,255,0.85)' : 'var(--color-text-secondary)' }}>{msg.body}</p>
                  </div>
                ) : !audioUrl ? (
                  <div className="px-4 py-2.5">
                    <p className="text-sm" style={{ color: isOutbound ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}>No recording available</p>
                  </div>
                ) : null}
              </div>
            ) : isCall && callInfo ? (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-full text-sm select-none"
                style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}
              >
                <span style={{ color: callInfo.success ? '#448361' : '#C4554D' }}>●</span>
                <span>{callInfo.label}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {isOutbound && msg.status === 'failed' && (
                  <div className="relative group/warn flex-shrink-0">
                    <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                    <div
                      className="absolute right-full mr-2 top-1/2 -translate-y-1/2 z-50 hidden group-hover/warn:block w-56 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none"
                      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
                    >
                      <p className="font-semibold mb-0.5" style={{ color: '#f59e0b' }}>Delivery failed</p>
                      <p style={{ color: 'var(--color-text-secondary)' }}>{msg.error ?? 'Message could not be delivered.'}</p>
                    </div>
                  </div>
                )}
                <div
                  className="max-w-sm px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words break-all"
                  style={
                    isOutbound
                      ? { backgroundColor: 'var(--color-accent)', color: '#ffffff', borderBottomRightRadius: 4 }
                      : { backgroundColor: 'var(--color-bubble-inbound)', color: 'var(--color-text-primary)', borderBottomLeftRadius: 4 }
                  }
                >
                  {msg.body}
                </div>
              </div>
            )}

            {!isActivity && (
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className="text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                  suppressHydrationWarning
                >
                  {formatTime24H(msg.dateAdded, tz)}
                </span>
              </div>
            )}
          </div>
        )
      })}

      {bottomRef && <div ref={bottomRef} />}
    </div>
  )
}
