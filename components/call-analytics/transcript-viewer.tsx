"use client";

import { useState } from "react";
import Link from "next/link";
import {
    ChevronRight, ArrowUpRight, ChevronDown, ChevronUp
} from "lucide-react";
import type { TranscriptCallRow, RetellTranscriptItem } from "@/app/actions";
import { formatDateTime, formatDuration } from "@/lib/date-utils";
import { NOTION_COLORS } from "@/lib/constants";
import { Spinner } from "@/components/spinner";

interface TranscriptViewerProps {
    call: TranscriptCallRow;
    transcriptWithToolCalls?: RetellTranscriptItem[] | null;
    isLoadingTranscript?: boolean;
    onNameClick?: () => void;
    showViewInTranscripts?: boolean | (() => void);
}

const OUTCOME_BADGE: Record<string, string> = {
    successful: "status-bg-green status-text-green",
    unsuccessful: "status-bg-red   status-text-red",
};

const SENTIMENT_BADGE: Record<string, string> = {
    positive: "status-bg-green  status-text-green",
    neutral: "status-bg-blue   status-text-blue",
    negative: "status-bg-red    status-text-red",
    unknown: "status-bg-gray   status-text-gray",
};

function capitalize(s: string | null) {
    return s ? s[0].toUpperCase() + s.slice(1) : "";
}

function formatDisconnectReason(reason: string | null) {
    if (!reason) return "—";
    const map: Record<string, string> = {
        agent_hangup: "Agent Hangup",
        user_hangup: "User Hangup",
        voicemail: "Voicemail",
        dial_no_answer: "No Answer",
        dial_busy: "Busy",
        call_transfer: "Transfer",
    };
    return map[reason] || capitalize(reason);
}

function formatTimeSec(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function tryFormatJson(str: string): string {
    if (!str || !str.trim()) return str;
    try {
        return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
        return str;
    }
}

// ── Plain-text fallback parser ─────────────────────────────────────────────────

function parseTranscript(raw: string): { speaker: "agent" | "user" | "other"; text: string }[] {
    const result: { speaker: "agent" | "user" | "other"; text: string }[] = [];
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^agent\s*:/i.test(trimmed)) {
            result.push({ speaker: "agent", text: trimmed.replace(/^agent\s*:\s*/i, "") });
        } else if (/^user\s*:/i.test(trimmed)) {
            result.push({ speaker: "user", text: trimmed.replace(/^user\s*:\s*/i, "") });
        } else if (result.length > 0 && result[result.length - 1].speaker !== "other") {
            result[result.length - 1] = {
                ...result[result.length - 1],
                text: result[result.length - 1].text + "\n" + trimmed,
            };
        } else {
            result.push({ speaker: "other", text: trimmed });
        }
    }
    return result;
}

function qualityScoreColor(score: number): string {
    if (score >= 8) return NOTION_COLORS.green.text;
    if (score >= 6) return NOTION_COLORS.yellow.text;
    return NOTION_COLORS.red.text;
}

export function TranscriptViewer({
    call,
    transcriptWithToolCalls,
    isLoadingTranscript,
    onNameClick,
    showViewInTranscripts,
}: TranscriptViewerProps) {
    const [summaryOpen, setSummaryOpen] = useState(true);
    const [headerCollapsed, setHeaderCollapsed] = useState(false);
    const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

    const lines = call.transcript ? parseTranscript(call.transcript) : [];

    function toggleItem(idx: number) {
        setExpandedItems(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx); else next.add(idx);
            return next;
        });
    }

    const hasDetails = !!(
        call.direction || call.outcome || call.sentiment || call.disconnected_reason ||
        (call.quality_score !== undefined && call.quality_score !== null) ||
        (call.appointment_booked !== undefined && call.appointment_booked !== null)
    );

    // ── Enriched item renderers ────────────────────────────────────────────────

    /** Retell-style row: blue chevron + label, click to expand details */
    function renderRetellRow(idx: number, label: string, detail: React.ReactNode, isError = false) {
        const isOpen = expandedItems.has(idx);
        const color = isError ? "#ef4444" : "var(--color-accent)";
        return (
            <div key={idx}>
                <button
                    onClick={() => toggleItem(idx)}
                    className="flex items-center gap-2 w-full text-left py-1 px-1 rounded"
                >
                    <ChevronRight
                        size={14}
                        style={{
                            color,
                            flexShrink: 0,
                            transition: "transform 0.15s",
                            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                        }}
                    />
                    <span className="text-sm" style={{ color }}>{label}</span>
                </button>
                {isOpen && (
                    <div className="ml-6 mt-1 mb-1 pl-3 py-2 rounded-md text-xs" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", maxWidth: "26rem", minWidth: "16rem" }}>
                        {detail}
                    </div>
                )}
            </div>
        );
    }

    function renderNodeTransition(item: Extract<RetellTranscriptItem, { role: "node_transition" }>, idx: number) {
        const detail = (
            <div style={{ color: "var(--color-text-secondary)" }}>
                <p><span style={{ color: "var(--color-text-muted)" }}>previous node:</span> {item.former_node_name}</p>
                <p><span style={{ color: "var(--color-text-muted)" }}>new node:</span> {item.new_node_name}</p>
                <p><span style={{ color: "var(--color-text-muted)" }}>transition type:</span> {item.transition_type}</p>
            </div>
        );
        return renderRetellRow(idx, "Node Transition", detail);
    }

    function renderToolInvocation(item: Extract<RetellTranscriptItem, { role: "tool_call_invocation" }>, idx: number) {
        const hasArgs = item.arguments && item.arguments.trim() && item.arguments.trim() !== "{}";
        const argsText = hasArgs ? tryFormatJson(item.arguments) : "{}";
        
        const detail = (
            <div style={{ color: "var(--color-text-secondary)" }}>
                {item.tool_call_id && (
                    <p className="mb-1"><span style={{ color: "var(--color-text-muted)" }}>tool_call_id:</span> {item.tool_call_id}</p>
                )}
                <pre className="whitespace-pre-wrap break-words leading-relaxed">{argsText}</pre>
            </div>
        );
        return renderRetellRow(idx, `Tool Invocation: ${item.name}`, detail);
    }

    function renderToolResult(item: Extract<RetellTranscriptItem, { role: "tool_call_result" }>, idx: number) {
        const isError = !item.successful;
        const detail = (
            <pre className="whitespace-pre-wrap break-words leading-relaxed" style={{ color: isError ? "#ef4444" : "var(--color-text-secondary)" }}>
                {tryFormatJson(item.content)}
            </pre>
        );
        return renderRetellRow(idx, "Tool Result", detail, isError);
    }

    function renderAgentUserMessage(item: Extract<RetellTranscriptItem, { role: "agent" | "user" }>, idx: number) {
        const timeSec = item.words?.[0]?.start;
        const timeLabel = timeSec != null ? formatTimeSec(timeSec) : null;
        const isUser = item.role === "user";
        const label = isUser ? "User" : "Agent";
        
        const prevItem = idx > 0 ? transcriptWithToolCalls![idx - 1] : null;
        const nextItem = idx < transcriptWithToolCalls!.length - 1 ? transcriptWithToolCalls![idx + 1] : null;
        
        const isFirstInGroup = !prevItem || prevItem.role !== item.role;
        const isLastInGroup = !nextItem || nextItem.role !== item.role;
        
        return (
            <div key={idx} className={`flex flex-col ${isLastInGroup ? "mb-3" : "mb-1"} ${isUser ? "items-end" : "items-start"}`}>
                {isFirstInGroup && (
                    <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${isUser ? "mr-1" : "ml-1"}`} style={{ color: "var(--color-text-muted)" }}>
                        {label}
                    </p>
                )}
                <div 
                    className={isUser ? "chat-bubble-outbound" : "chat-bubble-inbound"}
                    style={{
                        borderTopRightRadius: isUser && !isFirstInGroup ? "4px" : undefined,
                        borderTopLeftRadius: !isUser && !isFirstInGroup ? "4px" : undefined,
                    }}
                >
                    {item.content}
                </div>
                {isLastInGroup && timeLabel && (
                    <p className={`text-xs mt-1 ${isUser ? "mr-1" : "ml-1"}`} style={{ color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                        {timeLabel}
                    </p>
                )}
            </div>
        );
    }

    // ── Render enriched transcript ─────────────────────────────────────────────

    function renderEnrichedTranscript() {
        if (!transcriptWithToolCalls || transcriptWithToolCalls.length === 0) return null;
        return (
            <div className="space-y-1">
                {transcriptWithToolCalls.map((item, idx) => {
                    if (item.role === "node_transition") return renderNodeTransition(item, idx);
                    if (item.role === "tool_call_invocation") return renderToolInvocation(item, idx);
                    if (item.role === "tool_call_result") return renderToolResult(item, idx);
                    if (item.role === "agent" || item.role === "user") return renderAgentUserMessage(item, idx);
                    return null;
                })}
            </div>
        );
    }

    // ── Render plain-text fallback ─────────────────────────────────────────────

    function renderPlainTranscript() {
        if (lines.length === 0) return null;
        return (
            <div className="space-y-2">
                {lines.map((line, i) => {
                    const showLabel = i === 0 || lines[i - 1].speaker !== line.speaker;
                    return (
                        <div key={i} className={`flex flex-col mb-3 ${line.speaker === "user" ? "items-end" : "items-start"}`}>
                            {line.speaker !== "other" && (
                                <>
                                    {showLabel && (
                                        <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${line.speaker === "user" ? "mr-1" : "ml-1"}`} style={{ color: "var(--color-text-muted)" }}>
                                            {line.speaker === "agent" ? "Agent" : "User"}
                                        </p>
                                    )}
                                    <div className={line.speaker === "user" ? "chat-bubble-outbound" : "chat-bubble-inbound"}>
                                        {line.text.split("\n").map((para, pi) => (
                                            <p key={pi} className={pi > 0 ? "mt-3" : ""}>{para}</p>
                                        ))}
                                    </div>
                                </>
                            )}
                            {line.speaker === "other" && (
                                <p className="text-sm italic ml-1" style={{ color: "var(--color-text-muted)" }}>{line.text}</p>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-5 py-4" style={{ borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-bg)" }}>
                {/* Name row + collapse button */}
                <div className="flex items-center justify-between gap-3">
                    {onNameClick ? (
                        <button onClick={onNameClick}
                            className="inline-flex items-center px-3 py-1.5 rounded-full text-base font-medium transition-all text-left bg-white dark:bg-[rgba(255,255,255,0.08)] border border-[#e4e4e2] dark:border-[rgba(255,255,255,0.12)] shadow-sm hover:border-[#c8c8c5] dark:hover:border-[rgba(255,255,255,0.22)] hover:shadow-md"
                            style={{ color: "var(--color-text-primary)" }}>
                            {call.lead_name ?? "Unknown caller"}
                        </button>
                    ) : (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-base font-medium bg-white dark:bg-[rgba(255,255,255,0.08)] border border-[#e4e4e2] dark:border-[rgba(255,255,255,0.12)] shadow-sm"
                            style={{ color: "var(--color-text-primary)" }}>
                            {call.lead_name ?? "Unknown caller"}
                        </span>
                    )}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {showViewInTranscripts && (typeof showViewInTranscripts === "function" ? (
                            <button onClick={showViewInTranscripts} className="flex items-center gap-1 text-sm underline transition-opacity hover:opacity-70" style={{ color: "var(--color-accent)" }}>
                                <ArrowUpRight size={13} /><span>View in Transcripts</span>
                            </button>
                        ) : (
                            <Link href="/call-analytics?tab=transcripts" className="flex items-center gap-1 text-sm underline transition-opacity hover:opacity-70" style={{ color: "var(--color-accent)" }}>
                                <ArrowUpRight size={13} /><span>View in Transcripts</span>
                            </Link>
                        ))}
                        <button onClick={() => setHeaderCollapsed(v => !v)}
                            className="flex items-center justify-center w-6 h-6 rounded-md transition-colors"
                            style={{ color: "var(--color-text-secondary)" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "var(--color-text-primary)")}
                            onMouseLeave={e => (e.currentTarget.style.color = "var(--color-text-secondary)")}>
                            {headerCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                    </div>
                </div>

                {!headerCollapsed && (
                    <div className="mt-2 space-y-1 text-sm">
                        {call.lead_phone && (
                            <p style={{ color: "var(--color-text-secondary)" }}>Phone Number:{" "}<span style={{ color: "var(--color-text-body)" }}>{call.lead_phone}</span></p>
                        )}
                        <p style={{ color: "var(--color-text-secondary)" }}>Date:{" "}<span style={{ color: "var(--color-text-body)" }}>{formatDateTime(call.created_at)}</span></p>
                        {call.duration_seconds != null && (
                            <p style={{ color: "var(--color-text-secondary)" }}>Duration:{" "}<span style={{ color: "var(--color-text-body)" }}>{formatDuration(call.duration_seconds)}</span></p>
                        )}
                    </div>
                )}

                {call.recording_url && (
                    <div style={headerCollapsed ? { height: 0, overflow: "hidden", marginTop: 0 } : { marginTop: 12 }}>
                        <p className="text-sm mb-1.5" style={{ color: "var(--color-text-secondary)" }}>Recording</p>
                        <audio controls src={call.recording_url}
                            style={{ width: "100%", height: 36, accentColor: "var(--color-accent)", borderRadius: 8, display: "block" }} />
                    </div>
                )}

                {!headerCollapsed && hasDetails && (
                    <div className="mt-5 pt-3 flex flex-wrap gap-x-6 gap-y-3 text-sm" style={{ borderTop: "1px solid var(--color-border)" }}>
                        {call.direction && (
                            <div className="flex items-center gap-2">
                                <span style={{ color: "var(--color-text-secondary)" }}>Direction:</span>
                                <span className="font-medium" style={{ color: "var(--color-text-body)" }}>{capitalize(call.direction)}</span>
                            </div>
                        )}
                        {call.outcome && (
                            <div className="flex items-center gap-2">
                                <span style={{ color: "var(--color-text-secondary)" }}>Outcome:</span>
                                <span className={`px-2 py-0.5 rounded-md font-medium text-sm ${OUTCOME_BADGE[call.outcome]}`}>{capitalize(call.outcome)}</span>
                            </div>
                        )}
                        {call.sentiment && (
                            <div className="flex items-center gap-2">
                                <span style={{ color: "var(--color-text-secondary)" }}>Sentiment:</span>
                                <span className={`px-2 py-0.5 rounded-md font-medium text-sm ${SENTIMENT_BADGE[call.sentiment]}`}>{capitalize(call.sentiment)}</span>
                            </div>
                        )}
                        {call.disconnected_reason && (
                            <div className="flex items-center gap-2">
                                <span style={{ color: "var(--color-text-secondary)" }}>Disconnect Reason:</span>
                                <span className="font-medium" style={{ color: "var(--color-text-body)" }}>{formatDisconnectReason(call.disconnected_reason)}</span>
                            </div>
                        )}
                        {call.quality_score !== undefined && call.quality_score !== null && (
                            <div className="flex items-center gap-2">
                                <span style={{ color: "var(--color-text-secondary)" }}>Quality Score:</span>
                                <span className="font-medium" style={{ color: qualityScoreColor(call.quality_score) }}>{call.quality_score}</span>
                            </div>
                        )}
                        {call.appointment_booked !== undefined && call.appointment_booked !== null && (
                            <div className="flex items-center gap-2">
                                <span style={{ color: "var(--color-text-secondary)" }}>Appointment Booked:</span>
                                <span className="font-medium" style={{ color: call.appointment_booked ? NOTION_COLORS.green.text : NOTION_COLORS.red.text }}>
                                    {call.appointment_booked ? "Yes" : "No"}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ backgroundColor: "var(--color-bg)" }}>
                {/* AI Summary */}
                {call.transcript_summary && (
                    <div className="rounded-xl" style={{ backgroundColor: "var(--color-accent-subtle)", border: "1px solid rgba(35,131,226,0.15)" }}>
                        <button onClick={() => setSummaryOpen(v => !v)}
                            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
                            style={{ color: "var(--color-accent)" }}>
                            <span>AI Summary</span>
                            {summaryOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {summaryOpen && (
                            <div className="px-4 pb-3 text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                                {call.transcript_summary}
                            </div>
                        )}
                    </div>
                )}

                {/* Transcript */}
                {isLoadingTranscript ? (
                    <div className="flex items-center justify-center py-12"><Spinner /></div>
                ) : transcriptWithToolCalls && transcriptWithToolCalls.length > 0 ? (
                    renderEnrichedTranscript()
                ) : lines.length > 0 ? (
                    renderPlainTranscript()
                ) : (
                    <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
                        No transcript available for this call.
                    </p>
                )}
            </div>
        </div>
    );
}
