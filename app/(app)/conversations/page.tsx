"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    X,
    Mail,
    MailOpen,
    MessageSquare,
    Phone,
    Star,
    Inbox,
    MessageSquarePlus,
    ChevronDown,
    ChevronUp,
    Trash2,
    StarOff,
    ArrowLeft,
    UserRound,
    Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/spinner";
import { ComposeBox } from "@/components/conversations/compose-box";
import type { SentMessage } from "@/components/conversations/compose-box";
import { ContactSidePanel } from "@/components/conversations/contact-side-panel";
import { AppointmentModal } from "@/components/calendar/appointment-modal";
import { deleteAppointment, findLeadsByContactIds } from "@/app/actions";
import type { Appointment, Lead, StudioSlotConfig } from "@/lib/types";
import { Checkbox } from "@/components/leads/checkbox";
import { ConversationThread } from "@/components/conversations/conversation-thread";
import { useIsMobile } from "@/lib/hooks";
import type { GHLMessage as GHLMessageType } from "@/components/conversations/conversation-thread";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GHLConversation {
    id: string;
    contactId: string;
    contactName: string;
    email: string | null;
    phone: string | null;
    lastMessageBody: string | null;
    lastMessageDate: string | null;
    lastMessageType: string | null;
    unreadCount: number;
    type: string;
    starred?: boolean;
}

type GHLMessage = GHLMessageType;

interface MsgCacheEntry {
    messages: GHLMessage[];
    nextCursor: string | null;
    hasMore: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
    return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0].toUpperCase())
        .join("");
}

const STUDIO_TZ = "America/Chicago";


const STUDIO_EMAIL = "info@arthurmurray.info";

// Returns a display string for an email address shown in message details.
// Known studio address shows as-is; any other non-contact address is labelled "Studio mail".
function resolveEmailDisplay(
    raw: string | null | undefined,
    contactEmail: string | null | undefined,
): string {
    if (!raw) return "Unknown";
    if (raw === contactEmail) return raw;
    if (raw.toLowerCase() === STUDIO_EMAIL) return raw;
    // Unknown sender/recipient — treat as another studio mail address
    return "Studio mail";
}

function chicagoStartOfDay(d: Date): Date {
    const dateStr = d.toLocaleDateString("en-CA", { timeZone: STUDIO_TZ });
    const utcMidnight = new Date(dateStr + "T00:00:00Z");
    const h = parseInt(
        new Intl.DateTimeFormat("en-US", {
            timeZone: STUDIO_TZ,
            hour: "numeric",
            hourCycle: "h23",
        }).format(utcMidnight),
        10,
    );
    return new Date(utcMidnight.getTime() + (h === 0 ? 0 : 24 - h) * 3_600_000);
}

function formatConvTime(dateStr: string | null): string {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const startOfToday = chicagoStartOfDay(now);
    if (date >= startOfToday)
        return date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: STUDIO_TZ,
        });
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
        timeZone: STUDIO_TZ,
    });
}

// Map Supabase Realtime row → GHLConversation
function mapConvRow(row: Record<string, unknown>): GHLConversation {
    return {
        id: row.id as string,
        contactId: (row.contact_id as string) ?? "",
        contactName: (row.contact_name as string) ?? "",
        email: (row.email as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        lastMessageBody: (row.last_message_body as string | null) ?? null,
        lastMessageDate: (row.last_message_date as string | null) ?? null,
        lastMessageType: (row.last_message_type as string | null) ?? null,
        unreadCount: (row.unread_count as number) ?? 0,
        type: (row.type as string) ?? "SMS",
    };
}

// Map Supabase Realtime row → GHLMessage
function mapMsgRow(row: Record<string, unknown>): GHLMessage {
    return {
        id: row.id as string,
        direction: row.direction as "inbound" | "outbound",
        body: (row.body as string) ?? "",
        dateAdded: row.date_added as string,
        messageType: (row.message_type as string) ?? "SMS",
        status: row.status as string | undefined,
        from: row.from as string | undefined,
        to: row.to as string | undefined,
        cc: (row.cc as string | null) ?? null,
        attachments: Array.isArray(row.attachments)
            ? (row.attachments as string[])
            : undefined,
        subject: (row.subject as string) ?? undefined,
        error: (row.error as string | null) ?? undefined,
        appointment_id: (row.appointment_id as string | null) ?? undefined,
    };
}


const AVATAR_COLORS = [
    "#448361",
    "#9065B0",
    "#C14C8A",
    "#337EA9",
    "#CB912F",
    "#C4554D",
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
    const initials = getInitials(name || "?");
    const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
    const sz = size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm";
    return (
        <div
            className={`${sz} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
            style={{ backgroundColor: color }}
        >
            {initials}
        </div>
    );
}

// conv.type is the conversation's primary channel (GHL often returns "TYPE_PHONE" for all convs).
// lastMessageType reflects what the actual last message was sent as — use it when available.
function ChannelTypeIcon({
    lastMessageType,
    type,
    size = 10,
}: {
    lastMessageType: string | null;
    type: string;
    size?: number;
}) {
    const raw = lastMessageType ?? type;
    const t = String(raw ?? "").toLowerCase();
    const style: React.CSSProperties = {
        color: "var(--color-text-muted)",
        flexShrink: 0,
    };
    if (t.includes("email")) return <Mail size={size} style={style} />;
    if (t === "call" || t === "type_call")
        return <Phone size={size} style={style} />;
    return <MessageSquare size={size} style={style} />;
}

// ─── Search Input (isolated to avoid re-rendering the entire page on keystroke) ─

function ConversationSearchInput({ onChange }: { onChange: (v: string) => void }) {
    const [value, setValue] = useState('');
    const [open, setOpen] = useState(false);
    const [focused, setFocused] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) setTimeout(() => inputRef.current?.focus(), 20);
    }, [open]);

    function handleChange(v: string) {
        setValue(v);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => onChange(v), 300);
    }

    function handleClose() {
        if (timerRef.current) clearTimeout(timerRef.current);
        setValue('');
        onChange('');
        setOpen(false);
    }

    if (open) {
        return (
            <div
                className="flex items-center gap-2 px-3 flex-1 min-w-0"
                style={{
                    height: 36,
                    border: focused ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                    borderRadius: 8,
                    backgroundColor: 'var(--color-bg)',
                }}
            >
                <Search size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search by name…"
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(e) => { if (e.key === 'Escape') handleClose() }}
                    className="text-base md:text-sm outline-none bg-transparent flex-1 min-w-0"
                    style={{ color: 'var(--color-text-primary)' }}
                />
                <button
                    onClick={handleClose}
                    style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}
                >
                    <X size={12} />
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => setOpen(true)}
            className="flex-1 min-w-0 flex items-center gap-1.5 px-3"
            style={{
                height: 36,
                fontSize: 14,
                fontWeight: 500,
                borderRadius: 8,
                cursor: 'pointer',
                border: `1px solid ${value ? 'var(--color-border-strong)' : 'var(--color-border)'}`,
                backgroundColor: value ? 'var(--color-surface)' : 'var(--color-bg)',
                color: 'var(--color-text-secondary)',
                transition: 'background var(--transition-fast), color var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)';
                (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={(e) => {
                if (!value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)';
                (e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)';
            }}
        >
            <Search size={14} style={{ flexShrink: 0 }} />
            <span className="flex-1 text-left truncate">
                {value
                    ? `"${value.slice(0, 14)}${value.length > 14 ? '…' : ''}"`
                    : 'Search by name…'}
            </span>
        </button>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ConversationsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobile();
    const [mobileView, setMobileView] = useState<'list' | 'thread' | 'contact'>('list');
    const isMobileRef = useRef(false);
    isMobileRef.current = isMobile;
    const [conversations, setConversations] = useState<GHLConversation[]>([]);
    const [studioId, setStudioId] = useState<string | null>(null);
    const [ghlLocationId, setGhlLocationId] = useState<string | null>(null);
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [searchResults, setSearchResults] = useState<GHLConversation[] | null>(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [messages, setMessages] = useState<GHLMessage[]>([]);
    const [loadingConvs, setLoadingConvs] = useState(true);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [loadingLead, setLoadingLead] = useState(false);
    const [loadingMoreConvs, setLoadingMoreConvs] = useState(false);
    const [loadingOlderMsgs, setLoadingOlderMsgs] = useState(false);
    const [convError, setConvError] = useState<string | null>(null);
    const [msgError, setMsgError] = useState<string | null>(null);
    const [showNewConv, setShowNewConv] = useState(false);
    const [newConvSearch, setNewConvSearch] = useState("");
    const [newConvLeads, setNewConvLeads] = useState<
        {
            id: string;
            name: string;
            ghl_contact_id: string | null;
            phone: string | null;
            email: string | null;
        }[]
    >([]);
    const [newConvLoading, setNewConvLoading] = useState(false);
    const [newConvCreating, setNewConvCreating] = useState<string | null>(null);

    // Active tab in sidebar
    const [selectedConvIds, setSelectedConvIds] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<'unread' | 'all' | 'starred'>('all');
    const [actionsOpen, setActionsOpen] = useState(false);

    // Appointment detail modal state
    const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
    const [apptLead, setApptLead] = useState<Lead | null>(null);
    const [apptSlotConfig, setApptSlotConfig] = useState<StudioSlotConfig | null>(null);

    const threadRef = useRef<HTMLDivElement>(null);
    const newConvDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const isNearBottomRef = useRef(true);
    const forceScrollBottomRef = useRef(false);
    const selectedIdRef = useRef<string | null>(null);
    const composeRef = useRef<{ focusSms: () => void; focusEmail?: () => void } | null>(null);

    // Tracks conversations created via the "New Conversation" modal
    const newlyCreatedIdsRef = useRef<Set<string>>(new Set());

    // Conversations pagination refs
    const hasMoreConvsRef = useRef(false);
    const loadingMoreConvsRef = useRef(false);
    const convsCursorRef = useRef<{ lastDate: string; lastId: string } | null>(
        null,
    );

    // Messages pagination refs
    const hasMoreMsgsRef = useRef(false);
    const loadingOlderMsgsRef = useRef(false);
    const oldestMsgCursorRef = useRef<string | null>(null);
    const prevScrollHeightRef = useRef(0);
    const isPrependRef = useRef(false);

    // Cache: latest 50 msgs per conversation for instant re-render on switch
    const messagesCache = useRef<Map<string, MsgCacheEntry>>(new Map());

    const selectedConv =
        conversations.find((c) => c.id === selectedId) ??
        searchResults?.find((c) => c.id === selectedId) ??
        null;

    function toggleConvSelection(e: React.ChangeEvent<HTMLInputElement>, convId: string) {
        const checked = e.target.checked;
        setSelectedConvIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(convId);
            else next.delete(convId);
            return next;
        });
    }

    function toggleSelectAll(e: React.ChangeEvent<HTMLInputElement>, allIds: string[]) {
        if (e.target.checked) {
            setSelectedConvIds(new Set(allIds));
        } else {
            setSelectedConvIds(new Set());
        }
    }

    async function toggleStar(e: React.MouseEvent, convId: string) {
        e.stopPropagation();

        const conv =
            conversations.find((c) => c.id === convId) ??
            searchResults?.find((c) => c.id === convId);
        if (!conv) return;

        const newStarred = !conv.starred;

        const applyStarred = (list: GHLConversation[]) =>
            list.map((c) => c.id === convId ? { ...c, starred: newStarred } : c);
        const revertStarred = (list: GHLConversation[]) =>
            list.map((c) => c.id === convId ? { ...c, starred: !newStarred } : c);

        // Optimistic update — both lists
        setConversations((prev) => applyStarred(prev));
        setSearchResults((prev) => prev ? applyStarred(prev) : prev);

        try {
            await fetch("/api/conversations", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: convId, starred: newStarred }),
            });
        } catch (err) {
            console.error("Failed to toggle star", err);
            setConversations((prev) => revertStarred(prev));
            setSearchResults((prev) => prev ? revertStarred(prev) : prev);
        }
    }

    async function markConvRead(convId: string, read: boolean) {
        const unreadCount = read ? 0 : 1
        setConversations(prev => prev.map(c => c.id === convId ? { ...c, unreadCount: read ? 0 : 1 } : c))
        setGlobalUnreadCount(prev => Math.max(0, prev + (read ? -1 : 1)))
        try {
            await fetch('/api/conversations', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: convId, unreadCount }),
            })
        } catch {
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, unreadCount: read ? 1 : 0 } : c))
            setGlobalUnreadCount(prev => Math.max(0, prev + (read ? 1 : -1)))
        }
    }

    async function deleteConv(convId: string) {
        // Find if it was unread to decrement global count
        const wasUnread = conversations.find(c => c.id === convId)?.unreadCount ? 1 : 0
        setConversations(prev => prev.filter(c => c.id !== convId))
        if (wasUnread) setGlobalUnreadCount(prev => Math.max(0, prev - 1))
        
        if (selectedId === convId) {
            setSelectedId(null)
            if (isMobileRef.current) setMobileView('list')
        }
        try {
            await fetch('/api/conversations', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: convId }),
            })
        } catch {
            // Soft failure — GHL may not support delete; local state already removed
        }
    }

    async function bulkAction(action: 'markRead' | 'markUnread' | 'star' | 'unstar' | 'delete') {
        const ids = Array.from(selectedConvIds)
        
        // Count how many are changing unread status to update global count
        let unreadDelta = 0;
        
        if (action === 'delete') {
            ids.forEach(id => {
                if (conversations.find(c => c.id === id)?.unreadCount) unreadDelta -= 1;
            });
            setConversations(prev => prev.filter(c => !selectedConvIds.has(c.id)))
            if (selectedId && selectedConvIds.has(selectedId)) {
                setSelectedId(null)
                if (isMobileRef.current) setMobileView('list')
            }
            setSelectedConvIds(new Set())
            setGlobalUnreadCount(prev => Math.max(0, prev + unreadDelta))
            await Promise.all(ids.map(id =>
                fetch('/api/conversations', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: id }) })
            ))
            return
        }
        
        const patch: Record<string, unknown> = {}
        if (action === 'markRead') patch.unreadCount = 0
        if (action === 'markUnread') patch.unreadCount = 1
        if (action === 'star') patch.starred = true
        if (action === 'unstar') patch.starred = false
        
        setConversations(prev => prev.map(c => {
            if (!selectedConvIds.has(c.id)) return c
            
            if (action === 'markRead' && c.unreadCount > 0) unreadDelta -= 1;
            if (action === 'markUnread' && c.unreadCount === 0) unreadDelta += 1;
            
            if ('unreadCount' in patch) return { ...c, unreadCount: patch.unreadCount as number }
            if ('starred' in patch) return { ...c, starred: patch.starred as boolean }
            return c
        }))
        
        setGlobalUnreadCount(prev => Math.max(0, prev + unreadDelta))
        setSelectedConvIds(new Set())
        await Promise.all(ids.map(id =>
            fetch('/api/conversations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: id, ...patch }) })
        ))
    }

    // ── Select conversation (with auto-remove check for blank new ones) ───────

    function selectConversation(newId: string) {
        if (newId === selectedId) {
            if (isMobileRef.current) setMobileView('thread');
            return;
        }
        if (
            selectedId &&
            selectedId !== newId &&
            newlyCreatedIdsRef.current.has(selectedId)
        ) {
            const cached = messagesCache.current.get(selectedId);
            const msgCount =
                cached?.messages.length ??
                (selectedIdRef.current === selectedId ? messages.length : 0);
            if (msgCount === 0) {
                newlyCreatedIdsRef.current.delete(selectedId);
                setConversations((prev) =>
                    prev.filter((c) => c.id !== selectedId),
                );
            }
        }
        setSelectedId(newId);
        setSelectedAppt(null);
        setLoadingLead(true);
        if (isMobileRef.current) {
            setMobileView('thread');
            window.history.pushState({ mobileView: 'thread' }, '');
        }
    }

    const handleLeadResolved = useCallback(() => setLoadingLead(false), [])
    const handleSidePanelMessage = useCallback(() => composeRef.current?.focusSms(), [])

    // ── Open appointment detail modal ────────────────────────────────────────

    async function openApptDetails(contactId: string, msgDateAdded: string, appointmentId?: string) {
        if (!studioId) return;
        const supabase = createClient();

        let closest = null;

        // Direct lookup by appointmentId when available
        if (appointmentId) {
            const { data } = await supabase.from('appointments').select('*').eq('id', appointmentId).single();
            closest = data ?? null;
        }

        // Fallback: pick closest by metadata timestamp (when record was last touched)
        if (!closest) {
            const { data: appts } = await supabase
                .from('appointments')
                .select('*')
                .eq('studio_id', studioId)
                .eq('contact_id', contactId)
                .order('updated_at', { ascending: false })
                .limit(20);

            if (!appts?.length) return;

            // Pick the appointment whose updated_at/created_at is closest to when the activity was logged
            const msgTs = new Date(msgDateAdded).getTime();
            closest = appts.reduce((best: typeof appts[0], a: typeof appts[0]) => {
                const aTs = new Date(a.updated_at || a.created_at).getTime();
                const bestTs = new Date(best.updated_at || best.created_at).getTime();
                const diff = Math.abs(aTs - msgTs);
                const bestDiff = Math.abs(bestTs - msgTs);
                return diff < bestDiff ? a : best;
            });
        }

        // Fetch slot config from studio (needed for edit mode in modal)
        if (!apptSlotConfig) {
            const { data: studio } = await supabase
                .from('studios')
                .select('appointment_duration_minutes, appointment_min_advance_weeks, appointment_slots')
                .eq('id', studioId)
                .single();
            if (studio) {
                setApptSlotConfig({
                    appointment_duration_minutes: studio.appointment_duration_minutes ?? 45,
                    appointment_min_advance_weeks: studio.appointment_min_advance_weeks ?? 1,
                    appointment_slots: (studio.appointment_slots as Record<string, string[]>) ?? {},
                });
            }
        }

        if (!closest) return;

        // Fetch lead for the contact
        const leadMap = await findLeadsByContactIds([contactId], studioId);
        setApptLead(leadMap[contactId] ?? null);
        setSelectedAppt(closest as Appointment);
    }

    // ── Fetch conversations ──────────────────────────────────────────────────

    const fetchConversations = useCallback(
        async (cursor?: { lastDate: string; lastId: string }, statusParam?: string, qParam?: string) => {
            if (cursor) {
                if (loadingMoreConvsRef.current) return;
                loadingMoreConvsRef.current = true;
                setLoadingMoreConvs(true);
            }

            try {
                let url = "/api/conversations?";
                const params = new URLSearchParams();
                if (statusParam && statusParam !== 'all') params.append('status', statusParam);
                if (qParam) params.append('q', qParam);
                if (cursor) {
                    params.append('startAfterDate', cursor.lastDate);
                    params.append('startAfterId', cursor.lastId);
                }
                url += params.toString();

                const res = await fetch(url);
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    if (!cursor)
                        setConvError(
                            data.error ?? "Failed to load conversations",
                        );
                    return;
                }
                const data = await res.json();
                // GHL returns fullName; normalise to contactName
                const incoming: GHLConversation[] = (data.conversations ?? []).map((c: Record<string, unknown>) => ({
                    ...c,
                    contactName: (c.contactName as string) || (c.fullName as string) || '',
                }));
                hasMoreConvsRef.current = data.hasMore ?? false;

                // Capture studioId and GHL locationId for Realtime subscriptions and links
                if (data.studioId && !cursor) setStudioId(data.studioId);
                if (data.locationId && !cursor) setGhlLocationId(data.locationId);

                if (incoming.length > 0) {
                    const last = incoming[incoming.length - 1];
                    convsCursorRef.current = {
                        lastDate: last.lastMessageDate ?? "",
                        lastId: last.id,
                    };
                }

                setConversations((prev) => {
                    if (cursor) {
                        const existingIds = new Set(prev.map((c) => c.id));
                        const newOnes = incoming.filter(
                            (c) => !existingIds.has(c.id),
                        );
                        return [...prev, ...newOnes];
                    }
                    // Polling: replace fresh top-25, preserve older loaded pages
                    if (prev.length === 0) return incoming;
                    const incomingIds = new Set(incoming.map((c) => c.id));
                    const olderLoaded = prev.filter(
                        (c) => !incomingIds.has(c.id),
                    );
                    return [...incoming, ...olderLoaded];
                });

                setConvError(null);
            } catch {
                if (!cursor) setConvError("Network error");
            } finally {
                setLoadingConvs(false);
                if (cursor) {
                    loadingMoreConvsRef.current = false;
                    setLoadingMoreConvs(false);
                }
            }
        },
        [],
    );

    useEffect(() => {
        fetchConversations();
        // No polling — Supabase Realtime handles live conversation updates
    }, [fetchConversations]);

    // ── Auto-select conversation from ?ghlContactId= param ───────────────────

    useEffect(() => {
        const ghlContactId = searchParams.get("ghlContactId");
        if (!ghlContactId || loadingConvs) return;

        const match = conversations.find((c) => c.contactId === ghlContactId);
        if (match) {
            selectConversation(match.id);
            router.replace("/conversations");
            return;
        }

        // Conversation doesn't exist yet — create it
        fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contactId: ghlContactId }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.conversation) {
                    const conv: GHLConversation = data.conversation;
                    setConversations((prev) =>
                        prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev],
                    );
                    newlyCreatedIdsRef.current.add(conv.id);
                    setSelectedId(conv.id);
                    if (isMobileRef.current) setMobileView('thread');
                    router.replace("/conversations");
                }
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadingConvs, searchParams]);

    // ── Fetch messages ───────────────────────────────────────────────────────

    const fetchMessages = useCallback(
        async (convId: string, loadOlder = false) => {
            if (loadOlder) {
                if (loadingOlderMsgsRef.current) return;
                loadingOlderMsgsRef.current = true;
                setLoadingOlderMsgs(true);
                isPrependRef.current = true;
                if (threadRef.current)
                    prevScrollHeightRef.current =
                        threadRef.current.scrollHeight;
            }

            try {
                let url = `/api/conversations/${convId}/messages`;
                if (loadOlder && oldestMsgCursorRef.current) {
                    url += `?lastMessageId=${encodeURIComponent(oldestMsgCursorRef.current)}`;
                }

                const res = await fetch(url);
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setMsgError(data.error ?? "Failed to load messages");
                    return;
                }
                const data = await res.json();
                const msgs = Array.isArray(data.messages) ? data.messages : [];
                const sorted = [...msgs].sort(
                    (a: GHLMessage, b: GHLMessage) =>
                        new Date(a.dateAdded).getTime() -
                        new Date(b.dateAdded).getTime(),
                );

                if (convId !== selectedIdRef.current) return;

                const nextCursor: string | null = data.nextCursor ?? null;
                hasMoreMsgsRef.current = data.hasMore ?? false;

                // Preserve status/appointment_id enrichment already applied to existing messages
                const mergeEnrichment = (incoming: GHLMessage[], existing: GHLMessage[]): GHLMessage[] => {
                    const existingMap = new Map(existing.map((m) => [m.id, m]));
                    return incoming.map((m) => {
                        const prev = existingMap.get(m.id);
                        if (!prev) return m;
                        return {
                            ...m,
                            status: m.status ?? prev.status,
                            appointment_id: m.appointment_id ?? prev.appointment_id,
                        };
                    });
                };

                if (loadOlder) {
                    if (nextCursor) oldestMsgCursorRef.current = nextCursor;
                    setMessages((prev) => {
                        const existingIds = new Set(prev.map((m) => m.id));
                        const newOlder = sorted.filter(
                            (m) => !existingIds.has(m.id),
                        );
                        return [...newOlder, ...prev];
                    });
                } else {
                    oldestMsgCursorRef.current = nextCursor;
                    setMessages((prev) => {
                        if (prev.length === 0) return sorted;
                        const oldestInBatch = sorted[0];
                        const olderThanBatch = oldestInBatch
                            ? prev.filter(
                                  (m) =>
                                      new Date(m.dateAdded).getTime() <
                                      new Date(
                                          oldestInBatch.dateAdded,
                                      ).getTime(),
                              )
                            : prev;
                        const existingIds = new Set(
                            olderThanBatch.map((m) => m.id),
                        );
                        const enriched = mergeEnrichment(sorted, prev);
                        const merged = [
                            ...olderThanBatch,
                            ...enriched.filter((m) => !existingIds.has(m.id)),
                        ];
                        merged.sort(
                            (a, b) =>
                                new Date(a.dateAdded).getTime() -
                                new Date(b.dateAdded).getTime(),
                        );
                        return merged;
                    });
                    messagesCache.current.set(convId, {
                        messages: sorted,
                        nextCursor,
                        hasMore: data.hasMore ?? false,
                    });
                }

                setMsgError(null);
            } catch {
                setMsgError("Network error");
            } finally {
                setLoadingMsgs(false);
                if (loadOlder) {
                    loadingOlderMsgsRef.current = false;
                    setLoadingOlderMsgs(false);
                }
            }
        },
        [],
    );

    useEffect(() => {
        if (!selectedId) return;
        selectedIdRef.current = selectedId;
        isNearBottomRef.current = true;
        forceScrollBottomRef.current = true;
        oldestMsgCursorRef.current = null;
        hasMoreMsgsRef.current = false;
        // Always show spinner and fetch fresh enriched messages — never serve unenriched cache on initial load.
        // Cache is still used by fetchMessages internally to merge older pages.
        setLoadingMsgs(true);
        setMessages([]);
        const cached = messagesCache.current.get(selectedId);
        if (cached) {
            oldestMsgCursorRef.current = cached.nextCursor;
            hasMoreMsgsRef.current = cached.hasMore;
        }

        fetchMessages(selectedId);
    }, [selectedId, fetchMessages]);

    // ── Scroll: restore on prepend only (WhatsApp-style — no auto-snap on new messages) ──

    useEffect(() => {
        const el = threadRef.current;
        if (!el) return;
        if (isPrependRef.current) {
            el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
            isPrependRef.current = false;
        }
        // New messages arriving via Realtime silently appear — no snap.
        // First-load snap is handled by forceScrollBottomRef below.
    }, [messages]);

    // Force-scroll to bottom after spinner clears on conversation switch.
    // rAF ensures we scroll after React has painted the new messages into the DOM.
    useEffect(() => {
        if (loadingMsgs || (!isMobileRef.current && loadingLead)) return;
        if (!forceScrollBottomRef.current) return;
        forceScrollBottomRef.current = false;
        const el = threadRef.current;
        if (!el) return;
        // Double rAF ensures layout is fully settled (especially on mobile with fixed positioning)
        const raf = requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight;
            });
        });
        return () => cancelAnimationFrame(raf);
    }, [loadingMsgs, loadingLead]);

    // Re-snap when email cards load and grow the DOM (ResizeObserver).
    // rAF defers the scroll until after React has finished painting so the
    // observer never fires mid-render and fights row expand/collapse toggles.
    useEffect(() => {
        const el = threadRef.current;
        if (!el) return;
        let rafId = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                if (isNearBottomRef.current) {
                    el.scrollTop = el.scrollHeight;
                }
            });
        });
        observer.observe(el);
        return () => { observer.disconnect(); cancelAnimationFrame(rafId); };
    }, []);

    // ── Conversations Realtime subscription ──────────────────────────────────
    useEffect(() => {
        if (!studioId) return;
        const supabase = createClient();
        console.log("[realtime] Subscribing to conversations for studio:", studioId);
        
        const channel = supabase
            .channel("conversations-realtime")
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "conversations",
                    filter: `studio_id=eq.${studioId}`,
                },
                (payload) => {
                    console.log("[realtime] Conversation event:", payload.eventType, payload.new);
                    if (payload.eventType === "DELETE") return;
                    
                    const row = payload.new as Record<string, any>;
                    setConversations((prev) => {
                        const idx = prev.findIndex((c) => c.id === row.id);
                        if (idx >= 0) {
                            const next = [...prev];
                            const old = prev[idx];
                            // Merge only non-null/undefined fields from the Realtime payload
                            const updated: GHLConversation = {
                                ...old,
                                contactId: row.contact_id ?? old.contactId,
                                contactName: row.contact_name || old.contactName, // Never overwrite name with empty string
                                email: row.email ?? old.email,
                                phone: row.phone ?? old.phone,
                                lastMessageBody: row.last_message_body ?? old.lastMessageBody,
                                lastMessageDate: row.last_message_date ?? old.lastMessageDate,
                                lastMessageType: row.last_message_type ?? old.lastMessageType,
                                unreadCount: row.unread_count ?? old.unreadCount,
                                type: row.type ?? old.type,
                            };
                            next[idx] = updated;
                            // Re-sort by lastMessageDate descending
                            return next.sort(
                                (a, b) =>
                                    new Date(b.lastMessageDate ?? 0).getTime() -
                                    new Date(a.lastMessageDate ?? 0).getTime(),
                            );
                        }
                        // New conversation — map and prepend
                        return [mapConvRow(row), ...prev];
                    });
                },
            )
            .subscribe((status) => {
                console.log("[realtime] Conversations subscription status:", status);
            });
            
        return () => {
            supabase.removeChannel(channel);
        };
    }, [studioId]);

    // ── Messages Realtime subscription ───────────────────────────────────────
    useEffect(() => {
        if (!selectedId) return;
        const supabase = createClient();
        console.log("[realtime] Subscribing to messages for conversation:", selectedId);
        
        const channel = supabase
            .channel(`messages-realtime-${selectedId}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "messages",
                    filter: `conversation_id=eq.${selectedId}`,
                },
                (payload) => {
                    console.log("[realtime] New message detected:", payload.new.id);
                    fetchMessages(selectedId);
                },
            )
            .subscribe((status) => {
                console.log("[realtime] Messages subscription status:", status);
            });
            
        return () => {
            supabase.removeChannel(channel);
        };
    }, [selectedId, fetchMessages]);

    // ── Appointment events: real-time chip verb updates ───────────────────────
    // When an appointment_events INSERT fires, re-fetch messages for the current conversation
    // so the chip gets the accurate time from the GHL calendar API (server-side enrichment).
    useEffect(() => {
        if (!studioId) return;
        const supabase = createClient();
        const channel = supabase
            .channel('appointment-events-realtime')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'appointment_events',
                    filter: `studio_id=eq.${studioId}`,
                },
                () => {
                    if (selectedIdRef.current) {
                        fetchMessages(selectedIdRef.current)
                    }
                },
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [studioId, fetchMessages]);

    // ── New conversation: debounced lead search ──────────────────────────────

    useEffect(() => {
        if (!showNewConv || !studioId) return;
        if (newConvDebounceRef.current)
            clearTimeout(newConvDebounceRef.current);
        setNewConvLoading(true);
        newConvDebounceRef.current = setTimeout(
            async () => {
                const supabase = createClient();
                let q = supabase
                    .from("leads")
                    .select("id, name, ghl_contact_id, phone, email")
                    .eq("studio_id", studioId)
                    .order("name")
                    .limit(50);
                if (newConvSearch.trim()) {
                    const words = newConvSearch.trim().split(/\s+/)
                    for (const word of words) q = q.ilike("name", `%${word}%`) as typeof q
                }
                const { data } = await q;
                setNewConvLeads(data ?? []);
                setNewConvLoading(false);
            },
            newConvSearch.trim() ? 250 : 0,
        );
        return () => {
            if (newConvDebounceRef.current)
                clearTimeout(newConvDebounceRef.current);
        };
    }, [showNewConv, newConvSearch, studioId]);

    async function handleNewConversation(lead: {
        ghl_contact_id: string;
        name: string;
        phone: string | null;
        email: string | null;
    }) {
        setNewConvCreating(lead.ghl_contact_id);
        try {
            const res = await fetch("/api/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contactId: lead.ghl_contact_id,
                    contactName: lead.name,
                    phone: lead.phone,
                    email: lead.email,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(
                    data.error ||
                        data.details ||
                        "Failed to create conversation",
                );
                return;
            }
            const conv: GHLConversation = data.conversation;
            setConversations((prev) =>
                prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev],
            );
            // Track as newly created so it can be auto-removed if blank on switch-away
            newlyCreatedIdsRef.current.add(conv.id);
            setSelectedId(conv.id);
            if (isMobileRef.current) {
                setMobileView('thread');
                window.history.pushState({ mobileView: 'thread' }, '');
            }
            setShowNewConv(false);
            setNewConvSearch("");
        } finally {
            setNewConvCreating(null);
        }
    }

    // ── Scroll handlers ──────────────────────────────────────────────────────

    function handleConvListScroll(e: React.UIEvent<HTMLDivElement>) {
        if (debouncedSearch.trim()) return; // don't paginate while searching
        const el = e.currentTarget;
        const nearBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        if (
            nearBottom &&
            hasMoreConvsRef.current &&
            !loadingMoreConvsRef.current &&
            convsCursorRef.current
        ) {
            fetchConversations(convsCursorRef.current);
        }
    }

    function handleThreadScroll() {
        const el = threadRef.current;
        if (!el) return;
        isNearBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        if (
            el.scrollTop < 100 &&
            hasMoreMsgsRef.current &&
            !loadingOlderMsgsRef.current &&
            selectedIdRef.current
        ) {
            fetchMessages(selectedIdRef.current, true);
        }
    }

    // ── Global Unread Count ──────────────────────────────────────────────────
    const [globalUnreadCount, setGlobalUnreadCount] = useState<number>(0);

    useEffect(() => {
        if (!studioId) return;
        fetch('/api/conversations/unread-count')
            .then(res => res.json())
            .then(data => {
                if (data.total !== undefined) {
                    setGlobalUnreadCount(data.total);
                }
            })
            .catch(() => {});
    }, [studioId]); // Fetch when studioId is available. In a real app, you might refresh this periodically or via webhook/realtime event.

    // ── Mobile: browser back button ────────────────────────────────────────
    useEffect(() => {
        if (!isMobile) return;
        function handlePopState() {
            setMobileView(prev => prev === 'contact' ? 'thread' : prev === 'thread' ? 'list' : prev);
        }
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isMobile]);

    // ── Mobile: sync view on resize ─────────────────────────────────────────
    useEffect(() => {
        if (isMobile && selectedId) setMobileView('thread');
        if (isMobile && !selectedId) setMobileView('list');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMobile]);

    // ── Fetch Conversations on Filter/Search Change ──────────────────────────

    useEffect(() => {
        setConversations([]);
        convsCursorRef.current = null;
        hasMoreConvsRef.current = false;
        setLoadingConvs(true);
        fetchConversations(undefined, activeTab, debouncedSearch);
    }, [activeTab, debouncedSearch, fetchConversations]);

    // ── Filtered + sorted list ────────────────────────────────────────────────

    // We no longer filter on the client, the API returns the exactly matching list.
    const sortedFiltered = conversations;

    // ── Render conversation list item ─────────────────────────────────────────

    function renderConvItem(conv: GHLConversation) {
        const isActive = selectedId === conv.id;
        const isSelected = selectedConvIds.has(conv.id);

        return (
            <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(conv.id)}
                onKeyDown={(e) =>
                    e.key === "Enter" && selectConversation(conv.id)
                }
                className={`group relative w-full text-left px-4 py-4 transition-colors cursor-pointer select-none border-b border-[var(--color-border)] overflow-hidden ${
                    isActive ? "bg-[var(--color-accent-subtle)]" : "hover:bg-[var(--color-surface)]"
                }`}
            >
                <div className="flex items-center gap-3 w-full">
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                            checked={isSelected}
                            onChange={(checked) => {
                                setSelectedConvIds(prev => {
                                    const next = new Set(prev)
                                    if (checked) next.add(conv.id)
                                    else next.delete(conv.id)
                                    return next
                                })
                            }}
                        />
                    </div>
                    
                    <div className="relative shrink-0">
                        <Avatar name={conv.contactName || "?"} size="sm" />
                        <div 
                            className="absolute -bottom-1.5 -right-1.5 rounded-full p-1 flex items-center justify-center shadow-sm"
                            style={{
                                backgroundColor: "var(--color-surface)",
                                border: "1px solid var(--color-border)"
                            }}
                        >
                            <ChannelTypeIcon
                                lastMessageType={conv.lastMessageType}
                                type={conv.type}
                                size={12}
                            />
                        </div>
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                        {/* Name and Time */}
                        <div className="flex justify-between items-center gap-2">
                            <span
                                className="text-sm font-semibold truncate"
                                style={{ color: "var(--color-text-primary)" }}
                            >
                                {conv.contactName || conv.phone || "Unknown"}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                                <span
                                    className="text-xs"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    {formatConvTime(conv.lastMessageDate)}
                                </span>
                                {conv.unreadCount > 0 && (
                                    <span
                                        className="text-white text-xs rounded font-medium px-1.5 py-0.5 flex items-center justify-center min-w-[20px]"
                                        style={{
                                            backgroundColor: "var(--color-accent)",
                                        }}
                                    >
                                        {conv.unreadCount}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Preview Message and Star */}
                        <div className="flex items-center justify-between gap-2">
                            <span
                                className="text-sm truncate"
                                style={{ color: "var(--color-text-secondary)" }}
                            >
                                {conv.lastMessageBody || "—"}
                            </span>
                            <div className="shrink-0">
                                <button
                                    onClick={(e) => toggleStar(e, conv.id)}
                                    className="p-0.5 rounded transition-colors"
                                    style={{
                                        color: conv.starred ? "#f59e0b" : "var(--color-text-muted)",
                                    }}
                                    title={conv.starred ? "Unstar" : "Star"}
                                >
                                    <Star size={14} fill={conv.starred ? "currentColor" : "none"} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────

    if (loadingConvs) {
        return (
            <div
                className="flex flex-col h-full"
                style={{ backgroundColor: "var(--color-bg)" }}
            >
                <div
                    className="px-5 pt-5 md:pt-10 pb-5 flex-shrink-0"
                    style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                    <h1
                        className="text-2xl font-semibold"
                        style={{ color: "var(--color-text-primary)" }}
                    >
                        Conversations
                    </h1>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <Spinner />
                </div>
            </div>
        );
    }

    const unreadTotal = globalUnreadCount;

    return (
        <div
            className={`flex flex-col overflow-hidden ${isMobile ? 'fixed left-0 right-0 bottom-0 top-[52px] z-20' : 'h-full'}`}
            style={{ backgroundColor: "var(--color-bg)" }}
        >
            {(!isMobile || mobileView === 'list') && (
                <div
                    className="px-5 pt-5 md:pt-10 pb-5 flex-shrink-0"
                    style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                    <h1
                        className="text-2xl font-semibold"
                        style={{ color: "var(--color-text-primary)" }}
                    >
                        Conversations
                    </h1>
                </div>
            )}
            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* ── Left panel: conversation list ───────────────────────────────── */}
                {(!isMobile || mobileView === 'list') && (
                <div
                    className={`${isMobile ? 'flex-1 min-w-0 overflow-hidden' : 'w-[340px] shrink-0'} flex flex-col`}
                    style={{
                        borderRight: isMobile ? undefined : "1px solid var(--color-border)",
                        backgroundColor: "var(--color-bg)",
                    }}
                >
                    {/* Search + compose */}
                    <div className="p-3 flex items-center gap-2">
                        <ConversationSearchInput onChange={setDebouncedSearch} />
                        {!isMobile && (
                            <button
                                onClick={() => {
                                    setShowNewConv(true);
                                    setNewConvSearch("");
                                }}
                                title="New conversation"
                                className="shrink-0 p-2 rounded-lg transition-opacity hover:opacity-90 shadow-sm"
                                style={{
                                    backgroundColor: "var(--color-accent)",
                                    color: "#ffffff"
                                }}
                            >
                                <MessageSquarePlus size={18} />
                            </button>
                        )}
                    </div>

                    {/* Mobile-only: New Conversation button — above tabs */}
                    {isMobile && (
                        <div className="px-3 pb-2">
                            <button
                                onClick={() => {
                                    setShowNewConv(true);
                                    setNewConvSearch("");
                                }}
                                className="px-3 py-1.5 text-sm font-medium text-white rounded-lg"
                                style={{ backgroundColor: 'var(--color-accent)' }}
                            >
                                + New Conversation
                            </button>
                        </div>
                    )}

                    {/* Tabs */}
                    {isMobile ? (
                    <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <div className="flex items-center gap-0 overflow-x-auto">
                            {([
                                { key: 'unread' as const, label: 'Unread' },
                                { key: 'all' as const, label: 'All' },
                                { key: 'starred' as const, label: 'Starred' },
                            ]).map(t => (
                                <button
                                    key={t.key}
                                    onClick={() => setActiveTab(t.key)}
                                    className="px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap"
                                    style={{
                                        color: activeTab === t.key ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                                    }}
                                >
                                    {t.label}
                                    {t.key === 'unread' && unreadTotal > 0 && (
                                        <span
                                            className="ml-1 inline-flex items-center justify-center rounded px-1 min-w-[16px] h-[16px] text-[10px] font-bold text-white"
                                            style={{ backgroundColor: 'var(--color-accent)' }}
                                        >
                                            {unreadTotal > 99 ? '99+' : unreadTotal}
                                        </span>
                                    )}
                                    {activeTab === t.key && (
                                        <span
                                            className="absolute bottom-0 left-0 right-0 h-0.5"
                                            style={{ backgroundColor: 'var(--color-accent)' }}
                                        />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                    ) : (
                    <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
                        <button
                            onClick={() => setActiveTab('unread')}
                            className={`relative flex-1 flex flex-col items-center justify-center gap-1 pt-3 pb-2 text-sm font-medium transition-colors ${activeTab === 'unread' ? 'border-b-2' : ''}`}
                            style={{
                                color: 'var(--color-text-body)',
                                borderBottomColor: activeTab === 'unread' ? 'var(--color-accent)' : 'transparent',
                            }}
                        >
                            <div className="relative" style={{ opacity: activeTab === 'unread' ? 1 : 0.7 }}>
                                <Mail size={22} />
                            </div>
                            {/* DO NOT nest this badge inside any element with opacity < 1.
                                CSS opacity cascades to children with no escape — the badge must
                                stay as a direct child of the `relative` button so it always
                                renders at full color. This has been fixed 3+ times. */}
                            {unreadTotal > 0 && (
                                <span
                                    className="absolute top-2 flex items-center justify-center rounded px-1 min-w-[16px] h-[16px] text-[10px] font-bold text-white shadow-sm"
                                    style={{ backgroundColor: 'var(--color-accent)', left: 'calc(50% + 2px)' }}
                                >
                                    {unreadTotal > 99 ? '99+' : unreadTotal}
                                </span>
                            )}
                            <span style={{ opacity: activeTab === 'unread' ? 1 : 0.7 }}>Unread</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('all')}
                            className={`flex-1 flex flex-col items-center justify-center gap-1 pt-3 pb-2 text-sm font-medium transition-colors ${activeTab === 'all' ? 'border-b-2' : ''}`}
                            style={{
                                color: 'var(--color-text-body)',
                                borderBottomColor: activeTab === 'all' ? 'var(--color-accent)' : 'transparent',
                                opacity: activeTab === 'all' ? 1 : 0.7,
                            }}
                        >
                            <Inbox size={22} />
                            <span>All</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('starred')}
                            className={`flex-1 flex flex-col items-center justify-center gap-1 pt-3 pb-2 text-sm font-medium transition-colors ${activeTab === 'starred' ? 'border-b-2' : ''}`}
                            style={{
                                color: 'var(--color-text-body)',
                                borderBottomColor: activeTab === 'starred' ? 'var(--color-accent)' : 'transparent',
                                opacity: activeTab === 'starred' ? 1 : 0.7,
                            }}
                        >
                            <Star size={22} />
                            <span>Starred</span>
                        </button>
                    </div>
                    )}

                    {/* List */}
                    <div
                        className="flex-1 overflow-y-auto"
                        onScroll={handleConvListScroll}
                    >
                        {searchLoading && (
                            <div className="flex items-center justify-center py-8">
                                <Spinner />
                            </div>
                        )}
                        {!loadingConvs &&
                            !searchLoading &&
                            !convError &&
                            sortedFiltered.length === 0 && (
                                <p
                                    className="p-4 text-sm"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    {debouncedSearch ? 'No results found.' : 'No conversations found.'}
                                </p>
                            )}

                        {/* Select All */}
                        {!loadingConvs && !searchLoading && !convError && sortedFiltered.length > 0 && (
                            <div className="sticky top-0 z-10 px-4 h-11 flex items-center gap-3 border-b" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                                <Checkbox
                                    checked={selectedConvIds.size > 0 && selectedConvIds.size === sortedFiltered.length}
                                    indeterminate={selectedConvIds.size > 0 && selectedConvIds.size < sortedFiltered.length}
                                    onChange={(checked) => {
                                        if (checked) setSelectedConvIds(new Set(sortedFiltered.map(c => c.id)))
                                        else setSelectedConvIds(new Set())
                                    }}
                                />
                                <span className="text-sm font-medium" style={{ color: "var(--color-text-body)" }}>Select all</span>
                                {selectedConvIds.size > 0 && (
                                    <>
                                        <span className="text-sm font-medium" style={{ color: "var(--color-accent)" }}>
                                            {selectedConvIds.size} selected
                                        </span>
                                        <div className="ml-auto relative">
                                            <button
                                                onClick={() => setActionsOpen(o => !o)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                                                style={{ backgroundColor: 'var(--color-accent)', color: '#ffffff' }}
                                            >
                                                Actions
                                                <ChevronDown size={13} />
                                            </button>
                                            {actionsOpen && (
                                                <>
                                                    <div className="fixed inset-0 z-20" onClick={() => setActionsOpen(false)} />
                                                    <div className="absolute right-0 top-full mt-1 z-30 rounded-xl shadow-lg py-1 min-w-[200px]" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border-strong)' }}>
                                                        {[
                                                            { label: 'Mark as Read', icon: <MailOpen size={14} />, action: 'markRead' as const },
                                                            { label: 'Mark as Unread', icon: <Mail size={14} />, action: 'markUnread' as const },
                                                            { label: 'Add Star', icon: <Star size={14} />, action: 'star' as const },
                                                            { label: 'Remove Star', icon: <StarOff size={14} />, action: 'unstar' as const },
                                                        ].map(item => (
                                                            <button
                                                                key={item.action}
                                                                onClick={() => { setActionsOpen(false); bulkAction(item.action) }}
                                                                className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left"
                                                                style={{ color: 'var(--color-text-primary)' }}
                                                                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)')}
                                                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                                            >
                                                                <span style={{ color: 'var(--color-text-muted)' }}>{item.icon}</span>
                                                                {item.label}
                                                            </button>
                                                        ))}
                                                        <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
                                                        <button
                                                            onClick={() => { setActionsOpen(false); bulkAction('delete') }}
                                                            className="w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left"
                                                            style={{ color: '#C4554D' }}
                                                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)')}
                                                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                                                        >
                                                            <Trash2 size={14} />
                                                            Delete Conversations
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {sortedFiltered.map((conv) => renderConvItem(conv))}

                        {loadingMoreConvs && (
                            <div className="py-4 flex justify-center">
                                <div
                                    className="w-5 h-5 rounded-full border-2 animate-spin"
                                    style={{
                                        borderColor: "var(--color-border)",
                                        borderTopColor: "var(--color-accent)",
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
                )}

                {/* ── Middle panel: thread + compose ──────────────────────────────── */}
                {(!isMobile || mobileView === 'thread') && (
                <div
                    className="flex-1 flex flex-col min-w-0 overflow-hidden"
                    style={{ backgroundColor: "var(--color-bg)" }}
                >
                    {!selectedConv ? (
                        <div
                            className="flex-1 flex items-center justify-center text-sm"
                            style={{ color: "var(--color-text-muted)" }}
                        >
                            Select a conversation to start
                        </div>
                    ) : (
                        <>
                            {/* Header */}
                            <div
                                className="px-3 md:px-5 py-3 flex items-center gap-2 md:gap-3"
                                style={{
                                    backgroundColor: "var(--color-bg)",
                                    borderBottom:
                                        "1px solid var(--color-border)",
                                }}
                            >
                                {/* Mobile back button */}
                                {isMobile && (
                                    <button
                                        onClick={() => setMobileView('list')}
                                        className="w-9 h-9 flex items-center justify-center rounded-lg shrink-0 transition-colors hover:bg-[var(--color-surface)]"
                                        style={{ color: 'var(--color-text-primary)' }}
                                        aria-label="Back to conversations"
                                    >
                                        <ArrowLeft size={20} />
                                    </button>
                                )}
                                <Avatar
                                    name={selectedConv.contactName || "?"}
                                    size="sm"
                                />
                                <span
                                    className="font-semibold flex-1 truncate"
                                    style={{
                                        color: "var(--color-text-primary)",
                                    }}
                                >
                                    {selectedConv.contactName ||
                                        selectedConv.phone ||
                                        "Unknown"}
                                </span>
                                {/* Action buttons in header */}
                                <div className="flex items-center gap-1">
                                    {/* Call — opens GHL contact page */}
                                    {ghlLocationId ? (
                                        <a
                                            href={`https://app.gohighlevel.com/v2/location/${ghlLocationId}/contacts/detail/${selectedConv.contactId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="conv-action-icon p-2 rounded-lg transition-colors flex items-center justify-center"
                                            style={{ color: 'var(--color-text-muted)' }}
                                            title="Open in GHL"
                                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
                                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = '' }}
                                        >
                                            <Phone size={18} />
                                        </a>
                                    ) : (
                                        <span className="p-2 flex items-center justify-center" style={{ color: 'var(--color-text-muted)', opacity: 0.35, cursor: 'default' }} title="GHL location loading...">
                                            <Phone size={18} />
                                        </span>
                                    )}
                                    {/* Star toggle */}
                                    <button
                                        onClick={(e) => toggleStar(e, selectedConv.id)}
                                        className="conv-action-icon p-2 rounded-lg transition-colors"
                                        style={{ color: selectedConv.starred ? "#f59e0b" : "var(--color-text-muted)" }}
                                        title={selectedConv.starred ? "Unstar" : "Star"}
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'; if (!selectedConv.starred) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = selectedConv.starred ? '#f59e0b' : '' }}
                                    >
                                        <Star size={18} fill={selectedConv.starred ? "currentColor" : "none"} />
                                    </button>
                                    {/* Mark as read / unread */}
                                    <button
                                        onClick={() => markConvRead(selectedConv.id, selectedConv.unreadCount > 0)}
                                        className="conv-action-icon p-2 rounded-lg transition-colors"
                                        style={{ color: 'var(--color-text-muted)' }}
                                        title={selectedConv.unreadCount > 0 ? "Mark as read" : "Mark as unread"}
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = '' }}
                                    >
                                        {selectedConv.unreadCount > 0 ? <MailOpen size={18} /> : <Mail size={18} />}
                                    </button>
                                    {/* Delete conversation */}
                                    <button
                                        onClick={() => deleteConv(selectedConv.id)}
                                        className="conv-action-icon p-2 rounded-lg transition-colors"
                                        style={{ color: 'var(--color-text-muted)' }}
                                        title="Delete conversation"
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-hover)'; (e.currentTarget as HTMLElement).style.color = '#C4554D' }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = '' }}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                    {/* Mobile: contact info button */}
                                    {isMobile && (
                                        <button
                                            onClick={() => {
                                                setMobileView('contact');
                                                window.history.pushState({ mobileView: 'contact' }, '');
                                            }}
                                            className="conv-action-icon p-2 rounded-lg transition-colors"
                                            style={{ color: 'var(--color-text-muted)' }}
                                            title="Contact info"
                                        >
                                            <UserRound size={18} />
                                        </button>
                                    )}
                                </div>
                        </div>

                            {/* Message thread */}
                            <div className="flex-1 min-h-0">
                                {((!isMobile && loadingLead) || loadingMsgs) ? (
                                    <div className="h-full flex items-center justify-center">
                                        <Spinner />
                                    </div>
                                ) : (
                                <ConversationThread
                                    messages={messages}
                                    loading={false}
                                    loadingOlder={loadingOlderMsgs}
                                    threadRef={threadRef}
                                    onScroll={handleThreadScroll}
                                    conversationId={selectedConv.id}
                                    contactId={selectedConv.contactId}
                                    contactName={selectedConv.contactName ?? undefined}
                                    contactEmail={selectedConv.email ?? null}
                                    onOpenApptDetails={openApptDetails}
                                    onReply={() => composeRef.current?.focusEmail?.()}
                                    onSent={(msg: SentMessage) => {
                                        setMessages((prev) => {
                                            if (prev.some((m) => m.id === msg.id)) return prev;
                                            return [...prev, { ...msg, status: "sent" }];
                                        });
                                    }}
                                    msgError={msgError}
                                />
                                )}
                            </div>

                            {/* Compose bar */}
                            {(isMobile || !loadingLead) && !loadingMsgs && selectedConv && (
                                <ComposeBox
                                    conversationId={selectedConv.id}
                                    contactId={selectedConv.contactId}
                                    contactPhone={selectedConv.phone}
                                    contactEmail={selectedConv.email}
                                    studioEmail={STUDIO_EMAIL}
                                    isMobile={isMobile}
                                    imperativeRef={composeRef}
                                    onSent={(msg: SentMessage) => {
                                        setMessages((prev) => {
                                            if (prev.some((m) => m.id === msg.id)) return prev;
                                            return [...prev, { ...msg, status: "sent" }];
                                        });
                                    }}
                                />
                            )}
                        </>
                    )}
                </div>
                )}

                {/* ── Right panel: contact info ────────────────────────────────────── */}
                {(!isMobile || mobileView === 'contact') && (
                <ContactSidePanel
                    selectedConv={selectedConv}
                    blank={loadingLead}
                    studioId={studioId}
                    ghlLocationId={ghlLocationId}
                    onMessageClick={handleSidePanelMessage}
                    onLeadResolved={handleLeadResolved}
                    isMobile={isMobile}
                    onMobileBack={() => setMobileView('thread')}
                />
                )}
            </div>

            {/* ── Appointment detail modal ─────────────────────────────────────── */}
            {selectedAppt && apptSlotConfig && (
                <AppointmentModal
                    appointment={selectedAppt}
                    lead={apptLead}
                    studioId={studioId ?? ''}
                    slotConfig={apptSlotConfig}
                    onClose={() => setSelectedAppt(null)}
                    onDelete={async (id) => {
                        await deleteAppointment(id);
                        setSelectedAppt(null);
                    }}
                    onViewLead={(lead) => {
                        setSelectedAppt(null);
                        router.push(`/leads/${lead.id}`);
                    }}
                    onReschedule={(id, newStart, newEnd, newId) => {
                        const effectiveId = newId ?? id;
                        setSelectedAppt(prev =>
                            prev?.id === id
                                ? { ...prev, id: effectiveId, start_time: newStart, end_time: newEnd }
                                : prev
                        );
                    }}
                    onUpdate={(id, changes) => {
                        setSelectedAppt(prev =>
                            prev?.id === id ? { ...prev, ...changes } : prev
                        );
                    }}
                />
            )}

            {/* ── New Conversation modal ───────────────────────────────────────── */}
            {showNewConv && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center">
                    <div
                        className="absolute inset-0 bg-black/40"
                        onClick={() => {
                            setShowNewConv(false);
                            setNewConvSearch("");
                        }}
                    />
                    <div
                        className="relative w-full max-w-sm mx-4 rounded-xl shadow-2xl overflow-hidden"
                        style={{
                            backgroundColor: "var(--color-bg)",
                            border: "1px solid var(--color-border)",
                        }}
                    >
                        {/* Header */}
                        <div
                            className="flex items-center justify-between px-5 py-4"
                            style={{
                                borderBottom: "1px solid var(--color-border)",
                            }}
                        >
                            <h2
                                className="text-sm font-semibold"
                                style={{ color: "var(--color-text-primary)" }}
                            >
                                New Conversation
                            </h2>
                            <button
                                onClick={() => {
                                    setShowNewConv(false);
                                    setNewConvSearch("");
                                }}
                                className="p-1 rounded-lg transition-colors"
                                style={{ color: "var(--color-text-muted)" }}
                                onMouseEnter={(e) =>
                                    ((
                                        e.currentTarget as HTMLElement
                                    ).style.backgroundColor =
                                        "var(--color-surface-hover)")
                                }
                                onMouseLeave={(e) =>
                                    ((
                                        e.currentTarget as HTMLElement
                                    ).style.backgroundColor = "transparent")
                                }
                            >
                                <X size={15} />
                            </button>
                        </div>

                        {/* Search */}
                        <div
                            className="p-3"
                            style={{
                                borderBottom: "1px solid var(--color-border)",
                            }}
                        >
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search contacts…"
                                value={newConvSearch}
                                onChange={(e) =>
                                    setNewConvSearch(e.target.value)
                                }
                                className="w-full px-3 py-1.5 text-base md:text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                style={{
                                    border: "1px solid var(--color-border)",
                                    backgroundColor: "var(--color-surface)",
                                    color: "var(--color-text-primary)",
                                }}
                            />
                        </div>

                        {/* Contact list */}
                        <div className="max-h-72 overflow-y-auto">
                            {newConvLoading ? (
                                <p
                                    className="px-4 py-3 text-xs"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    Loading…
                                </p>
                            ) : newConvLeads.length === 0 ? (
                                <p
                                    className="px-4 py-3 text-xs"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    No contacts found.
                                </p>
                            ) : (
                                newConvLeads.map((lead) => {
                                    const hasGhl = !!lead.ghl_contact_id;
                                    const isCreating =
                                        newConvCreating === lead.ghl_contact_id;
                                    return (
                                        <button
                                            key={lead.id}
                                            onClick={() =>
                                                hasGhl &&
                                                handleNewConversation({
                                                    ghl_contact_id:
                                                        lead.ghl_contact_id!,
                                                    name: lead.name,
                                                    phone: lead.phone,
                                                    email: lead.email,
                                                })
                                            }
                                            disabled={
                                                !hasGhl || !!newConvCreating
                                            }
                                            className="w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors disabled:opacity-50"
                                            style={{
                                                borderBottom:
                                                    "1px solid var(--color-border)",
                                            }}
                                            onMouseEnter={(e) => {
                                                if (hasGhl && !newConvCreating)
                                                    (
                                                        e.currentTarget as HTMLElement
                                                    ).style.backgroundColor =
                                                        "var(--color-surface)";
                                            }}
                                            onMouseLeave={(e) =>
                                                ((
                                                    e.currentTarget as HTMLElement
                                                ).style.backgroundColor =
                                                    "transparent")
                                            }
                                        >
                                            <div className="min-w-0">
                                                <p
                                                    className="text-sm font-medium truncate"
                                                    style={{
                                                        color: "var(--color-text-primary)",
                                                    }}
                                                >
                                                    {lead.name}
                                                </p>
                                                {lead.phone && (
                                                    <p
                                                        className="text-xs truncate"
                                                        style={{
                                                            color: "var(--color-text-muted)",
                                                        }}
                                                    >
                                                        {lead.phone}
                                                    </p>
                                                )}
                                            </div>
                                            {isCreating && (
                                                <div
                                                    className="w-4 h-4 shrink-0 rounded-full border-2 animate-spin ml-2"
                                                    style={{
                                                        borderColor:
                                                            "var(--color-border)",
                                                        borderTopColor:
                                                            "var(--color-accent)",
                                                    }}
                                                />
                                            )}
                                            {!hasGhl && (
                                                <span
                                                    className="text-xs shrink-0 ml-2"
                                                    style={{
                                                        color: "var(--color-text-muted)",
                                                    }}
                                                >
                                                    No GHL ID
                                                </span>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
