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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/spinner";
import { ComposeBox } from "@/components/conversations/compose-box";
import { getMockConversations, getMockMessages, MOCK_LEADS } from "@/lib/mock-data";
import type { SentMessage } from "@/components/conversations/compose-box";
import { ContactSidePanel } from "@/components/conversations/contact-side-panel";
import { AppointmentModal } from "@/components/calendar/appointment-modal";
import { deleteAppointment, findLeadsByContactIds } from "@/app/actions";
import type { Appointment, Lead, StudioSlotConfig } from "@/lib/types";
import { Checkbox } from "@/components/leads/checkbox";
import { ConversationThread } from "@/components/conversations/conversation-thread";
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
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    function handleChange(v: string) {
        setValue(v);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => onChange(v), 300);
    }

    function handleClear() {
        if (timerRef.current) clearTimeout(timerRef.current);
        setValue('');
        onChange('');
    }

    return (
        <div className="relative flex-1">
            <input
                type="text"
                placeholder="Search by name…"
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text-primary)',
                    paddingRight: value ? 28 : undefined,
                }}
            />
            {value && (
                <button
                    onClick={handleClear}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-muted)' }}
                >
                    <X size={13} />
                </button>
            )}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ConversationsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
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

        // Local-only update for mock data branch
        setConversations((prev) => applyStarred(prev));
        setSearchResults((prev) => prev ? applyStarred(prev) : prev);
    }

    async function markConvRead(convId: string, read: boolean) {
        setConversations(prev => prev.map(c => c.id === convId ? { ...c, unreadCount: read ? 0 : 1 } : c))
        setGlobalUnreadCount(prev => Math.max(0, prev + (read ? -1 : 1)))
    }

    async function deleteConv(convId: string) {
        const wasUnread = conversations.find(c => c.id === convId)?.unreadCount ? 1 : 0
        setConversations(prev => prev.filter(c => c.id !== convId))
        if (wasUnread) setGlobalUnreadCount(prev => Math.max(0, prev - 1))
        if (selectedId === convId) setSelectedId(null)
    }

    async function bulkAction(action: 'markRead' | 'markUnread' | 'star' | 'unstar' | 'delete') {
        const ids = Array.from(selectedConvIds)
        let unreadDelta = 0;

        if (action === 'delete') {
            ids.forEach(id => {
                if (conversations.find(c => c.id === id)?.unreadCount) unreadDelta -= 1;
            });
            setConversations(prev => prev.filter(c => !selectedConvIds.has(c.id)))
            if (selectedId && selectedConvIds.has(selectedId)) setSelectedId(null)
            setSelectedConvIds(new Set())
            setGlobalUnreadCount(prev => Math.max(0, prev + unreadDelta))
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
    }

    // ── Select conversation (with auto-remove check for blank new ones) ───────

    function selectConversation(newId: string) {
        if (newId === selectedId) return;
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
    }

    const handleLeadResolved = useCallback(() => setLoadingLead(false), [])
    const handleSidePanelMessage = useCallback(() => composeRef.current?.focusSms(), [])

    // ── Open appointment detail modal ────────────────────────────────────────

    async function openApptDetails(contactId: string, msgDateAdded: string, appointmentId?: string) {
        if (!studioId) return;

        // Mock: find appointment from mock data
        const { getMockAppointments, getMockLeadsByContactIds } = await import('@/lib/mock-data');
        const allAppts = getMockAppointments();
        let closest = appointmentId
            ? allAppts.find(a => a.id === appointmentId) ?? null
            : null;

        if (!closest) {
            const contactAppts = allAppts.filter(a => a.contact_id === contactId);
            if (!contactAppts.length) return;
            const msgTs = new Date(msgDateAdded).getTime();
            closest = contactAppts.reduce((best, a) => {
                const diff = Math.abs(new Date(a.updated_at || a.created_at).getTime() - msgTs);
                const bestDiff = Math.abs(new Date(best.updated_at || best.created_at).getTime() - msgTs);
                return diff < bestDiff ? a : best;
            });
        }

        if (!apptSlotConfig) {
            setApptSlotConfig({
                appointment_duration_minutes: 45,
                appointment_min_advance_weeks: 1,
                appointment_slots: {
                    '1': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
                    '2': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
                    '3': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
                    '4': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
                    '5': ['10:00', '11:00', '14:00', '15:00', '18:00', '19:00'],
                    '6': ['10:00', '11:00', '14:00', '15:00'],
                },
            });
        }

        if (!closest) return;

        const leadMap = getMockLeadsByContactIds([contactId]);
        setApptLead(leadMap[contactId] ?? null);
        setSelectedAppt(closest as Appointment);
    }

    // ── Fetch conversations ──────────────────────────────────────────────────

    const fetchConversations = useCallback(
        async (_cursor?: { lastDate: string; lastId: string }, statusParam?: string, qParam?: string) => {
            // Mock data — no API calls
            const { conversations: incoming } = getMockConversations({
                status: statusParam,
                q: qParam,
            });
            hasMoreConvsRef.current = false;
            setStudioId("studio-001");
            setGhlLocationId("slTYdxI6vskx4r28zsIo");
            setConversations(incoming as unknown as GHLConversation[]);
            setConvError(null);
            setLoadingConvs(false);
        },
        [],
    );

    useEffect(() => {
        fetchConversations();
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

        // Conversation doesn't exist yet — create a mock one
        const conv: GHLConversation = {
            id: `conv-mock-${Date.now()}`,
            contactId: ghlContactId,
            contactName: 'Unknown',
            email: null,
            phone: null,
            lastMessageBody: null,
            lastMessageDate: new Date().toISOString(),
            lastMessageType: 'SMS',
            unreadCount: 0,
            type: 'SMS',
            starred: false,
        };
        setConversations((prev) => [conv, ...prev]);
        newlyCreatedIdsRef.current.add(conv.id);
        setSelectedId(conv.id);
        router.replace("/conversations");
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadingConvs, searchParams]);

    // ── Fetch messages ───────────────────────────────────────────────────────

    const fetchMessages = useCallback(
        async (convId: string, _loadOlder = false) => {
            // Mock data — no API calls
            const { messages: msgs } = getMockMessages(convId);
            const sorted = [...msgs].sort(
                (a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime(),
            ) as unknown as GHLMessage[];

            if (convId !== selectedIdRef.current) return;

            hasMoreMsgsRef.current = false;
            oldestMsgCursorRef.current = null;
            setMessages(sorted);
            messagesCache.current.set(convId, {
                messages: sorted,
                nextCursor: null,
                hasMore: false,
            });
            setMsgError(null);
            setLoadingMsgs(false);
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
        if (loadingMsgs || loadingLead) return;
        if (!forceScrollBottomRef.current) return;
        forceScrollBottomRef.current = false;
        const el = threadRef.current;
        if (!el) return;
        const raf = requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
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

    // ── Realtime subscriptions — disabled for mock data branch ──────────────

    // ── New conversation: debounced lead search ──────────────────────────────

    useEffect(() => {
        if (!showNewConv || !studioId) return;
        // Mock data — filter leads locally
        let results = MOCK_LEADS.filter(l => l.ghl_contact_id);
        if (newConvSearch.trim()) {
            const words = newConvSearch.trim().toLowerCase().split(/\s+/);
            results = results.filter(l => words.every(w => l.name.toLowerCase().includes(w)));
        }
        setNewConvLeads(results.slice(0, 50) as typeof newConvLeads);
        setNewConvLoading(false);
    }, [showNewConv, newConvSearch, studioId]);

    async function handleNewConversation(lead: {
        ghl_contact_id: string;
        name: string;
        phone: string | null;
        email: string | null;
    }) {
        setNewConvCreating(lead.ghl_contact_id);
        try {
            // Mock create — generate a local conversation
            const conv: GHLConversation = {
                id: `conv-mock-${Date.now()}`,
                contactId: lead.ghl_contact_id,
                contactName: lead.name,
                email: lead.email,
                phone: lead.phone,
                lastMessageBody: null,
                lastMessageDate: new Date().toISOString(),
                lastMessageType: 'SMS',
                unreadCount: 0,
                type: 'SMS',
                starred: false,
            };
            setConversations((prev) => [conv, ...prev]);
            newlyCreatedIdsRef.current.add(conv.id);
            setSelectedId(conv.id);
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
        // Mock unread count from mock conversations
        const unread = getMockConversations({ status: 'unread' }).total;
        setGlobalUnreadCount(unread);
    }, [studioId]);

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
                className={`group relative w-full text-left px-4 py-4 transition-colors cursor-pointer select-none border-b border-[var(--color-border)] ${
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
                    className="px-5 pt-10 pb-5 flex-shrink-0"
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
            className="flex flex-col h-full"
            style={{ backgroundColor: "var(--color-bg)" }}
        >
            <div
                className="px-5 pt-10 pb-5 flex-shrink-0"
                style={{ borderBottom: "1px solid var(--color-border)" }}
            >
                <h1
                    className="text-2xl font-semibold"
                    style={{ color: "var(--color-text-primary)" }}
                >
                    Conversations
                </h1>
            </div>
            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* ── Left panel: conversation list ───────────────────────────────── */}
                <div
                    className="w-[340px] shrink-0 flex flex-col"
                    style={{
                        borderRight: "1px solid var(--color-border)",
                        backgroundColor: "var(--color-bg)",
                    }}
                >
                    {/* Search + compose */}
                    <div
                        className="p-3 flex items-center gap-2"
                    >
                        <ConversationSearchInput onChange={setDebouncedSearch} />
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
                    </div>

                    {/* Tabs */}
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

                {/* ── Middle panel: thread + compose ──────────────────────────────── */}
                <div
                    className="flex-1 flex flex-col min-w-0"
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
                                className="px-5 py-3 flex items-center gap-3"
                                style={{
                                    backgroundColor: "var(--color-bg)",
                                    borderBottom:
                                        "1px solid var(--color-border)",
                                }}
                            >
                                <Avatar
                                    name={selectedConv.contactName || "?"}
                                    size="sm"
                                />
                                <span
                                    className="font-semibold flex-1"
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
                                </div>
                        </div>

                            {/* Message thread */}
                            <div className="flex-1 min-h-0">
                                {(loadingLead || loadingMsgs) ? (
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
                            {!loadingLead && !loadingMsgs && selectedConv && (
                                <ComposeBox
                                    conversationId={selectedConv.id}
                                    contactId={selectedConv.contactId}
                                    contactPhone={selectedConv.phone}
                                    contactEmail={selectedConv.email}
                                    studioEmail={STUDIO_EMAIL}
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

                {/* ── Right panel: contact info ────────────────────────────────────── */}
                <ContactSidePanel
                    selectedConv={selectedConv}
                    blank={loadingLead}
                    studioId={studioId}
                    ghlLocationId={ghlLocationId}
                    onMessageClick={handleSidePanelMessage}
                    onLeadResolved={handleLeadResolved}
                />
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
                                className="w-full px-3 py-1.5 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
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
