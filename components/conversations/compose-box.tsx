'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Minus, Maximize2, Minimize2, Bold, Italic, Underline as UnderlineIcon,
  Strikethrough, List, ListOrdered, Link2, Smile, Paperclip,
  ImageIcon, MoreHorizontal, Send, ChevronDown, X, AlignLeft,
  AlignCenter, AlignRight, MessageSquare as MessageSquareIcon, Mail as MailIcon,
} from 'lucide-react'
import { EmailEditor, useEmailEditor } from './email-editor'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Picker: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let emojiData: any = null

export interface SentMessage {
  id: string
  direction: 'outbound'
  body: string
  dateAdded: string
  messageType: string
}

export interface ComposeBoxProps {
  conversationId: string | null
  contactId: string
  contactPhone: string | null
  contactEmail: string | null
  studioEmail?: string
  onSent: (msg: SentMessage) => void
  onConversationCreated?: (convId: string) => void
  /** Call this to programmatically expand + focus the box */
  imperativeRef?: React.RefObject<{ focusSms: () => void; focusEmail?: () => void } | null>
}

type Channel = 'SMS' | 'Email'

export function ComposeBox({
  conversationId,
  contactId,
  contactPhone,
  contactEmail,
  studioEmail = 'info@arthurmurray.info',
  onSent,
  onConversationCreated,
  imperativeRef,
}: ComposeBoxProps) {
  const [expanded, setExpanded] = useState(false)
  const [expanded2, setExpanded2] = useState(false)
  const [channel, setChannel] = useState<Channel>('SMS')
  const [showChannelMenu, setShowChannelMenu] = useState(false)
  const [smsText, setSmsText] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailTo] = useState(contactEmail ?? '')
  const [emailCc, setEmailCc] = useState('')
  const [emailBcc, setEmailBcc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)
  const [sending, setSending] = useState(false)
  const [pickerReady, setPickerReady] = useState(false)

  const smsRef = useRef<HTMLTextAreaElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const overflowButtonRef = useRef<HTMLButtonElement>(null)

  const editor = useEmailEditor()

  // Lazy-load emoji-mart to avoid SSR issues
  useEffect(() => {
    if (!Picker) {
      Promise.all([
        import('@emoji-mart/react'),
        import('@emoji-mart/data'),
      ]).then(([pickerMod, dataMod]) => {
        Picker = pickerMod.default
        emojiData = dataMod.default
        setPickerReady(true)
      })
    } else {
      setPickerReady(true)
    }
  }, [])

  // Expose focus method via ref
  useEffect(() => {
    if (!imperativeRef) return
    imperativeRef.current = {
      focusSms: () => {
        setChannel('SMS')
        setExpanded(true)
        setTimeout(() => smsRef.current?.focus(), 50)
      },
      focusEmail: () => {
        setChannel('Email')
        setExpanded(true)
        setTimeout(() => editor?.commands.focus(), 50)
      },
    }
  }, [imperativeRef])

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showEmojiPicker && !showChannelMenu && !showOverflow) return
    function handleClick(e: MouseEvent) {
      if (
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('.emoji-picker-container')
      ) {
        setShowEmojiPicker(false)
      }
      if (!(e.target as HTMLElement).closest('.channel-menu-container')) {
        setShowChannelMenu(false)
      }
      if (!(e.target as HTMLElement).closest('.overflow-menu-container')) {
        setShowOverflow(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showEmojiPicker, showChannelMenu, showOverflow])

  function insertEmoji(native: string) {
    if (channel === 'SMS') {
      const el = smsRef.current
      if (!el) return
      const start = el.selectionStart ?? smsText.length
      const end = el.selectionEnd ?? smsText.length
      const next = smsText.slice(0, start) + native + smsText.slice(end)
      setSmsText(next)
      setTimeout(() => {
        el.focus()
        el.setSelectionRange(start + native.length, start + native.length)
      }, 0)
    } else {
      editor?.commands.insertContent(native)
    }
    setShowEmojiPicker(false)
  }

  function handleAttach() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,.pdf,.doc,.docx,.txt'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      if (channel === 'SMS') {
        setSmsText(t => t + (t ? '\n' : '') + `[Attachment: ${file.name}]`)
      } else {
        editor?.commands.insertContent(`<p>[Attachment: ${file.name}]</p>`)
      }
    }
    input.click()
  }

  function handleImageInsert() {
    const url = window.prompt('Image URL:')
    if (url) editor?.commands.setImage({ src: url })
  }

  function handleLinkInsert() {
    const url = window.prompt('Link URL:')
    if (url) editor?.commands.setLink({ href: url })
  }

  const handleSend = useCallback(async () => {
    const isEmpty = channel === 'SMS'
      ? !smsText.trim()
      : !editor?.getText().trim()
    if (isEmpty || sending) return

    setSending(true)
    try {
      let convId = conversationId

      // Create conversation if needed
      if (!convId) {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId }),
        })
        const data = await res.json()
        if (!res.ok || !data.conversation?.id) throw new Error(data.error ?? 'Failed to create conversation')
        convId = data.conversation.id as string
        onConversationCreated?.(convId)
      }

      const bodyPayload: Record<string, string | undefined> = {
        type: channel,
        contactId,
        message: channel === 'SMS' ? smsText.trim() : (editor?.getText() ?? ''),
      }

      if (channel === 'Email') {
        bodyPayload.htmlBody = editor?.getHTML()
        bodyPayload.subject = emailSubject.trim() || '(no subject)'
        bodyPayload.emailTo = emailTo.trim() || (contactEmail ?? undefined)
        if (showCc && emailCc.trim()) bodyPayload.emailCc = emailCc.trim()
        if (showBcc && emailBcc.trim()) bodyPayload.emailBcc = emailBcc.trim()
      }

      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed')

      // Optimistic message for UI
      const optimistic: SentMessage = {
        id: data.messageId ?? `tmp-${Date.now()}`,
        direction: 'outbound',
        body: channel === 'SMS' ? smsText.trim() : (editor?.getText() ?? ''),
        dateAdded: new Date().toISOString(),
        messageType: channel === 'SMS' ? 'SMS' : 'Email',
      }
      onSent(optimistic)

      // Clear
      if (channel === 'SMS') {
        setSmsText('')
      } else {
        editor?.commands.clearContent()
        setEmailSubject('')
      }
    } catch (err) {
      console.error('Send failed:', err)
    } finally {
      setSending(false)
    }
  }, [channel, smsText, editor, sending, conversationId, contactId, emailSubject, emailTo, emailCc, emailBcc, showCc, showBcc, contactEmail, onSent, onConversationCreated])

  // ── Shared styles ──────────────────────────────────────────────────────────

  const borderTop = { borderTop: '1px solid var(--color-border)' }
  const borderBottom = { borderBottom: '1px solid var(--color-border)' }

  // ── Channel dropdown ───────────────────────────────────────────────────────

  function ChannelDropdown({ openUp = false }: { openUp?: boolean }) {
    return (
      <div className="relative channel-menu-container">
        <button
          onClick={() => setShowChannelMenu(v => !v)}
          className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
          }}
        >
          {channel === 'SMS'
            ? <MessageSquareIcon size={13} style={{ color: 'var(--color-accent)' }} />
            : <MailIcon size={13} style={{ color: 'var(--color-accent)' }} />}
          {channel}
          <ChevronDown size={12} className="opacity-50" />
        </button>
        {showChannelMenu && (
          <div
            className={`absolute left-0 ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-lg shadow-lg z-50 py-1 w-32`}
            style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
          >
            {(['SMS', 'Email'] as Channel[]).map(ch => (
              <button
                key={ch}
                onClick={() => { setChannel(ch); setShowChannelMenu(false) }}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
                style={{
                  color: channel === ch ? 'var(--color-accent)' : 'var(--color-text-primary)',
                  fontWeight: channel === ch ? 600 : 400,
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              >
                {ch === 'SMS'
                  ? <MessageSquareIcon size={13} style={{ color: 'var(--color-accent)', opacity: 0.7 }} />
                  : <MailIcon size={13} style={{ color: 'var(--color-accent)', opacity: 0.7 }} />}
                {ch}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Send button ────────────────────────────────────────────────────────────

  function SendButton() {
    const empty = channel === 'SMS' ? !smsText.trim() : !editor?.getText().trim()
    return (
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
        {channel === 'Email' ? 'Send Email' : 'Send'}
      </button>
    )
  }

  // ── Bottom action bar ──────────────────────────────────────────────────────

  function BottomBar() {
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

    return (
      <div
        className="flex items-center gap-0.5 px-3 py-2 flex-wrap"
        style={borderTop}
      >
        {/* Formatting — email only */}
        {channel === 'Email' && editor && (
          <>
            <button style={tbBtn(editor.isActive('bold'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run() }} title="Bold">
              <Bold size={13} />
            </button>
            <button style={tbBtn(editor.isActive('italic'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }} title="Italic">
              <Italic size={13} />
            </button>
            <button style={tbBtn(editor.isActive('underline'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }} title="Underline">
              <UnderlineIcon size={13} />
            </button>
            <button style={tbBtn(editor.isActive('strike'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleStrike().run() }} title="Strikethrough">
              <Strikethrough size={13} />
            </button>
            <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
            <button style={tbBtn(editor.isActive('bulletList'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBulletList().run() }} title="Bullet list">
              <List size={13} />
            </button>
            <button style={tbBtn(editor.isActive('orderedList'))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run() }} title="Ordered list">
              <ListOrdered size={13} />
            </button>
            <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
            <button style={tbBtn(editor.isActive('link'))} onMouseDown={e => { e.preventDefault(); handleLinkInsert() }} title="Insert link">
              <Link2 size={13} />
            </button>
            <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
          </>
        )}

        {/* Emoji picker */}
        <div className="relative">
          <button
            ref={emojiButtonRef}
            style={tbBtn(false)}
            onClick={() => setShowEmojiPicker(v => !v)}
            title="Emoji"
          >
            <Smile size={14} />
          </button>
          {showEmojiPicker && pickerReady && Picker && (
            <div
              className="absolute emoji-picker-container"
              style={{ bottom: '100%', left: 0, zIndex: 100, marginBottom: 4 }}
            >
              <Picker
                data={emojiData}
                onEmojiSelect={(emoji: { native: string }) => insertEmoji(emoji.native)}
                theme="light"
                previewPosition="none"
                skinTonePosition="none"
              />
            </div>
          )}
        </div>

        {/* Attach */}
        <button style={tbBtn(false)} onClick={handleAttach} title="Attach file">
          <Paperclip size={13} />
        </button>

        {/* Image — email only */}
        {channel === 'Email' && (
          <>
            <button style={tbBtn(false)} onClick={handleImageInsert} title="Insert image">
              <ImageIcon size={13} />
            </button>

            {/* Overflow: more formatting */}
            <div className="relative overflow-menu-container">
              <button
                ref={overflowButtonRef}
                style={tbBtn(false)}
                onClick={() => setShowOverflow(v => !v)}
                title="More formatting"
              >
                <MoreHorizontal size={13} />
              </button>
              {showOverflow && editor && (
                <div
                  className="absolute z-50 rounded-lg shadow-lg py-1 w-44"
                  style={{ bottom: '100%', left: 0, marginBottom: 4, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                >
                  <div className="px-3 py-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>Alignment</p>
                    <div className="flex gap-1">
                      <button style={tbBtn(editor.isActive({ textAlign: 'left' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('left').run() }}><AlignLeft size={13} /></button>
                      <button style={tbBtn(editor.isActive({ textAlign: 'center' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('center').run() }}><AlignCenter size={13} /></button>
                      <button style={tbBtn(editor.isActive({ textAlign: 'right' }))} onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('right').run() }}><AlignRight size={13} /></button>
                    </div>
                  </div>
                  <div className="mx-2 my-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs"
                    style={{ color: 'var(--color-text-secondary)' }}
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetAllMarks().clearNodes().run(); setShowOverflow(false) }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                  >
                    Clear formatting
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex-1" />
        <SendButton />
      </div>
    )
  }

  // ── Collapsed state ────────────────────────────────────────────────────────

  if (!expanded) {
    const collapsedEmpty = !smsText.trim()
    return (
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={borderTop}
      >
        <ChannelDropdown openUp={true} />
        <button
          className="flex-1 text-left text-sm rounded-lg px-3 py-1.5"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
          onClick={() => setExpanded(true)}
        >
          Type a message...
        </button>
        <button
          onClick={async () => {
            if (!collapsedEmpty) await handleSend()
          }}
          disabled={collapsedEmpty}
          className="flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
          style={{
            backgroundColor: collapsedEmpty ? 'var(--color-surface)' : 'var(--color-accent)',
            color: collapsedEmpty ? 'var(--color-text-muted)' : '#fff',
            cursor: collapsedEmpty ? 'not-allowed' : 'pointer',
            border: '1px solid var(--color-border)',
          }}
        >
          <Send size={13} />
          Send
        </button>
      </div>
    )
  }

  // ── Shared email fields JSX (NOT a nested component — avoids focus loss) ────

  const emailFieldsJSX = (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* From — pill style */}
      <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
        <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-body)' }}>From</span>
        <div className="flex flex-wrap gap-1 flex-1">
          <span
            className="inline-flex items-center gap-1.5 text-sm px-2.5 py-0.5 rounded-md"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-body)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            {studioEmail}
          </span>
        </div>
      </div>
      {/* To — non-editable pill */}
      <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
        <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-body)' }}>To</span>
        <div className="flex flex-wrap gap-1 flex-1">
          {emailTo ? (
            <span
              className="inline-flex items-center gap-1.5 text-sm px-2.5 py-0.5 rounded-md"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-body)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              {emailTo}
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No email address</span>
          )}
        </div>
        <div className="flex gap-1">
          {!showCc && (
            <button
              onClick={() => setShowCc(true)}
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
            >
              CC
            </button>
          )}
          {!showBcc && (
            <button
              onClick={() => setShowBcc(true)}
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
            >
              BCC
            </button>
          )}
        </div>
      </div>
      {/* CC */}
      {showCc && (
        <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
          <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-body)' }}>CC</span>
          <input
            value={emailCc}
            onChange={e => setEmailCc(e.target.value)}
            className="flex-1 bg-transparent focus:outline-none text-sm"
            style={{ color: 'var(--color-text-primary)' }}
            placeholder="cc@email.com"
            autoFocus
          />
          <button onClick={() => { setShowCc(false); setEmailCc('') }}><X size={12} style={{ color: 'var(--color-text-muted)' }} /></button>
        </div>
      )}
      {/* BCC */}
      {showBcc && (
        <div className="flex items-center gap-2 px-4 py-2" style={borderBottom}>
          <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-body)' }}>BCC</span>
          <input
            value={emailBcc}
            onChange={e => setEmailBcc(e.target.value)}
            className="flex-1 bg-transparent focus:outline-none text-sm"
            style={{ color: 'var(--color-text-primary)' }}
            placeholder="bcc@email.com"
            autoFocus
          />
          <button onClick={() => { setShowBcc(false); setEmailBcc('') }}><X size={12} style={{ color: 'var(--color-text-muted)' }} /></button>
        </div>
      )}
      {/* Subject */}
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="w-14 flex-shrink-0 text-sm font-medium" style={{ color: 'var(--color-body)' }}>Subject</span>
        <input
          value={emailSubject}
          onChange={e => setEmailSubject(e.target.value)}
          className="flex-1 bg-transparent focus:outline-none text-sm"
          style={{ color: 'var(--color-text-primary)' }}
          placeholder="Enter subject..."
        />
      </div>
    </div>
  )

  // ── Expanded state ─────────────────────────────────────────────────────────

  // Email full-page modal (expand2 for email)
  if (channel === 'Email' && expanded2) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-[200]"
          style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          onClick={() => setExpanded2(false)}
        />
        {/* Modal — edit WIDTH / HEIGHT below to resize */}
        <div
          className="fixed z-[201] flex flex-col rounded-xl overflow-hidden"
          style={{
            /* ↓↓ Adjust dimensions here ↓↓ */
            width: '75%',
            height: '90%',
            /* ↑↑ Adjust dimensions here ↑↑ */
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
          }}
        >
          {/* Modal header */}
          <div className="flex items-center gap-2 px-4 py-3" style={borderBottom}>
            <ChannelDropdown openUp={false} />
            <div className="flex-1" />
            <button
              onClick={() => { setExpanded(false); setExpanded2(false) }}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              title="Minimize"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => setExpanded2(false)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              title="Collapse"
            >
              <Minimize2 size={14} />
            </button>
          </div>
          {/* Email fields */}
          {emailFieldsJSX}
          {/* Body */}
          <div className="flex-1 overflow-auto" onClick={() => editor?.commands.focus()}>
            <EmailEditor editor={editor} />
          </div>
          <BottomBar />
        </div>
      </>
    )
  }

  return (
    <div style={borderTop}>
      {/* Expanded header */}
      <div className="flex items-center gap-2 px-3 py-2" style={borderBottom}>
        <ChannelDropdown openUp={false} />
        <div className="flex-1" />
        <button
          onClick={() => setExpanded(false)}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => setExpanded2(v => !v)}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          title={expanded2 ? 'Collapse' : 'Expand'}
        >
          {expanded2 ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Email fields */}
      {channel === 'Email' && emailFieldsJSX}

      {/* Body */}
      {channel === 'SMS' ? (
        <textarea
          ref={smsRef}
          autoFocus
          value={smsText}
          onChange={e => setSmsText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              // Enter alone sends; Shift+Enter falls through to default (newline)
              e.preventDefault()
              handleSend()
            }
          }}
          rows={expanded2 ? 14 : 8}
          className="w-full resize-none text-sm focus:outline-none px-3 py-3"
          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
          placeholder="Type a message..."
        />
      ) : (
        <div className="min-h-[120px]" onClick={() => editor?.commands.focus()}>
          <EmailEditor editor={editor} />
        </div>
      )}

      <BottomBar />
    </div>
  )
}
