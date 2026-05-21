'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { X, ExternalLink, ChevronDown, ChevronUp, Sparkles, AlertTriangle, MessageSquare, Phone, Tag } from 'lucide-react'
import type { CallHistoryRow } from '@/app/actions'
import { formatDateTime } from '@/lib/date-utils'
import { STATUS_COLORS, NOTION_COLORS } from '@/lib/constants'
import { Spinner } from '@/components/spinner'
import { fetchCallTranscriptFull } from '@/app/actions'
import type { RetellTranscriptItem } from '@/app/actions'
import type { CallReview } from '@/lib/types'
import { getMockCallReviewFull, MOCK_CALLS } from '@/lib/mock-data'

// In-memory caches — persist across drawer open/close within the same page session
const transcriptCache = new Map<string, { transcript: string | null; toolCalls: RetellTranscriptItem[] | null }>()
const reviewCache = new Map<string, CallReview | null>()

function formatDurationMSS(seconds: number | null): string {
  if (seconds == null) return '\u2014'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function capitalize(s: string | null): string {
  return s ? s[0].toUpperCase() + s.slice(1) : '\u2014'
}

function getCallResult(call: { disconnected_reason: string | null; picked_up: boolean | null; transferred: boolean | null; appointment_booked: boolean | null }): string | null {
  if (call.disconnected_reason === 'voicemail') return 'Voicemail'
  if (call.disconnected_reason === 'dial_no_answer') return 'No Answer'
  if (call.disconnected_reason === 'dial_busy') return 'Busy'
  if (call.transferred) return 'Transferred'
  if (call.appointment_booked) return 'Booked'
  if (call.disconnected_reason === 'user_hangup') return 'Hung Up'
  if (call.picked_up === true) return 'Completed'
  return null
}

function qualityScoreColor(score: number): string {
  if (score >= 8) return NOTION_COLORS.green.text
  if (score >= 6) return NOTION_COLORS.yellow.text
  return NOTION_COLORS.red.text
}

function Badge({ value, className }: { value: string; className?: string }) {
  const colors = STATUS_COLORS[value]
  if (!colors) {
    return (
      <span
        className="px-2 py-0.5 rounded text-sm font-medium status-bg-gray status-text-gray"
      >
        {capitalize(value)}
      </span>
    )
  }
  return (
    <span className={`px-2 py-0.5 rounded text-sm font-medium ${colors.bg} ${colors.text} ${className ?? ''}`}>
      {capitalize(value)}
    </span>
  )
}

function parseTranscript(raw: string): { speaker: 'agent' | 'user' | 'other'; text: string }[] {
  const result: { speaker: 'agent' | 'user' | 'other'; text: string }[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^agent\s*:/i.test(trimmed)) {
      result.push({ speaker: 'agent', text: trimmed.replace(/^agent\s*:\s*/i, '') })
    } else if (/^user\s*:/i.test(trimmed)) {
      result.push({ speaker: 'user', text: trimmed.replace(/^user\s*:\s*/i, '') })
    } else if (/^\w[\w\s]*:\s/.test(trimmed)) {
      // Non-agent speaker line (e.g. "Michael: Hi") — treat as user
      result.push({ speaker: 'user', text: trimmed.replace(/^\w[\w\s]*:\s*/, '') })
    } else if (result.length > 0 && result[result.length - 1].speaker !== 'other') {
      result[result.length - 1] = {
        ...result[result.length - 1],
        text: result[result.length - 1].text + '\n' + trimmed,
      }
    } else {
      result.push({ speaker: 'other', text: trimmed })
    }
  }
  return result
}

interface CallDetailDrawerProps {
  call: CallHistoryRow
  onClose: () => void
}

export function CallDetailDrawer({ call, onClose }: CallDetailDrawerProps) {
  const [transcriptData, setTranscriptData] = useState<{
    transcript: string | null
    toolCalls: RetellTranscriptItem[] | null
  } | null>(null)
  const [loadingTranscript, setLoadingTranscript] = useState(true)
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [review, setReview] = useState<CallReview | null>(null)
  const [loadingReview, setLoadingReview] = useState(true)
  const [reviewOpen, setReviewOpen] = useState(true)

  useEffect(() => {
    setLoadingTranscript(true)
    setTranscriptData(null)
    // Transcript — use cache if available
    const cachedTranscript = transcriptCache.get(call.id)
    if (cachedTranscript) {
      setTranscriptData(cachedTranscript)
      setLoadingTranscript(false)
    } else {
      setTranscriptData(null)
      fetchCallTranscriptFull(call.id)
        .then(data => {
          const entry = { transcript: data.transcript, toolCalls: data.transcriptWithToolCalls }
          transcriptCache.set(call.id, entry)
          setTranscriptData(entry)
        })
        .catch(() => {
          transcriptCache.set(call.id, { transcript: null, toolCalls: null })
          setTranscriptData({ transcript: null, toolCalls: null })
        })
        .finally(() => setLoadingTranscript(false))
    }

    // Review — synchronous mock data, use cache if available
    if (reviewCache.has(call.id)) {
      setReview(reviewCache.get(call.id) ?? null)
      setLoadingReview(false)
    } else {
      const mockReview = getMockCallReviewFull(call.id)
      reviewCache.set(call.id, mockReview)
      setReview(mockReview)
      setLoadingReview(false)
    }
  }, [call.id])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const mockTranscript = MOCK_CALLS.find(c => c.id === call.id)?.transcript ?? null
  const lines = parseTranscript(transcriptData?.transcript ?? mockTranscript ?? '')

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[70]"
        style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 z-[71] flex flex-col overflow-hidden"
        style={{
          width: 'min(560px, 100vw)',
          backgroundColor: 'var(--color-bg)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.08)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {call.lead_name ?? 'Unknown contact'}
            </h2>
            {call.lead_id && (
              <Link
                href={`/leads/${call.lead_id}`}
                className="flex items-center gap-1 text-xs font-medium flex-shrink-0 transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-accent)' }}
              >
                View Lead <ExternalLink size={12} />
              </Link>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Call details grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <span style={{ color: 'var(--color-text-secondary)' }}>Date/Time</span>
              <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {formatDateTime(call.created_at)}
              </p>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-secondary)' }}>Duration</span>
              <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {formatDurationMSS(call.duration_seconds)}
              </p>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-secondary)' }}>Direction</span>
              <div className="mt-0.5">{call.direction ? <Badge value={call.direction} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}</div>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-secondary)' }}>Sentiment</span>
              <div className="mt-0.5">{call.sentiment ? <Badge value={call.sentiment} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span>}</div>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-secondary)' }}>Result</span>
              <div className="mt-0.5">{(() => { const r = getCallResult(call); return r ? <Badge value={r} /> : <span style={{ color: 'var(--color-text-muted)' }}>{'\u2014'}</span> })()}</div>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-secondary)' }}>Appointment Booked</span>
              <p className="font-medium mt-0.5" style={{
                color: call.appointment_booked == null
                  ? 'var(--color-text-muted)'
                  : call.appointment_booked
                    ? NOTION_COLORS.green.text
                    : 'var(--color-text-primary)'
              }}>
                {call.appointment_booked == null ? '\u2014' : call.appointment_booked ? 'Yes' : 'No'}
              </p>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-secondary)' }}>Quality Score</span>
              <p className="font-medium mt-0.5" style={{
                color: call.quality_score != null
                  ? qualityScoreColor(call.quality_score)
                  : 'var(--color-text-muted)'
              }}>
                {call.quality_score != null ? `${call.quality_score} / 10` : '\u2014'}
              </p>
            </div>
          </div>

          {/* Audio player */}
          {call.recording_url && (
            <div>
              <p className="text-sm mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Recording</p>
              <audio
                controls
                src={call.recording_url}
                style={{ width: '100%', height: 36, accentColor: 'var(--color-accent)', borderRadius: 8, display: 'block' }}
              />
            </div>
          )}

          {/* AI Summary */}
          {call.transcript_summary && (
            <div
              className="rounded-xl"
              style={{ backgroundColor: 'var(--color-accent-subtle)', border: '1px solid rgba(35,131,226,0.15)' }}
            >
              <button
                onClick={() => setSummaryOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
                style={{ color: 'var(--color-accent)' }}
              >
                <span>AI Summary</span>
                {summaryOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {summaryOpen && (
                <div className="px-4 pb-3 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {call.transcript_summary}
                </div>
              )}
            </div>
          )}

          {/* AI Review */}
          {loadingReview && (
            <div className="rounded-xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2 px-4 py-3">
                <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>AI Review</span>
              </div>
              <div className="px-4 pb-4 space-y-2">
                <div className="h-4 rounded skeleton-shimmer" style={{ width: '90%' }} />
                <div className="h-4 rounded skeleton-shimmer" style={{ width: '75%' }} />
                <div className="h-4 rounded skeleton-shimmer" style={{ width: '60%' }} />
              </div>
            </div>
          )}
          {!loadingReview && review && (
            <div
              className="rounded-xl"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <button
                onClick={() => setReviewOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <span className="flex items-center gap-2">
                  <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
                  AI Review
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[review.grade]?.bg} ${STATUS_COLORS[review.grade]?.text}`}>
                    {review.grade}
                  </span>
                </span>
                {reviewOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {reviewOpen && (
                <div className="px-4 pb-4">
                  {/* Summary */}
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    {review.summary}
                  </p>

                  {/* Status flags */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {review.booking_attempted != null && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${review.booking_successful ? 'status-bg-green status-text-green' : review.booking_attempted ? 'status-bg-yellow status-text-yellow' : 'status-bg-gray status-text-gray'}`}>
                        {review.booking_successful ? 'Booking Successful' : review.booking_attempted ? 'Booking Attempted' : 'No Booking Attempt'}
                      </span>
                    )}
                    {review.user_repeats > 0 && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${review.user_repeats >= 3 ? 'status-bg-red status-text-red' : review.user_repeats >= 2 ? 'status-bg-yellow status-text-yellow' : 'status-bg-gray status-text-gray'}`}>
                        {review.user_repeats} Customer Repeat{review.user_repeats !== 1 ? 's' : ''}
                      </span>
                    )}
                    {review.callback_requested && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium status-bg-orange status-text-orange">
                        Callback Requested
                      </span>
                    )}
                    {review.follow_up_needed && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium status-bg-blue status-text-blue">
                        Follow-up Needed
                      </span>
                    )}
                  </div>

                  {/* Follow-up reason — right below the flags */}
                  {review.follow_up_reason && (
                    <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
                      <Phone size={11} className="inline mr-1" />
                      {review.follow_up_reason}
                    </p>
                  )}

                  {/* Agent Mistakes */}
                  {review.agent_mistakes.length > 0 && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <p className="text-xs font-medium mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        <AlertTriangle size={12} /> Agent Mistakes <span className="inline-flex items-center justify-center rounded-full text-[10px] font-semibold" style={{ minWidth: 18, height: 18, padding: '0 5px', backgroundColor: 'rgba(196,85,77,0.15)', color: NOTION_COLORS.red.text }}>{review.agent_mistakes.length}</span>
                      </p>
                      <ul className="text-sm space-y-1 pl-4" style={{ color: 'var(--color-text-secondary)' }}>
                        {review.agent_mistakes.map((m, i) => (
                          <li key={i} className="flex gap-2">
                            <span style={{ color: 'var(--color-text-muted)' }}>{'\u2022'}</span>
                            <span>{m}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Objections */}
                  {review.objections.length > 0 && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <p className="text-xs font-medium mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
                        <MessageSquare size={12} /> Objections Raised <span className="inline-flex items-center justify-center rounded-full text-[10px] font-semibold" style={{ minWidth: 18, height: 18, padding: '0 5px', backgroundColor: 'rgba(201,123,72,0.15)', color: NOTION_COLORS.yellow.text }}>{review.objections.length}</span>
                      </p>
                      <ul className="text-sm space-y-1 pl-4" style={{ color: 'var(--color-text-secondary)' }}>
                        {review.objections.map((o, i) => (
                          <li key={i} className="flex gap-2">
                            <span style={{ color: 'var(--color-text-muted)' }}>{'\u2022'}</span>
                            <span>{o}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Topics */}
                  {review.topics_discussed.length > 0 && (
                    <div className="mt-3 pt-3 flex items-center gap-1.5 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <Tag size={11} style={{ color: 'var(--color-text-muted)' }} />
                      {review.topics_discussed.map((t, i) => (
                        <span key={i} className="px-2 py-0.5 rounded text-xs font-medium status-bg-gray status-text-gray">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Transcript */}
          <div>
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Transcript</p>
            <div
              className="rounded-xl overflow-y-auto px-4 py-3"
              style={{
                maxHeight: 400,
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              {loadingTranscript ? (
                <div className="flex items-center justify-center py-8"><Spinner /></div>
              ) : lines.length > 0 ? (
                <div className="space-y-2">
                  {lines.map((line, i) => {
                    const showLabel = i === 0 || lines[i - 1].speaker !== line.speaker
                    const isUser = line.speaker === 'user'
                    return (
                      <div key={i} className={`flex flex-col mb-3 ${isUser ? 'items-end' : 'items-start'}`}>
                        {line.speaker !== 'other' && showLabel && (
                          <p
                            className={`text-xs font-semibold uppercase tracking-wider mb-1 ${isUser ? 'mr-1' : 'ml-1'}`}
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            {isUser ? 'User' : 'Agent'}
                          </p>
                        )}
                        {line.speaker !== 'other' ? (
                          <div className={isUser ? 'chat-bubble-outbound' : 'chat-bubble-inbound'}>
                            {line.text}
                          </div>
                        ) : (
                          <p className="text-sm italic ml-1" style={{ color: 'var(--color-text-muted)' }}>{line.text}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>
                  No transcript available for this call.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
