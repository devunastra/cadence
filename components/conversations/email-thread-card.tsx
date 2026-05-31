'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { createPortal } from 'react-dom'
import {
  AlignCenter, AlignLeft, AlignRight,
  Bold, ChevronDown, ChevronUp, Forward,
  Italic, Link2, List, ListOrdered,
  Maximize2, Minimize2, MoreHorizontal, MoreVertical,
  Reply, Send, Strikethrough,
  Underline as UnderlineIcon, X,
} from 'lucide-react'
import DOMPurify from 'dompurify'
import { Spinner } from '@/components/spinner'
import { useCurrentStudio } from '@/components/studio-context'
import { EmailEditor, useEmailEditor } from './email-editor'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmailMessage {
  id: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string[]
  cc?: string[]
  subject: string
  body: string
  dateAdded: string
  status?: string
}

interface EmailThreadCardProps {
  subject: string
  emailIds: string[]
  /** Display name for the contact (used instead of raw email for inbound senders) */
  contactName?: string
  /** Contact's email address — prefills the To field in the reply compose box */
  contactEmail?: string
  conversationId?: string | null
  contactId?: string
  onSent?: (msg: { id: string; direction: 'outbound'; body: string; dateAdded: string; messageType: string }) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#448361', '#9065B0', '#C14C8A', '#337EA9', '#CB912F', '#C4554D']

function getAvatarColor(name: string): string {
  if (!name) return AVATAR_COLORS[0]
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  return name
    .replace(/<[^>]+>/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function parseSender(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/)
  if (match) return { name: match[1].trim(), email: match[2].trim() }
  return { name: '', email: raw.trim() }
}

function formatEmailTime(dateStr: string, tz: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  })
}

function formatEmailDateTime(dateStr: string, tz: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  })
}

function stripHtmlToText(html: string): string {
  if (typeof document === 'undefined') return html
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('style, script').forEach(el => el.remove())
  return (div.textContent ?? div.innerText ?? '').replace(/\s+/g, ' ').trim()
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function Avatar({ initials, name }: { initials: string; name: string }) {
  return (
    <div
      className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold select-none"
      style={{ backgroundColor: getAvatarColor(name), color: '#ffffff' }}
    >
      {initials || '?'}
    </div>
  )
}

// ── Individual email row ───────────────────────────────────────────────────────

function EmailRow({
  email,
  open,
  onToggle,
  fullExpand,
  contactName,
  onReply,
  tz,
}: {
  email: EmailMessage
  open: boolean
  onToggle: () => void
  fullExpand: boolean
  contactName?: string
  onReply?: () => void
  tz: string
}) {

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const sender = parseSender(email.from)
  const isInbound = email.direction === 'inbound'
  const displayName = isInbound ? (contactName || sender.name || sender.email) : (sender.name || sender.email)
  const initials = getInitials(displayName)
  const toLine = email.to?.join(', ') ?? ''
  const [showTo, setShowTo] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  const sanitized = DOMPurify.sanitize(email.body, {
    ALLOWED_TAGS: [
      'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li',
      'a', 'span', 'div', 'blockquote', 'h1', 'h2', 'h3', 'h4',
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img',
      'pre', 'code', 'hr', 'sup', 'sub',
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel', 'src', 'alt', 'width', 'height',
      'style', 'class', 'dir', 'align', 'valign', 'colspan', 'rowspan',
    ],
    FORCE_BODY: true,
  })

  const hasOwnBackground = /background-color\s*:/i.test(email.body) || /bgcolor\s*=/i.test(email.body)

  function stripDarkInlineColors(html: string): string {
    if (typeof document === 'undefined') return html
    const div = document.createElement('div')
    div.innerHTML = html
    div.querySelectorAll<HTMLElement>('[style]').forEach(el => {
      const color = el.style.color
      if (!color) return
      // Parse RGB — strip if all channels < 100 (near-black/dark gray)
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
      if (match) {
        const [r, g, b] = [+match[1], +match[2], +match[3]]
        if (r < 100 && g < 100 && b < 100) el.style.removeProperty('color')
      } else if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
        const hex = color.replace('#', '')
        const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16)
        const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16)
        const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16)
        if (r < 100 && g < 100 && b < 100) el.style.removeProperty('color')
      } else if (color === 'black' || color === '#000' || color === '#000000') {
        el.style.removeProperty('color')
      }
    })
    return div.innerHTML
  }

  const previewText = stripHtmlToText(email.body)

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      {/* ── Single-line header — click to toggle body ── */}
      <div
        role="button"
        tabIndex={0}
        className="email-row-header w-full flex items-center gap-2.5 px-4 cursor-pointer select-none"
        style={{ height: 64 }}
        onMouseDown={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onToggle() }}
      >
        <Avatar initials={initials} name={displayName} />

        {/* Sender name — fixed width, never truncates */}
        <span
          className="font-semibold flex-shrink-0"
          style={{ fontSize: 14, color: 'var(--color-text-primary)' }}
        >
          {displayName}
        </span>

        {/* Collapsed: preview text fills remaining space and truncates naturally */}
        {!open && (
          <span
            className="min-w-0 flex-1 truncate"
            style={{ fontSize: 14, color: 'var(--color-text-muted)' }}
          >
            {previewText}
          </span>
        )}

        {/* Expanded: "To: …" toggle, also fills space */}
        {open && (
          <span
            role="button"
            tabIndex={0}
            className="flex items-center gap-0.5 min-w-0 cursor-pointer"
            style={{ fontSize: 13, color: 'var(--color-text-muted)', flex: '1 1 0', overflow: 'hidden' }}
            onMouseDown={e => { e.stopPropagation(); setShowTo(v => !v) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setShowTo(v => !v) } }}
          >
            <span className="truncate">To: {toLine}</span>
            <ChevronDown size={11} style={{ flexShrink: 0, marginLeft: 2 }} />
          </span>
        )}

        {/* Time + icons — always right-aligned, never shrinks */}
        <div
          className="flex items-center gap-0.5 flex-shrink-0 ml-2"
          onMouseDown={e => e.stopPropagation()}
        >
          <span
            title={formatEmailDateTime(email.dateAdded, tz)}
            style={{ fontSize: 13, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', cursor: 'default' }}
          >
            {formatEmailTime(email.dateAdded, tz)}
          </span>

          <div className="relative" ref={menuRef}>
            <button
              ref={menuBtnRef}
              title="More options"
              onMouseDown={e => {
                e.stopPropagation()
                if (!menuOpen) {
                  const rect = menuBtnRef.current!.getBoundingClientRect()
                  setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                }
                setMenuOpen(v => !v)
              }}
              className="email-icon-btn p-2 rounded-md"
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen && menuPos && typeof document !== 'undefined' && createPortal(
              <div
                ref={menuRef}
                className="rounded-lg py-1 shadow-lg"
                style={{
                  position: 'fixed',
                  top: menuPos.top,
                  right: menuPos.right,
                  minWidth: 180,
                  backgroundColor: 'var(--color-bubble-inbound)',
                  border: '1px solid var(--color-border)',
                  zIndex: 9999,
                }}
              >
                {[
                  { label: 'Forward Email', icon: <Forward size={14} /> },
                  { label: 'Forward Thread', icon: <Forward size={14} /> },
                ].map(({ label, icon }) => (
                  <button
                    key={label}
                    onClick={e => { e.stopPropagation(); setMenuOpen(false) }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 transition-colors"
                    style={{ fontSize: 14, color: 'var(--color-text-primary)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{icon}</span>
                    {label}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>
        </div>
      </div>

      {/* Cc line */}
      {open && showTo && email.cc && email.cc.length > 0 && (
        <div className="px-4 pb-1" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Cc: {email.cc.join(', ')}
        </div>
      )}

      {/* Body */}
      {open && (
        <div
          className="px-4 pb-4 email-html-body email-thread-card"
          style={{
            fontSize: 14,
            color: 'var(--color-text-primary)',
            overflowY: 'auto',
            maxHeight: fullExpand ? 'none' : '45vh',
            backgroundColor: 'var(--color-bubble-inbound)',
          }}
        >
          <style>{`
            .email-html-body { word-break: break-word; }
            .email-html-body p { margin: 0 0 0.5em 0; }
            .email-html-body blockquote {
              margin: 8px 0 8px 8px;
              padding-left: 10px;
              border-left: 2px solid var(--color-border-strong);
              color: var(--color-text-secondary);
            }
            .email-html-body a, .email-html-body a * { color: var(--color-accent) !important; text-decoration: underline !important; }
            .dark .email-html-body span,
            .dark .email-html-body div,
            .dark .email-html-body p,
            .dark .email-html-body font,
            .dark .email-html-body td {
              background-color: transparent !important;
            }
            .email-html-body img { max-width: 100%; height: auto; }
            .email-html-body table { border-collapse: collapse; max-width: 100%; }
          `}</style>
          {hasOwnBackground ? (
            <div
              dangerouslySetInnerHTML={{ __html: sanitized }}
              style={{ borderRadius: 6, overflow: 'hidden' }}
            />
          ) : (
            <div dangerouslySetInnerHTML={{ __html: isDark ? stripDarkInlineColors(sanitized) : sanitized }} />
          )}
        </div>
      )}

      {/* Reply button — only on latest row, only when expanded */}
      {open && onReply && (
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onMouseDown={e => { e.stopPropagation(); onReply() }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors"
            style={{ fontSize: 14, backgroundColor: 'var(--color-accent)', color: '#ffffff' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-accent)')}
          >
            <Reply size={14} />
            Reply
          </button>
        </div>
      )}
    </div>
  )
}

// ── Thread body ────────────────────────────────────────────────────────────────

function ThreadBody({
  emails,
  repliesRevealed,
  fullExpand,
  contactName,
  onReply,
  onRevealReplies,
  openMap,
  onToggle,
  tz,
}: {
  emails: (EmailMessage | null)[]
  repliesRevealed: boolean
  fullExpand: boolean
  contactName?: string
  onReply?: () => void
  onRevealReplies: () => void
  openMap: Record<string, boolean>
  onToggle: (id: string) => void
  tz: string
}) {
  const hiddenCount = repliesRevealed ? 0 : emails.filter((e, i) => e !== null && i < emails.length - 1).length

  return (
    <>
      {hiddenCount > 0 && (
        <div
          className="relative flex items-center justify-center"
          style={{ borderBottom: '1px solid var(--color-border)', height: 0 }}
        >
          <button
            className="absolute px-3.5 py-1.5 rounded-full font-medium transition-colors"
            style={{
              fontSize: 13,
              backgroundColor: 'var(--color-surface-hover)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              zIndex: 2,
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-border)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)')}
            onClick={onRevealReplies}
          >
            + {hiddenCount} {hiddenCount === 1 ? 'reply' : 'replies'} earlier
          </button>
        </div>
      )}

      {emails.map((email, i) => {
        if (!email) return null
        const isLatest = i === emails.length - 1
        if (!isLatest && !repliesRevealed) return null
        return (
          <EmailRow
            key={email.id}
            email={email}
            open={openMap[email.id] ?? false}
            onToggle={() => onToggle(email.id)}
            fullExpand={fullExpand}
            contactName={contactName}
            onReply={isLatest ? onReply : undefined}
            tz={tz}
          />
        )
      })}
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

// ── EmailThread: self-contained accordion with its own state ──────────────────

function EmailThread({
  subject,
  emails,
  loading,
  contactName,
  onReply,
  isModal,
  onOpenModal,
  onCloseModal,
  tz,
}: {
  subject: string
  emails: (EmailMessage | null)[]
  loading: boolean
  contactName?: string
  onReply?: () => void
  isModal: boolean
  onOpenModal?: () => void
  onCloseModal?: () => void
  tz: string
}) {
  const [repliesRevealed, setRepliesRevealed] = useState(isModal)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const seenIdsRef = useRef<Set<string>>(new Set())

  // Watch the actual email IDs. When new IDs appear (emails loaded), add them
  // as collapsed. Never touches existing IDs so user toggles are never overwritten.
  const emailIdsKey = emails.map(e => e?.id ?? '').join(',')
  useEffect(() => {
    const realEmails = emails.filter((e): e is EmailMessage => e !== null)
    if (realEmails.length === 0) return
    const incoming = realEmails.filter(e => !seenIdsRef.current.has(e.id))
    if (incoming.length === 0) return
    incoming.forEach(e => seenIdsRef.current.add(e.id))
    setOpenMap(prev => {
      const next = { ...prev }
      incoming.forEach(e => { next[e.id] = isModal })
      return next
    })
    setRepliesRevealed(isModal)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailIdsKey])

  function toggleRow(id: string) {
    setOpenMap(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const allOpen = Object.values(openMap).length > 0 && Object.values(openMap).every(Boolean)

  function toggleAllExpanded() {
    const next = !allOpen
    setOpenMap(prev => Object.fromEntries(Object.keys(prev).map(id => [id, next])))
    if (next) setRepliesRevealed(true)
  }

  const iconBtn = (title: string, onClick: () => void, children: React.ReactNode) => (
    <button
      title={title}
      onClick={onClick}
      className="flex-shrink-0 p-1.5 rounded-md transition-colors"
      style={{ color: 'var(--color-text-muted)' }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
    >
      {children}
    </button>
  )

  return (
    <div
      className={`email-thread-card ${isModal ? 'flex flex-col h-full' : 'w-full rounded-xl'}`}
      style={{
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bubble-inbound)',
        fontSize: 14,
        overflow: isModal ? 'hidden' : 'visible',
        ...(isModal ? {} : {}),
      }}
    >
      {/* Subject bar */}
      <div
        className={`flex items-center justify-between px-4 flex-shrink-0 ${isModal ? '' : 'rounded-t-xl'} overflow-hidden`}
        style={{ height: 52, borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <span className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
          {subject || '(no subject)'}
        </span>
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-3">
          {isModal
            ? iconBtn('Close', () => onCloseModal?.(), <Minimize2 size={14} />)
            : iconBtn('Open in full view', () => onOpenModal?.(), <Maximize2 size={14} />)
          }
          {iconBtn(
            allOpen ? 'Collapse all' : 'Expand all',
            toggleAllExpanded,
            allOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />
          )}
        </div>
      </div>

      {/* Thread */}
      <div className={isModal ? 'overflow-y-auto flex-1' : ''}>
        {loading ? (
          <div className="flex items-center justify-center py-8"><Spinner /></div>
        ) : (
          <ThreadBody
            emails={emails}
            repliesRevealed={repliesRevealed}
            fullExpand={false}
            contactName={contactName}
            onReply={onReply}
            onRevealReplies={() => {
            setRepliesRevealed(true)
            // Auto-open the latest email when revealing hidden replies
            const latest = emails.filter((e): e is EmailMessage => e !== null).at(-1)
            if (latest) setOpenMap(prev => ({ ...prev, [latest.id]: true }))
          }}
            openMap={openMap}
            onToggle={toggleRow}
            tz={tz}
          />
        )}
      </div>
    </div>
  )
}

// ── Inline reply compose box ──────────────────────────────────────────────────

function InlineReplyCompose({
  toEmail,
  subject,
  conversationId,
  contactId,
  onSent,
  onClose,
  onExpand,
}: {
  toEmail: string
  subject: string
  conversationId: string | null | undefined
  contactId: string | undefined
  onSent?: (msg: { id: string; direction: 'outbound'; body: string; dateAdded: string; messageType: string }) => void
  onClose: () => void
  onExpand: () => void
}) {
  const editor = useEmailEditor('Write your reply...')
  const [emailCc, setEmailCc] = useState('')
  const [emailBcc, setEmailBcc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [sending, setSending] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showOverflow) return
    function handleClick(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showOverflow])

  const handleSend = useCallback(async () => {
    if (!editor?.getText().trim() || sending) return
    setSending(true)
    try {
      let convId = conversationId
      if (!convId || !contactId) throw new Error('Missing conversation or contact')

      const bodyPayload: Record<string, string | undefined> = {
        type: 'Email',
        contactId,
        message: editor.getText(),
        htmlBody: editor.getHTML(),
        subject: subject.trim() || '(no subject)',
        emailTo: toEmail || undefined,
      }
      if (showCc && emailCc.trim()) bodyPayload.emailCc = emailCc.trim()
      if (showBcc && emailBcc.trim()) bodyPayload.emailBcc = emailBcc.trim()

      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed')

      onSent?.({
        id: data.messageId ?? `tmp-${Date.now()}`,
        direction: 'outbound',
        body: editor.getText(),
        dateAdded: new Date().toISOString(),
        messageType: 'Email',
      })
      onClose()
    } catch (err) {
      console.error('Reply send failed:', err)
    } finally {
      setSending(false)
    }
  }, [editor, sending, conversationId, contactId, subject, toEmail, showCc, emailCc, showBcc, emailBcc, onSent, onClose])

  const borderBottom = { borderBottom: '1px solid var(--color-border)' }
  const borderTop = { borderTop: '1px solid var(--color-border)' }

  const tbBtn = (active: boolean) => ({
    padding: '4px 6px',
    borderRadius: 4,
    background: active ? 'var(--color-accent-subtle)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  } as React.CSSProperties)

  const empty = !editor?.getText().trim()

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bubble-inbound)', marginTop: 8 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0" style={{ ...borderBottom, backgroundColor: 'var(--color-surface)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Reply</span>
        <div className="flex items-center gap-0.5">
          <button
            title="Expand"
            onClick={onExpand}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <Maximize2 size={13} />
          </button>
          <button
            title="Discard"
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* To field */}
      <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
        <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>To</span>
        <div className="flex flex-wrap gap-1 flex-1">
          {toEmail ? (
            <span
              className="inline-flex items-center gap-1.5 text-sm px-2.5 py-0.5 rounded-md"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface)' }}
            >
              {toEmail}
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No email address</span>
          )}
        </div>
        <div className="flex gap-1">
          {!showCc && (
            <button onClick={() => setShowCc(true)} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>CC</button>
          )}
          {!showBcc && (
            <button onClick={() => setShowBcc(true)} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>BCC</button>
          )}
        </div>
      </div>

      {/* CC */}
      {showCc && (
        <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
          <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>CC</span>
          <input value={emailCc} onChange={e => setEmailCc(e.target.value)} className="flex-1 bg-transparent focus:outline-none text-base md:text-sm" style={{ color: 'var(--color-text-primary)' }} placeholder="cc@email.com" autoFocus />
          <button onClick={() => { setShowCc(false); setEmailCc('') }}><X size={12} style={{ color: 'var(--color-text-muted)' }} /></button>
        </div>
      )}

      {/* BCC */}
      {showBcc && (
        <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
          <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>BCC</span>
          <input value={emailBcc} onChange={e => setEmailBcc(e.target.value)} className="flex-1 bg-transparent focus:outline-none text-base md:text-sm" style={{ color: 'var(--color-text-primary)' }} placeholder="bcc@email.com" autoFocus />
          <button onClick={() => { setShowBcc(false); setEmailBcc('') }}><X size={12} style={{ color: 'var(--color-text-muted)' }} /></button>
        </div>
      )}

      {/* Subject — prefilled, read-only display */}
      <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
        <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>Subject</span>
        <span className="flex-1 text-sm" style={{ color: 'var(--color-text-primary)' }}>{subject}</span>
      </div>

      {/* Body */}
      <div className="min-h-[100px]" onClick={() => editor?.commands.focus()}>
        <EmailEditor editor={editor} />
      </div>

      {/* Formatting toolbar + send */}
      <div className="flex items-center gap-0.5 px-3 py-2 flex-wrap" style={borderTop}>
        {editor && (
          <>
            <button style={tbBtn(editor.isActive('bold'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run() }} title="Bold"><Bold size={13} /></button>
            <button style={tbBtn(editor.isActive('italic'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }} title="Italic"><Italic size={13} /></button>
            <button style={tbBtn(editor.isActive('underline'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }} title="Underline"><UnderlineIcon size={13} /></button>
            <button style={tbBtn(editor.isActive('strike'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleStrike().run() }} title="Strikethrough"><Strikethrough size={13} /></button>
            <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
            <button style={tbBtn(editor.isActive('bulletList'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBulletList().run() }} title="Bullet list"><List size={13} /></button>
            <button style={tbBtn(editor.isActive('orderedList'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run() }} title="Ordered list"><ListOrdered size={13} /></button>
            <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
            <button style={tbBtn(editor.isActive('link'))} onMouseDown={e => { e.preventDefault(); const url = window.prompt('Link URL:'); if (url) editor.chain().focus().setLink({ href: url }).run() }} title="Insert link"><Link2 size={13} /></button>
            <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />

            {/* Overflow: alignment + clear */}
            <div className="relative" ref={overflowRef}>
              <button style={tbBtn(false)} onClick={() => setShowOverflow(v => !v)} title="More formatting"><MoreHorizontal size={13} /></button>
              {showOverflow && (
                <div className="absolute z-50 rounded-lg shadow-lg py-1 w-44" style={{ bottom: '100%', left: 0, marginBottom: 4, backgroundColor: 'var(--color-bubble-inbound)', border: '1px solid var(--color-border)' }}>
                  <div className="px-3 py-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>Alignment</p>
                    <div className="flex gap-1">
                      <button style={tbBtn(editor.isActive({ textAlign: 'left' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('left').run() }}><AlignLeft size={13} /></button>
                      <button style={tbBtn(editor.isActive({ textAlign: 'center' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('center').run() }}><AlignCenter size={13} /></button>
                      <button style={tbBtn(editor.isActive({ textAlign: 'right' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('right').run() }}><AlignRight size={13} /></button>
                    </div>
                  </div>
                  <div className="mx-2 my-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
                  <button className="w-full text-left px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }} onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetAllMarks().clearNodes().run(); setShowOverflow(false) }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}>Clear formatting</button>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex-1" />

        <button
          onClick={handleSend}
          disabled={empty || sending}
          className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
          style={{
            backgroundColor: empty || sending ? 'var(--color-surface)' : 'var(--color-accent)',
            color: empty || sending ? 'var(--color-text-muted)' : '#fff',
            cursor: empty || sending ? 'not-allowed' : 'pointer',
          }}
        >
          <Send size={13} />
          Send Email
        </button>
      </div>
    </div>
  )
}

// ── Inline reply compose — full-page expand2 modal ────────────────────────────

function InlineReplyModal({
  toEmail,
  subject,
  conversationId,
  contactId,
  onSent,
  onClose,
}: {
  toEmail: string
  subject: string
  conversationId: string | null | undefined
  contactId: string | undefined
  onSent?: (msg: { id: string; direction: 'outbound'; body: string; dateAdded: string; messageType: string }) => void
  onClose: () => void
}) {
  const editor = useEmailEditor('Write your reply...')
  const [emailCc, setEmailCc] = useState('')
  const [emailBcc, setEmailBcc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [sending, setSending] = useState(false)

  const handleSend = useCallback(async () => {
    if (!editor?.getText().trim() || sending) return
    setSending(true)
    try {
      if (!conversationId || !contactId) throw new Error('Missing conversation or contact')
      const bodyPayload: Record<string, string | undefined> = {
        type: 'Email',
        contactId,
        message: editor.getText(),
        htmlBody: editor.getHTML(),
        subject: subject.trim() || '(no subject)',
        emailTo: toEmail || undefined,
      }
      if (showCc && emailCc.trim()) bodyPayload.emailCc = emailCc.trim()
      if (showBcc && emailBcc.trim()) bodyPayload.emailBcc = emailBcc.trim()

      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed')

      onSent?.({
        id: data.messageId ?? `tmp-${Date.now()}`,
        direction: 'outbound',
        body: editor.getText(),
        dateAdded: new Date().toISOString(),
        messageType: 'Email',
      })
      onClose()
    } catch (err) {
      console.error('Reply send failed:', err)
    } finally {
      setSending(false)
    }
  }, [editor, sending, conversationId, contactId, subject, toEmail, showCc, emailCc, showBcc, emailBcc, onSent, onClose])

  const borderBottom = { borderBottom: '1px solid var(--color-border)' }
  const borderTop = { borderTop: '1px solid var(--color-border)' }

  const tbBtn = (active: boolean) => ({
    padding: '4px 6px',
    borderRadius: 4,
    background: active ? 'var(--color-accent-subtle)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  } as React.CSSProperties)

  const empty = !editor?.getText().trim()

  return createPortal(
    <>
      <div className="fixed inset-0 z-[200]" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div
        className="fixed z-[201] flex flex-col rounded-xl overflow-hidden"
        style={{
          width: '75%',
          height: '90%',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'var(--color-bubble-inbound)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        }}
      >
        {/* Modal header */}
        <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={borderBottom}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Reply</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-text-muted)' }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'} onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'} title="Close">
            <Minimize2 size={14} />
          </button>
        </div>

        {/* To */}
        <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
          <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>To</span>
          <div className="flex flex-wrap gap-1 flex-1">
            {toEmail ? (
              <span className="inline-flex items-center gap-1.5 text-sm px-2.5 py-0.5 rounded-md" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface)' }}>{toEmail}</span>
            ) : (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No email address</span>
            )}
          </div>
          <div className="flex gap-1">
            {!showCc && <button onClick={() => setShowCc(true)} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>CC</button>}
            {!showBcc && <button onClick={() => setShowBcc(true)} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>BCC</button>}
          </div>
        </div>

        {showCc && (
          <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
            <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>CC</span>
            <input value={emailCc} onChange={e => setEmailCc(e.target.value)} className="flex-1 bg-transparent focus:outline-none text-base md:text-sm" style={{ color: 'var(--color-text-primary)' }} placeholder="cc@email.com" autoFocus />
            <button onClick={() => { setShowCc(false); setEmailCc('') }}><X size={12} style={{ color: 'var(--color-text-muted)' }} /></button>
          </div>
        )}
        {showBcc && (
          <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
            <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>BCC</span>
            <input value={emailBcc} onChange={e => setEmailBcc(e.target.value)} className="flex-1 bg-transparent focus:outline-none text-base md:text-sm" style={{ color: 'var(--color-text-primary)' }} placeholder="bcc@email.com" autoFocus />
            <button onClick={() => { setShowBcc(false); setEmailBcc('') }}><X size={12} style={{ color: 'var(--color-text-muted)' }} /></button>
          </div>
        )}

        {/* Subject */}
        <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
          <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>Subject</span>
          <span className="flex-1 text-sm" style={{ color: 'var(--color-text-primary)' }}>{subject}</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto" onClick={() => editor?.commands.focus()}>
          <EmailEditor editor={editor} />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-3 py-2 flex-wrap flex-shrink-0" style={borderTop}>
          {editor && (
            <>
              <button style={tbBtn(editor.isActive('bold'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run() }} title="Bold"><Bold size={13} /></button>
              <button style={tbBtn(editor.isActive('italic'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }} title="Italic"><Italic size={13} /></button>
              <button style={tbBtn(editor.isActive('underline'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }} title="Underline"><UnderlineIcon size={13} /></button>
              <button style={tbBtn(editor.isActive('strike'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleStrike().run() }} title="Strikethrough"><Strikethrough size={13} /></button>
              <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
              <button style={tbBtn(editor.isActive('bulletList'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBulletList().run() }} title="Bullet list"><List size={13} /></button>
              <button style={tbBtn(editor.isActive('orderedList'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run() }} title="Ordered list"><ListOrdered size={13} /></button>
              <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
              <button style={tbBtn(editor.isActive('link'))} onMouseDown={e => { e.preventDefault(); const url = window.prompt('Link URL:'); if (url) editor.chain().focus().setLink({ href: url }).run() }} title="Insert link"><Link2 size={13} /></button>
              <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
              <button style={tbBtn(editor.isActive({ textAlign: 'left' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('left').run() }}><AlignLeft size={13} /></button>
              <button style={tbBtn(editor.isActive({ textAlign: 'center' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('center').run() }}><AlignCenter size={13} /></button>
              <button style={tbBtn(editor.isActive({ textAlign: 'right' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('right').run() }}><AlignRight size={13} /></button>
            </>
          )}
          <div className="flex-1" />
          <button
            onClick={handleSend}
            disabled={empty || sending}
            className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
            style={{
              backgroundColor: empty || sending ? 'var(--color-surface)' : 'var(--color-accent)',
              color: empty || sending ? 'var(--color-text-muted)' : '#fff',
              cursor: empty || sending ? 'not-allowed' : 'pointer',
            }}
          >
            <Send size={13} />
            Send Email
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EmailThreadCard({ subject, emailIds, contactName, contactEmail, conversationId, contactId, onSent }: EmailThreadCardProps) {
  const { currentStudio } = useCurrentStudio()
  const tz = currentStudio.timezone
  const [emails, setEmails] = useState<(EmailMessage | null)[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyExpanded, setReplyExpanded] = useState(false)

  const replySubject = subject ? `Re: ${subject.replace(/^(Re:\s*)+/i, '')}` : 'Re: (no subject)'

  useEffect(() => {
    if (!emailIds.length) { setLoading(false); return }

    setLoading(true)
    setEmails(new Array(emailIds.length).fill(null))
    setModal(false)

    const controller = new AbortController()

    Promise.all(
      emailIds.map(id =>
        fetch(`/api/conversations/messages/email/${id}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      setEmails(results as (EmailMessage | null)[])
      setLoading(false)
    })

    return () => controller.abort()
  }, [emailIds.join(',')])

  function openReply() {
    setReplyOpen(true)
    setReplyExpanded(false)
  }

  return (
    <>
      {/* Inline card */}
      <EmailThread
        subject={subject}
        emails={emails}
        loading={loading}
        contactName={contactName}
        onReply={openReply}
        isModal={false}
        onOpenModal={() => setModal(true)}
        tz={tz}
      />

      {/* Inline reply compose box */}
      {replyOpen && !replyExpanded && (
        <InlineReplyCompose
          toEmail={contactEmail ?? ''}
          subject={replySubject}
          conversationId={conversationId}
          contactId={contactId}
          onSent={onSent}
          onClose={() => setReplyOpen(false)}
          onExpand={() => setReplyExpanded(true)}
        />
      )}

      {/* Full-page reply modal (expand2) */}
      {replyOpen && replyExpanded && typeof document !== 'undefined' && (
        <InlineReplyModal
          toEmail={contactEmail ?? ''}
          subject={replySubject}
          conversationId={conversationId}
          contactId={contactId}
          onSent={onSent}
          onClose={() => { setReplyExpanded(false); setReplyOpen(false) }}
        />
      )}

      {/* Thread view modal — completely separate instance with its own state */}
      {modal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0"
          style={{ zIndex: 9998, backgroundColor: 'rgba(0,0,0,0.35)' }}
          onClick={e => { if (e.target === e.currentTarget) setModal(false) }}
        >
          <div
            className="fixed z-[9999] rounded-xl overflow-hidden"
            style={{
              width: '75%',
              height: '90%',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
            }}
          >
            <EmailThread
              subject={subject}
              emails={emails}
              loading={loading}
              contactName={contactName}
              onReply={openReply}
              isModal={true}
              onCloseModal={() => setModal(false)}
              tz={tz}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
