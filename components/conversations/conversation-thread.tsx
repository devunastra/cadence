'use client'

import { useState, useEffect, useRef } from 'react'
import { Phone, CalendarDays, Target, UserRound, Zap, AlertTriangle, Volume1, Volume2, VolumeX } from 'lucide-react'
import { Spinner } from '@/components/spinner'
import { EmailThreadCard } from '@/components/conversations/email-thread-card'

// ── Exported types ────────────────────────────────────────────────────────────

export interface GHLMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  dateAdded: string
  messageType: string
  status?: string
  from?: string
  to?: string
  cc?: string | null
  attachments?: string[]
  subject?: string
  meta?: {
    call?: { duration?: number; status?: string }
    email?: { messageIds?: string[]; subject?: string; direction?: string }
  }
  error?: string
  appointment_id?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const STUDIO_TZ = 'America/Chicago'
export const STUDIO_EMAIL = 'info@arthurmurray.info'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0].toUpperCase()).join('')
}

export function resolveEmailDisplay(raw: string | null | undefined, contactEmail: string | null | undefined): string {
  if (!raw) return 'Unknown'
  if (raw === contactEmail) return raw
  if (raw.toLowerCase() === STUDIO_EMAIL) return raw
  return 'Studio mail'
}

export function formatTime24H(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: STUDIO_TZ })
}

function getDateKey(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
}

function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const todayKey = now.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
  const yesterdayKey = new Date(now.getTime() - 86_400_000).toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
  const key = date.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ })
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: STUDIO_TZ })
}

export function channelLabel(type: string): string {
  const t = type?.toLowerCase()
  if (t?.includes('sms') || t?.includes('text')) return 'SMS'
  if (t?.includes('email')) return 'Email'
  if (t?.includes('call')) return 'Call'
  if (t?.includes('phone')) return 'Phone'
  return type ?? ''
}

function isCallMsg(msg: GHLMessage): boolean {
  const t = String(msg.messageType ?? '').toLowerCase()
  return t.includes('call') || t === '3' || t === 'type_call'
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

function isActivityMsg(msg: GHLMessage): boolean {
  const t = String(msg.messageType ?? '').toLowerCase()
  return t.startsWith('type_activity') || t.startsWith('activity_')
}

function activityMeta(messageType: string): { label: string; icon: React.ReactNode } {
  const t = messageType.toLowerCase()
  const iconStyle = { flexShrink: 0 as const }
  if (t.includes('opportunity')) return { label: 'Opportunity', icon: <Target size={12} style={iconStyle} /> }
  if (t.includes('appointment')) return { label: 'Appointment', icon: <CalendarDays size={12} style={iconStyle} /> }
  if (t.includes('contact')) return { label: 'Contact', icon: <UserRound size={12} style={iconStyle} /> }
  return { label: 'Activity', icon: <Zap size={12} style={iconStyle} /> }
}

function isVoicemailMsg(msg: GHLMessage): boolean {
  const t = String(msg.messageType ?? '').toLowerCase()
  if (t.includes('voice') || t === 'voicemail') return true
  if (msg.status?.toLowerCase() === 'voicemail') return true
  if ((t.includes('call') || t === '3') && msg.attachments && msg.attachments.length > 0) return true
  return false
}

// ── Voicemail player ──────────────────────────────────────────────────────────

const BARS = 40
const MIN_BAR = 3
const MAX_BAR = 26
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

function VoicemailPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setSpeedOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [speedDropUp, setSpeedDropUp] = useState(true)
  const [volume, setVolume] = useState(1)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [bars, setBars] = useState<number[]>(() =>
    Array.from({ length: BARS }, (_, i) => {
      const h = 4 + Math.abs(Math.sin(i * 1.9 + 0.8) * Math.cos(i * 0.5 + 1.2)) * 22
      return Math.max(MIN_BAR, Math.min(MAX_BAR, h))
    })
  )

  useEffect(() => {
    let cancelled = false
    async function decode() {
      try {
        const res = await fetch(src)
        const buffer = await res.arrayBuffer()
        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(buffer)
        await ctx.close()
        if (cancelled) return
        const data = decoded.getChannelData(0)
        const blockSize = Math.floor(data.length / BARS)
        const raw = Array.from({ length: BARS }, (_, i) => {
          let sum = 0
          const start = i * blockSize
          for (let j = 0; j < blockSize; j++) sum += Math.abs(data[start + j])
          return sum / blockSize
        })
        const max = Math.max(...raw, 0.001)
        setBars(raw.map(v => MIN_BAR + (v / max) * (MAX_BAR - MIN_BAR)))
        setDuration(decoded.duration)
      } catch { /* CORS or decode failure — keep placeholder bars */ }
    }
    decode()
    return () => { cancelled = true }
  }, [src])

  function toggle() {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { a.play().catch(() => {}); setPlaying(true) }
  }

  function seekTo(clientX: number) {
    const a = audioRef.current
    const el = waveRef.current
    if (!a || !el || !duration) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    a.currentTime = ratio * duration
    setCurrentTime(a.currentTime)
  }

  function handleWaveMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    dragging.current = true
    seekTo(e.clientX)
    function onMove(ev: MouseEvent) { if (dragging.current) seekTo(ev.clientX) }
    function onUp() {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function changeSpeed(s: number) { setSpeed(s); setSpeedOpen(false); if (audioRef.current) audioRef.current.playbackRate = s }
  function changeVolume(v: number) { setVolume(v); if (audioRef.current) audioRef.current.volume = v }
  function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}` }

  const progress = duration > 0 ? currentTime / duration : 0
  const activeBar = Math.floor(progress * BARS)
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const speedLabel = speed === 1 ? '1×' : `${speed}×`
  const controlStyle: React.CSSProperties = { color: 'var(--color-text-muted)', padding: '2px 4px', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color var(--transition-fast)' }

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <audio ref={audioRef} src={src} onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)} onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)} onEnded={() => { setPlaying(false); setCurrentTime(0) }} />
      <div className="flex items-center gap-3">
        <button onClick={toggle} className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-opacity hover:opacity-80" style={{ backgroundColor: 'var(--color-accent)' }}>
          {playing ? (
            <svg width="11" height="13" viewBox="0 0 11 13" fill="white"><rect x="0" y="0" width="3.5" height="13" rx="1" /><rect x="7.5" y="0" width="3.5" height="13" rx="1" /></svg>
          ) : (
            <svg width="11" height="13" viewBox="0 0 11 13" fill="white" style={{ marginLeft: 2 }}><path d="M0 0 L11 6.5 L0 13 Z" /></svg>
          )}
        </button>
        <div ref={waveRef} className="flex-1 flex items-center justify-between cursor-pointer select-none" style={{ height: 28 }} onMouseDown={handleWaveMouseDown}>
          {bars.map((h, i) => (
            <div key={i} style={{ flex: '1 1 0', maxWidth: 3, height: h, borderRadius: 2, pointerEvents: 'none', backgroundColor: i <= activeBar ? 'var(--color-accent)' : 'var(--color-border-strong)' }} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1" style={{ paddingLeft: 48 }}>
        <span style={{ fontSize: 14, color: 'var(--color-text-muted)', minWidth: 60 }}>{fmt(currentTime)} / {fmt(duration)}</span>
        <div className="flex-1" />
        <div ref={speedRef} className="relative">
          <button onClick={() => { const rect = speedRef.current?.getBoundingClientRect(); setSpeedDropUp(!rect || rect.top > 260); setSpeedOpen(o => !o); setVolumeOpen(false) }} style={{ ...controlStyle, fontSize: 14, fontWeight: 600, letterSpacing: '0.01em', color: speed !== 1 ? 'var(--color-accent)' : 'var(--color-text-muted)', minWidth: 28 }}>{speedLabel}</button>
          {speedOpen && (
            <div className="absolute z-50 flex flex-col py-1 rounded-lg shadow-lg" style={{ ...(speedDropUp ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }), left: '50%', transform: 'translateX(-50%)', minWidth: 72, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {SPEED_OPTIONS.map(s => (
                <button key={s} onClick={() => changeSpeed(s)} style={{ fontSize: 14, padding: '4px 12px', textAlign: 'center', color: s === speed ? 'var(--color-accent)' : 'var(--color-text-primary)', fontWeight: s === speed ? 600 : 400, backgroundColor: s === speed ? 'var(--color-accent-subtle)' : 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}>{`${s}×`}</button>
              ))}
            </div>
          )}
        </div>
        <div ref={volumeRef} className="relative" style={{ display: 'none' }}>
          <button onClick={() => { setVolumeOpen(o => !o); setSpeedOpen(false) }} style={{ ...controlStyle, color: volumeOpen ? 'var(--color-accent)' : 'var(--color-text-muted)' }}><VolumeIcon size={13} /></button>
          {volumeOpen && (
            <div className="absolute z-50 flex flex-col items-center py-3 px-2 rounded-lg shadow-lg gap-2" style={{ bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <VolumeIcon size={12} style={{ color: 'var(--color-text-muted)' }} />
              <input type="range" min={0} max={1} step={0.05} value={volume} onChange={e => changeVolume(Number(e.target.value))} style={{ writingMode: 'vertical-lr' as React.CSSProperties['writingMode'], direction: 'rtl', height: 72, width: 4, accentColor: 'var(--color-accent)', cursor: 'pointer' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Voicemail card ─────────────────────────────────────────────────────────────

function VoicemailCard({ msg, isOutbound }: { msg: GHLMessage; isOutbound: boolean }) {
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchRecording() {
      setLoading(true)
      try {
        const res = await fetch(`/api/conversations/messages/${msg.id}/recording`)
        if (!res.ok) { setLoading(false); return }
        const contentType = res.headers.get('content-type') ?? ''
        if (contentType.startsWith('audio/') || contentType.includes('octet-stream')) {
          const blob = await res.blob()
          if (!cancelled) setRecordingUrl(URL.createObjectURL(blob))
        } else {
          const data = await res.json().catch(() => null)
          if (!cancelled) setRecordingUrl(data?.recordingUrl ?? null)
        }
      } catch { /* leave recordingUrl null */ }
      finally { if (!cancelled) setLoading(false) }
    }
    fetchRecording()
    return () => { cancelled = true; if (recordingUrl?.startsWith('blob:')) URL.revokeObjectURL(recordingUrl) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id])

  return (
    <div className="max-w-sm w-80 rounded-2xl" style={{ backgroundColor: isOutbound ? 'var(--color-accent)' : 'var(--color-bubble-inbound)', border: isOutbound ? 'none' : '1px solid var(--color-border)', borderBottomLeftRadius: isOutbound ? undefined : 4, borderBottomRightRadius: isOutbound ? 4 : undefined }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: isOutbound ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--color-border)' }}>
        <Phone size={13} style={{ color: isOutbound ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)', flexShrink: 0 }} />
        <span className="text-sm font-medium" style={{ color: isOutbound ? '#ffffff' : 'var(--color-text-primary)' }}>Voicemail</span>
      </div>
      {loading ? (
        <div className="px-4 py-3 flex items-center gap-2"><Spinner /><span className="text-xs" style={{ color: isOutbound ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}>Loading recording…</span></div>
      ) : recordingUrl ? (
        <VoicemailPlayer src={recordingUrl} />
      ) : (
        <div className="px-4 py-2.5"><p className="text-sm" style={{ color: isOutbound ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)' }}>No recording available</p></div>
      )}
      {msg.body && (
        <div className="px-4 py-2.5" style={{ borderTop: isOutbound ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--color-border)' }}>
          <p className="text-xs mb-1 uppercase tracking-wide" style={{ color: isOutbound ? 'rgba(255,255,255,0.6)' : 'var(--color-text-muted)' }}>Transcript</p>
          <p className="text-sm whitespace-pre-wrap" style={{ color: isOutbound ? 'rgba(255,255,255,0.9)' : 'var(--color-text-secondary)' }}>{msg.body}</p>
        </div>
      )}
    </div>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#448361', '#9065B0', '#C14C8A', '#337EA9', '#CB912F', '#C4554D']

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = getInitials(name || '?')
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
  const sz = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  return (
    <div className={`${sz} rounded-full flex items-center justify-center text-white font-semibold shrink-0`} style={{ backgroundColor: color }}>
      {initials}
    </div>
  )
}

// ── ConversationThread ────────────────────────────────────────────────────────

interface ConversationThreadProps {
  messages: GHLMessage[]
  loading: boolean
  loadingOlder?: boolean
  threadRef: React.RefObject<HTMLDivElement | null>
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
  conversationId?: string | null
  contactId?: string
  contactName?: string
  contactEmail?: string | null
  onOpenApptDetails?: (contactId: string, dateAdded: string, apptId?: string) => void
  onReply?: () => void
  onSent?: (msg: { id: string; direction: 'outbound'; body: string; dateAdded: string; messageType: string }) => void
  msgError?: string | null
}

type ThreadItem = { type: 'separator'; date: string; label: string } | { type: 'message'; msg: GHLMessage }

export function ConversationThread({
  messages,
  loading,
  loadingOlder = false,
  threadRef,
  onScroll,
  conversationId,
  contactId,
  contactName,
  contactEmail,
  onOpenApptDetails,
  onReply,
  onSent,
  msgError,
}: ConversationThreadProps) {
  const [openDetailsId, setOpenDetailsId] = useState<string | null>(null)
  const [detailsBelow, setDetailsBelow] = useState(false)

  const threadItems: ThreadItem[] = []
  let lastDateKey = ''
  for (const msg of messages) {
    const dk = getDateKey(msg.dateAdded)
    if (dk !== lastDateKey) {
      threadItems.push({ type: 'separator', date: dk, label: getDateLabel(msg.dateAdded) })
      lastDateKey = dk
    }
    threadItems.push({ type: 'message', msg })
  }

  return (
    <div ref={threadRef} className="h-full overflow-y-auto px-5 py-4 space-y-3" onScroll={onScroll}>
      {loadingOlder && (
        <div className="flex justify-center pb-2">
          <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? '' : 'justify-end'}`}>
              <div className="h-10 rounded-2xl w-48 animate-pulse" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
            </div>
          ))}
        </div>
      )}

      {!loading && !msgError && messages.length === 0 && (
        <p className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>No messages yet.</p>
      )}

      {threadItems.map((item) => {
        if (item.type === 'separator') {
          return (
            <div key={`sep-${item.date}`} data-date-separator={item.label} className="flex items-center justify-center py-1">
              <span className="px-3 py-1 text-xs font-medium rounded-full select-none" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}>{item.label}</span>
            </div>
          )
        }

        const { msg } = item
        const isOutbound = msg.direction === 'outbound'
        const isActivity = isActivityMsg(msg)
        const isVoicemail = !isActivity && isVoicemailMsg(msg)
        const isCall = !isActivity && !isVoicemail && isCallMsg(msg)
        const isEmail = !isActivity && msg.messageType?.toLowerCase().includes('email')
        const callInfo = isCall ? callStatusLabel(msg.status) : null

        return (
          <div key={msg.id} className={`flex flex-col ${isActivity ? 'items-center' : isEmail ? 'items-stretch' : isOutbound ? 'items-end' : 'items-start'}`}>
            {isActivity ? (
              (() => {
                const isAppt = msg.messageType?.toLowerCase().includes('appointment')
                if (isAppt) {
                  const body = msg.body ?? ''

                  // msg.status is set by our appointment_events system: e.g. "Updated for May 9, 2026 2:00 PM"
                  // Fall back to regex on body for legacy messages
                  const verbMatch = body.match(/\b(created|deleted|cancelled|updated|booked|rescheduled)\b/i)
                  const rawVerb = msg.status || (verbMatch ? verbMatch[1].charAt(0).toUpperCase() + verbMatch[1].slice(1).toLowerCase() : null)

                  // Split "Updated for May 9, 2026 2:00 PM" into verb + date parts
                  const forIdx = rawVerb ? rawVerb.indexOf(' for ') : -1
                  const verbPart = (forIdx > -1 ? rawVerb!.slice(0, forIdx) : rawVerb)?.trim() ?? null
                  const datePart = forIdx > -1 ? rawVerb!.slice(forIdx + 5).trim() : null

                  // Extract appointment name from body — strip and collapse whitespace
                  let apptName = body.trim()
                  if (verbMatch && typeof verbMatch.index === 'number') {
                    apptName = body.slice(0, verbMatch.index).trim()
                    if (apptName.toLowerCase().startsWith('appointment ')) {
                      apptName = apptName.slice(12).trim()
                    }
                  }
                  // Collapse multiple spaces to one
                  apptName = apptName.replace(/\s+/g, ' ').trim()

                  const v = verbPart?.toLowerCase()
                  const isNegative = v === 'deleted' || v === 'cancelled' || v === 'no show' || v === 'invalid'
                  const isPositive = v === 'showed' || v === 'confirmed'
                  const accentColor = isNegative ? '#C4554D' : isPositive ? '#448361' : 'var(--color-text-body)'
                  const chipDate = new Date(msg.dateAdded).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: 'numeric', minute: '2-digit', hour12: true,
                    timeZone: STUDIO_TZ,
                  })

                  return (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm select-none appt-chip" style={{ color: 'var(--color-text-body)' }}>
                      <CalendarDays size={15} style={{ flexShrink: 0, color: accentColor }} />
                      <span className="font-semibold" style={{ color: accentColor }}>
                        Appointment {apptName || 'Appointment'}
                      </span>
                      {verbPart && (
                        <span className="font-medium" style={{ color: accentColor }}>
                          {verbPart}
                        </span>
                      )}
                      {datePart && (
                        <span style={{ color: 'var(--color-text-body)' }}>
                          for {datePart}
                        </span>
                      )}
                      {contactId && onOpenApptDetails && (
                        <button
                          onClick={() => onOpenApptDetails(contactId, msg.dateAdded, msg.appointment_id)}
                          className="ml-1 px-2 py-0.5 rounded-md flex-shrink-0"
                          style={{ fontSize: '0.75rem', color: 'var(--color-accent)', backgroundColor: 'var(--color-accent-subtle)', transition: 'background var(--transition-fast)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(35,131,226,0.2)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-accent-subtle)')}
                        >
                          Details
                        </button>
                      )}
                      <span style={{ color: 'var(--color-text-muted)' }}>{chipDate}</span>
                    </div>
                  )
                }
                return (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs select-none" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}>
                    {activityMeta(msg.messageType).icon}
                    <span>{msg.body || activityMeta(msg.messageType).label}</span>
                  </div>
                )
              })()
            ) : isVoicemail ? (
              <VoicemailCard msg={msg} isOutbound={isOutbound} />
            ) : isCall && callInfo ? (
              <div
                className={isOutbound ? 'chat-bubble-outbound' : 'chat-bubble-inbound'}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Phone size={13} style={{ color: callInfo.success ? (isOutbound ? 'rgba(255,255,255,0.8)' : '#448361') : '#C4554D', flexShrink: 0 }} />
                <span>{callInfo.label}</span>
              </div>
            ) : isEmail ? (
              <EmailThreadCard
                subject={msg.subject ?? msg.meta?.email?.subject ?? '(no subject)'}
                emailIds={msg.meta?.email?.messageIds ?? []}
                contactName={contactName}
                contactEmail={contactEmail ?? undefined}
                conversationId={conversationId}
                contactId={contactId}
                onSent={onSent}
              />
            ) : (
              <div className="flex items-center gap-1.5">
                {isOutbound && msg.status === 'failed' && (
                  <div className="relative group/warn flex-shrink-0">
                    <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                    <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 z-50 hidden group-hover/warn:block w-56 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
                      <p className="font-semibold mb-0.5" style={{ color: '#f59e0b' }}>Delivery failed</p>
                      <p style={{ color: 'var(--color-text-secondary)' }}>{msg.error ?? 'Message could not be delivered.'}</p>
                    </div>
                  </div>
                )}
                <div className={isOutbound ? 'chat-bubble-outbound' : 'chat-bubble-inbound'}>
                  {msg.body}
                </div>
              </div>
            )}

            {!isActivity && !isEmail && (
              <div className="flex items-center gap-1.5 mt-1">
                <div className="relative">
                  <button
                    onClick={(e) => {
                      if (openDetailsId === msg.id) { setOpenDetailsId(null); return }
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      const threadRect = threadRef.current?.getBoundingClientRect()
                      setDetailsBelow(threadRect ? rect.top - threadRect.top < 200 : false)
                      setOpenDetailsId(msg.id)
                    }}
                    className="flex items-center gap-0.5 text-xs transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)')}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)')}
                  >
                    {formatTime24H(msg.dateAdded)}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ marginLeft: 2 }}>
                      <polyline points="2,3.5 5,6.5 8,3.5" />
                    </svg>
                  </button>
                  {openDetailsId === msg.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setOpenDetailsId(null)} />
                      <div className={`absolute ${detailsBelow ? 'top-full mt-2' : 'bottom-full mb-2'} ${isOutbound ? 'right-0' : 'left-0'} z-20 rounded-xl shadow-lg min-w-[220px]`} style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border-strong)' }}>
                        <div className="px-4 py-3">
                          <p className="text-xs font-semibold mb-2.5" style={{ color: 'var(--color-text-primary)' }}>Message Details</p>
                          <div className="space-y-2" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
                            {(() => {
                              const msgIsEmail = msg.messageType?.toLowerCase().includes('email')
                              const fromVal = msg.from ? (msgIsEmail ? resolveEmailDisplay(msg.from, contactEmail) : msg.from) : (msgIsEmail ? (msg.direction === 'inbound' ? (contactEmail ?? 'Unknown') : STUDIO_EMAIL) : 'Unknown')
                              const toVal = msg.to ? (msgIsEmail ? resolveEmailDisplay(msg.to, contactEmail) : msg.to) : (msgIsEmail ? (msg.direction === 'outbound' ? (contactEmail ?? 'Unknown') : STUDIO_EMAIL) : 'Unknown')
                              return (
                                <>
                                  <div className="flex items-start gap-3 text-xs"><span className="shrink-0 w-8" style={{ color: 'var(--color-text-muted)' }}>From</span><span style={{ color: 'var(--color-text-primary)' }}>{fromVal}</span></div>
                                  <div className="flex items-start gap-3 text-xs"><span className="shrink-0 w-8" style={{ color: 'var(--color-text-muted)' }}>To</span><span style={{ color: 'var(--color-text-primary)' }}>{toVal}</span></div>
                                  {msgIsEmail && msg.cc && (
                                    <div className="flex items-start gap-3 text-xs"><span className="shrink-0 w-8" style={{ color: 'var(--color-text-muted)' }}>CC</span><span className="break-all" style={{ color: 'var(--color-text-primary)' }}>{msg.cc}</span></div>
                                  )}
                                </>
                              )
                            })()}
                            <div className="flex items-center gap-2 text-xs">
                              <span style={{ color: 'var(--color-text-muted)' }}>{msg.direction === 'outbound' ? '↑' : '↓'}</span>
                              <span style={{ color: 'var(--color-text-primary)' }}>{msg.direction === 'outbound' ? 'Outbound' : 'Inbound'}</span>
                            </div>
                            <div className="flex items-start gap-2 text-xs">
                              <span style={{ color: 'var(--color-text-muted)' }}>◷</span>
                              <span style={{ color: 'var(--color-text-secondary)' }}>{new Date(msg.dateAdded).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: STUDIO_TZ })}</span>
                            </div>
                            {msg.status && (
                              <div className="flex items-center gap-2 text-xs">
                                <span style={{ color: 'var(--color-text-muted)' }}>✓</span>
                                <span className="capitalize" style={{ color: 'var(--color-text-secondary)' }}>{msg.status}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
