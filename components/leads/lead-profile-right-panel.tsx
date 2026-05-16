'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Lead, Appointment, StudioSlotConfig } from '@/lib/types'
import { ComposeBox, type SentMessage } from '@/components/conversations/compose-box'
import { ConversationThread, type GHLMessage } from '@/components/conversations/conversation-thread'
import { TranscriptsPanel } from '@/components/call-analytics/transcripts-panel'
import { AppointmentModal } from '@/components/calendar/appointment-modal'
import { deleteAppointment } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { getMockAppointments, getMockMessages } from '@/lib/mock-data'
import { Spinner } from '@/components/spinner'

interface LeadProfileRightPanelProps {
  lead: Lead
  initialConversationId: string | null
  studioEmail?: string
  /** Call this ref to imperatively switch to Messages tab and focus compose */
  imperativeRef?: React.MutableRefObject<{ focusMessages: () => void } | null>
}

type Tab = 'messages' | 'calls'

export function LeadProfileRightPanel({
  lead,
  initialConversationId,
  studioEmail,
  imperativeRef,
}: LeadProfileRightPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('messages')
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId)
  const [messages, setMessages] = useState<GHLMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)
  const threadRef = useRef<HTMLDivElement>(null)
  const composeRef = useRef<{ focusSms: () => void }>(null)
  const isNearBottomRef = useRef(true)
  const forceScrollBottomRef = useRef(false)

  // Appointment detail modal
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)
  const [apptSlotConfig, setApptSlotConfig] = useState<StudioSlotConfig | null>(null)

  async function openApptDetails(contactId: string, msgDateAdded: string, appointmentId?: string) {
    const allAppts = getMockAppointments()
    let closest = appointmentId ? allAppts.find(a => a.id === appointmentId) ?? null : null

    if (!closest) {
      const contactAppts = allAppts.filter(a => a.contact_id === contactId)
      if (!contactAppts.length) return
      const msgTs = new Date(msgDateAdded).getTime()
      closest = contactAppts.reduce((best, a) => {
        const diff = Math.abs(new Date(a.updated_at || a.created_at).getTime() - msgTs)
        const bestDiff = Math.abs(new Date(best.updated_at || best.created_at).getTime() - msgTs)
        return diff < bestDiff ? a : best
      })
    }

    if (!apptSlotConfig) {
      setApptSlotConfig({
        appointment_duration_minutes: 45,
        appointment_min_advance_weeks: 1,
        appointment_slots: {
          '1': ['10:00','11:00','14:00','15:00','18:00','19:00'],
          '2': ['10:00','11:00','14:00','15:00','18:00','19:00'],
          '3': ['10:00','11:00','14:00','15:00','18:00','19:00'],
          '4': ['10:00','11:00','14:00','15:00','18:00','19:00'],
          '5': ['10:00','11:00','14:00','15:00','18:00','19:00'],
          '6': ['10:00','11:00','14:00','15:00'],
        },
      })
    }

    if (closest) setSelectedAppt(closest as Appointment)
  }

  // Expose imperative handle
  useEffect(() => {
    if (!imperativeRef) return
    imperativeRef.current = {
      focusMessages: () => {
        setActiveTab('messages')
        setTimeout(() => composeRef.current?.focusSms(), 50)
      },
    }
  }, [imperativeRef])

  // Bootstrap conversation — mock: create a local ID if none exists
  useEffect(() => {
    if (conversationId || !lead.ghl_contact_id) return
    setConversationId(`conv-mock-${Date.now()}`)
  }, [lead.ghl_contact_id, conversationId])

  // Fetch messages — mock data
  const fetchMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true)
    const { messages: msgs } = getMockMessages(convId)
    setMessages(msgs.sort((a, b) =>
      new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
    ) as unknown as GHLMessage[])
    setLoadingMessages(false)
  }, [])

  useEffect(() => {
    if (conversationId) fetchMessages(conversationId)
    else if (!lead.ghl_contact_id) setLoadingMessages(false)
  }, [conversationId, fetchMessages, lead.ghl_contact_id])

  // Snap to bottom when messages load/change (if user is near bottom)
  useEffect(() => {
    const el = threadRef.current
    if (!el || !isNearBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  // Force-scroll to bottom after spinner clears (initial load)
  useEffect(() => {
    if (loadingMessages) return
    if (!forceScrollBottomRef.current) return
    forceScrollBottomRef.current = false
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [loadingMessages])

  // Force-scroll to bottom when switching back to messages tab (thread remounts)
  useEffect(() => {
    if (activeTab !== 'messages') return
    isNearBottomRef.current = true
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [activeTab])

  // Re-snap to bottom when email content loads and grows the DOM height
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function handleThreadScroll() {
    const el = threadRef.current
    if (!el) return
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }

  function handleSent(msg: SentMessage) {
    setMessages(prev => [...prev, {
      id: msg.id,
      direction: msg.direction,
      body: msg.body,
      dateAdded: msg.dateAdded,
      messageType: msg.messageType,
    } as GHLMessage])
  }

  function handleApptReschedule(id: string, newStart: string, newEnd: string, newId?: string) {
    setSelectedAppt(prev => {
      if (!prev || (prev.id !== id && prev.id !== newId)) return prev
      return { ...prev, id: newId ?? prev.id, start_time: newStart, end_time: newEnd }
    })
  }

  function handleApptUpdate(id: string, changes: Partial<Appointment>) {
    setSelectedAppt(prev => {
      if (!prev || prev.id !== id) return prev
      return { ...prev, ...changes }
    })
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'messages', label: 'Messages' },
    { id: 'calls', label: 'Call Transcripts' },
  ]

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--color-bg)' }}>

      {/* Tab bar */}
      <div className="flex items-center flex-shrink-0 px-4 pt-3 gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 text-sm font-medium transition-colors relative"
            style={{ color: activeTab === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: 'var(--color-accent)' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Messages tab */}
      {activeTab === 'messages' && (
        <>
          <div className="flex-1 min-h-0">
            {loadingMessages ? (
              <div className="h-full flex items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <ConversationThread
                messages={messages}
                loading={false}
                threadRef={threadRef}
                onScroll={handleThreadScroll}
                conversationId={conversationId}
                contactId={lead.ghl_contact_id ?? undefined}
                contactName={lead.name ?? undefined}
                contactEmail={lead.email ?? null}
                onOpenApptDetails={openApptDetails}
                onSent={handleSent}
              />
            )}
          </div>

          {/* Compose box */}
          <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
            <ComposeBox
              conversationId={conversationId}
              contactId={lead.ghl_contact_id ?? ''}
              contactPhone={lead.phone}
              contactEmail={lead.email}
              studioEmail={studioEmail}
              onSent={handleSent}
              onConversationCreated={id => setConversationId(id)}
              imperativeRef={composeRef}
            />
          </div>
        </>
      )}

      {/* Calls tab */}
      {activeTab === 'calls' && (
        <div className="flex flex-1 min-h-0 p-4">
          <TranscriptsPanel
            studioId={lead.studio_id}
            leadId={lead.id}
            listWidth="w-54"
            hidePagination
          />
        </div>
      )}

      {/* Appointment detail modal */}
      {selectedAppt && apptSlotConfig && (
        <AppointmentModal
          appointment={selectedAppt}
          lead={lead}
          studioId={lead.studio_id}
          slotConfig={apptSlotConfig}
          onClose={() => setSelectedAppt(null)}
          onDelete={async () => {
            setSelectedAppt(null)
          }}
          onViewLead={() => setSelectedAppt(null)}
          onReschedule={handleApptReschedule}
          onUpdate={handleApptUpdate}
        />
      )}
    </div>
  )
}
