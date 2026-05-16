"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { createAppointment, fetchBookedSlotsForDate } from "@/app/actions";
import { MOCK_LEADS, MOCK_APPOINTMENTS } from "@/lib/mock-data";
import { useToast } from "@/components/ui/toast-provider";
import { createClient } from "@/lib/supabase/client";
import { AppointmentDatePicker } from "./appointment-date-picker";
import { SimpleSelect } from "@/components/simple-select";
import { getSlotsForDate } from "@/lib/appointment-slots";
import { ExpandableTextarea } from "@/components/expandable-textarea";
import type { Appointment, StudioSlotConfig } from "@/lib/types";

interface CreateAppointmentModalProps {
    studioId: string;
    slotConfig: StudioSlotConfig;
    onClose: () => void;
    onCreated: (appt: Appointment) => void;
}

interface LeadOption {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    ghl_contact_id: string | null;
}

const INPUT_STYLE = {
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    color: "var(--color-text-primary)",
    fontSize: 14,
    padding: "8px 12px",
    width: "100%",
    outline: "none",
};

const LABEL_STYLE: React.CSSProperties = {
    display: "block",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.02em",
    color: "var(--color-text-secondary)",
    marginBottom: 6,
};

export function CreateAppointmentModal({
    studioId,
    slotConfig,
    onClose,
    onCreated,
}: CreateAppointmentModalProps) {
    const [dateVal, setDateVal] = useState("");
    const [timeVal, setTimeVal] = useState("");
    const [notes, setNotes] = useState("");
    const [title, setTitle] = useState("Dance Appointment");
    const [saving, setSaving] = useState(false);
    const { showError } = useToast();

    const [leads, setLeads] = useState<LeadOption[]>([]);
    const [totalLeads, setTotalLeads] = useState(0);
    const [leadsLoading, setLeadsLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedContacts, setSelectedContacts] = useState<LeadOption[]>([]);
    const [bookedSlots, setBookedSlots] = useState<string[]>([]);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const q = search.trim();
        if (!q) {
            setLeads([]);
            setTotalLeads(0);
            setLeadsLoading(false);
            return;
        }
        // Mock lead search
        const words = q.toLowerCase().split(/\s+/);
        const results = MOCK_LEADS
            .filter(l => l.ghl_contact_id && words.every(w => l.name.toLowerCase().includes(w)))
            .slice(0, 50)
            .map(l => ({ id: l.id, name: l.name, email: l.email, phone: l.phone, ghl_contact_id: l.ghl_contact_id }));
        setLeads(results as LeadOption[]);
        setTotalLeads(results.length);
        setLeadsLoading(false);
    }, [search, studioId]);

    useEffect(() => {
        if (!dateVal) { setBookedSlots([]); setTimeVal(""); return; }
        // Mock booked slots — derive from mock appointments for the selected date
        const booked = MOCK_APPOINTMENTS
            .filter(a => !a.deleted_at && a.start_time.startsWith(dateVal))
            .map(a => a.start_time.slice(11, 16)); // "HH:MM"
        setBookedSlots(booked);
        const slots = getSlotsForDate(dateVal, slotConfig);
        const first = slots?.find(s => !booked.includes(s.value));
        setTimeVal(first?.value ?? "");
    }, [dateVal, slotConfig, studioId]); // eslint-disable-line react-hooks/exhaustive-deps

    const filtered = useMemo(
        () => leads.filter((l) => !selectedContacts.some((s) => s.id === l.id)),
        [leads, selectedContacts],
    );

    function addContact(lead: LeadOption) {
        setSelectedContacts((prev) => [...prev, lead]);
        setSearch("");
    }

    function removeContact(id: string) {
        setSelectedContacts((prev) => prev.filter((c) => c.id !== id));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (selectedContacts.length === 0) {
            showError("Please select at least one contact.");
            return;
        }
        if (!dateVal) {
            showError("Please select a date.");
            return;
        }
        const unsynced = selectedContacts.find((c) => !c.ghl_contact_id);
        if (unsynced) {
            showError(`${unsynced.name} has no GHL contact ID — sync them to GHL first.`);
            return;
        }
        if (!timeVal) {
            showError("Please select a time slot.");
            return;
        }

        setSaving(true);

        const durationMs = slotConfig.appointment_duration_minutes * 60 * 1000;
        const startISO = `${dateVal}T${timeVal}:00`;
        const endISO = new Date(new Date(startISO + "Z").getTime() + durationMs)
            .toISOString()
            .substring(0, 19);

        // Mock create — generate local appointment objects
        const mockAppts: Appointment[] = selectedContacts.map((c) => ({
            id: `appt-mock-${Date.now()}-${c.id}`,
            studio_id: studioId,
            title: title || "Dance Appointment",
            start_time: startISO,
            end_time: endISO,
            status: "confirmed",
            calendar_id: "cal-001",
            calendar_name: "Lessons",
            contact_id: c.ghl_contact_id!,
            contact_name: c.name,
            assigned_user_id: null,
            assigned_user_name: null,
            notes: notes || null,
            address: "300 N Milwaukee Ave, Lincolnshire, IL 60069",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }));

        setSaving(false);
        mockAppts.forEach((a) => onCreated(a));
        onClose();
    }

    const slots = dateVal ? getSlotsForDate(dateVal, slotConfig) : null;
    const slotOptions = (slots ?? []).filter(s => !bookedSlots.includes(s.value));

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            <div
                className="relative w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col"
                style={{
                    backgroundColor: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    minHeight: 500,
                    maxHeight: "90vh",
                }}
            >
                {/* Header */}
                <div
                    className="flex items-center justify-between px-6 py-4"
                    style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                    <h2
                        className="text-base font-semibold"
                        style={{ color: "var(--color-text-primary)" }}
                    >
                        Book Appointment
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: "var(--color-text-muted)" }}
                        onMouseEnter={(e) =>
                            ((
                                e.currentTarget as HTMLElement
                            ).style.backgroundColor = "var(--color-surface)")
                        }
                        onMouseLeave={(e) =>
                            ((
                                e.currentTarget as HTMLElement
                            ).style.backgroundColor = "transparent")
                        }
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <form
                    onSubmit={handleSubmit}
                    className="flex flex-col flex-1 min-h-0"
                >
                    <div className="flex flex-1 px-6 py-5 gap-6 min-h-0">
                        {/* ── Left column ─────────────────────────────────── */}
                        <div className="flex-1 min-w-0 flex flex-col gap-6">
                            {/* Appointment Title */}
                            <div>
                                <label style={LABEL_STYLE}>
                                    Appointment Title{" "}
                                    <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    style={INPUT_STYLE}
                                    placeholder="Dance Appointment"
                                    onFocus={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.boxShadow =
                                            "0 0 0 2px var(--color-accent)")
                                    }
                                    onBlur={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.boxShadow = "none")
                                    }
                                />
                            </div>

                            {/* Date + Slot row */}
                            <div className="flex gap-3">
                                <div className="flex-1 min-w-0">
                                    <label style={LABEL_STYLE}>
                                        Date{" "}
                                        <span className="text-red-500">*</span>
                                    </label>
                                    <AppointmentDatePicker
                                        value={dateVal}
                                        config={slotConfig}
                                        onChange={(newDate) => {
                                            setDateVal(newDate);
                                        }}
                                        className="w-full"
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <label style={LABEL_STYLE}>
                                        Slot{" "}
                                        <span className="text-red-500">*</span>
                                    </label>
                                    {slotOptions.length > 0 ? (
                                        <SimpleSelect
                                            value={timeVal}
                                            onChange={(v) => {
                                                setTimeVal(v);
                                            }}
                                            options={slotOptions}
                                            placeholder="Select a slot…"
                                            fullWidth
                                            clearable={false}
                                        />
                                    ) : (
                                        <div
                                            className="flex items-center px-3 py-2 rounded-lg text-sm"
                                            style={{
                                                border: "1px solid var(--color-border)",
                                                backgroundColor:
                                                    "var(--color-surface)",
                                                color: "var(--color-text-muted)",
                                                cursor: "not-allowed",
                                            }}
                                        >
                                            {dateVal
                                                ? "No slots on this day."
                                                : "Select a date first…"}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label style={LABEL_STYLE}>Description </label>
                                <ExpandableTextarea
                                    value={notes}
                                    onChange={setNotes}
                                    placeholder="Add a description…"
                                    rows={5}
                                    label="Description"
                                    style={INPUT_STYLE}
                                    onFocus={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.boxShadow =
                                            "0 0 0 2px var(--color-accent)")
                                    }
                                    onBlur={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.boxShadow = "none")
                                    }
                                />
                            </div>
                        </div>

                        {/* ── Right column — Contact ───────────────────────── */}
                        <div
                            className="w-80 flex-shrink-0 flex flex-col gap-3"
                            style={{
                                borderLeft: "1px solid var(--color-border)",
                                paddingLeft: 20,
                            }}
                        >
                            {/* Label + Search input — wrapped so they sit flush like left column */}
                            <div>
                                <label style={LABEL_STYLE}>
                                    Select Contact{" "}
                                    <span className="text-red-500">*</span>
                                </label>

                                {/* Search input + fixed-position dropdown overlay */}
                                <div className="relative">
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        value={search}
                                        onChange={(e) => {
                                            setSearch(e.target.value);
                                        }}
                                        style={INPUT_STYLE}
                                        placeholder="Search by name…"
                                        autoComplete="off"
                                        onFocus={(e) =>
                                            ((
                                                e.currentTarget as HTMLElement
                                            ).style.boxShadow =
                                                "0 0 0 2px var(--color-accent)")
                                        }
                                        onBlur={(e) =>
                                            ((
                                                e.currentTarget as HTMLElement
                                            ).style.boxShadow = "none")
                                        }
                                    />
                                    {search.trim() &&
                                        (() => {
                                            const r =
                                                searchInputRef.current?.getBoundingClientRect();
                                            if (!r) return null;
                                            return (
                                                <div
                                                    style={{
                                                        position: "fixed",
                                                        top: r.bottom + 4,
                                                        left: r.left,
                                                        width: r.width,
                                                        zIndex: 9999,
                                                        backgroundColor:
                                                            "var(--color-bg)",
                                                        border: "1px solid var(--color-border)",
                                                        borderRadius: 8,
                                                        overflow: "hidden",
                                                        boxShadow:
                                                            "0 8px 24px rgba(0,0,0,0.15)",
                                                    }}
                                                >
                                                    <div className="max-h-[220px] overflow-y-auto">
                                                        {leadsLoading ? (
                                                            <p
                                                                className="px-3 py-3 text-xs"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                Searching…
                                                            </p>
                                                        ) : filtered.length ===
                                                          0 ? (
                                                            <p
                                                                className="px-3 py-3 text-xs"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                No leads found.
                                                            </p>
                                                        ) : (
                                                            <>
                                                                {filtered.map(
                                                                    (lead) => {
                                                                        const sub =
                                                                            lead.email ||
                                                                            lead.phone ||
                                                                            null;
                                                                        return (
                                                                            <button
                                                                                key={
                                                                                    lead.id
                                                                                }
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    addContact(
                                                                                        lead,
                                                                                    )
                                                                                }
                                                                                className="w-full text-left px-3 py-2.5 flex items-center transition-colors"
                                                                                style={{
                                                                                    borderBottom:
                                                                                        "1px solid var(--color-border)",
                                                                                    backgroundColor:
                                                                                        "transparent",
                                                                                    color: "var(--color-text-primary)",
                                                                                }}
                                                                                onMouseEnter={(
                                                                                    e,
                                                                                ) =>
                                                                                    ((
                                                                                        e.currentTarget as HTMLElement
                                                                                    ).style.backgroundColor =
                                                                                        "var(--color-surface-hover)")
                                                                                }
                                                                                onMouseLeave={(
                                                                                    e,
                                                                                ) =>
                                                                                    ((
                                                                                        e.currentTarget as HTMLElement
                                                                                    ).style.backgroundColor =
                                                                                        "transparent")
                                                                                }
                                                                            >
                                                                                <span className="min-w-0">
                                                                                    <span className="block text-sm truncate">
                                                                                        {
                                                                                            lead.name
                                                                                        }
                                                                                    </span>
                                                                                    {sub && (
                                                                                        <span
                                                                                            className="block text-xs truncate"
                                                                                            style={{
                                                                                                color: "var(--color-text-muted)",
                                                                                            }}
                                                                                        >
                                                                                            {
                                                                                                sub
                                                                                            }
                                                                                        </span>
                                                                                    )}
                                                                                </span>
                                                                            </button>
                                                                        );
                                                                    },
                                                                )}
                                                                {totalLeads >
                                                                    leads.length && (
                                                                    <p
                                                                        className="px-3 py-2.5 text-xs select-none"
                                                                        style={{
                                                                            color: "var(--color-text-muted)",
                                                                            borderTop:
                                                                                "1px solid var(--color-border)",
                                                                        }}
                                                                    >
                                                                        +{" "}
                                                                        {totalLeads -
                                                                            leads.length}{" "}
                                                                        more
                                                                    </p>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                </div>
                            </div>

                            {/* Selected contact cards — scrollable */}
                            {selectedContacts.length > 0 && (
                                <div
                                    className="flex flex-col gap-2 overflow-y-auto"
                                    style={{ maxHeight: 250 }}
                                >
                                    {selectedContacts.map((contact) => (
                                        <div
                                            key={contact.id}
                                            className="rounded-lg p-3 flex items-center justify-between gap-2 flex-shrink-0"
                                            style={{
                                                border: "1px solid var(--color-border)",
                                                backgroundColor:
                                                    "var(--color-surface)",
                                            }}
                                        >
                                            <div className="min-w-0">
                                                <p
                                                    className="text-sm font-medium truncate"
                                                    style={{
                                                        color: "var(--color-text-body)",
                                                    }}
                                                >
                                                    {contact.name}
                                                </p>
                                                {(contact.email ||
                                                    contact.phone) && (
                                                    <p
                                                        className="text-xs truncate mt-0.5"
                                                        style={{
                                                            color: "var(--color-text-muted)",
                                                        }}
                                                    >
                                                        {contact.email ||
                                                            contact.phone}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    removeContact(contact.id)
                                                }
                                                className="flex-shrink-0 rounded p-0.5 transition-colors"
                                                style={{
                                                    color: "var(--color-text-muted)",
                                                }}
                                                onMouseEnter={(e) =>
                                                    ((
                                                        e.currentTarget as HTMLElement
                                                    ).style.color =
                                                        "var(--color-text-primary)")
                                                }
                                                onMouseLeave={(e) =>
                                                    ((
                                                        e.currentTarget as HTMLElement
                                                    ).style.color =
                                                        "var(--color-text-muted)")
                                                }
                                                title="Remove contact"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div
                        className="px-6 py-4 mt-auto flex items-center justify-end gap-3"
                        style={{ borderTop: "1px solid var(--color-border)" }}
                    >
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium transition-colors rounded-lg"
                                style={{ color: "var(--color-text-secondary)" }}
                                onMouseEnter={(e) =>
                                    ((
                                        e.currentTarget as HTMLElement
                                    ).style.backgroundColor =
                                        "var(--color-surface)")
                                }
                                onMouseLeave={(e) =>
                                    ((
                                        e.currentTarget as HTMLElement
                                    ).style.backgroundColor = "transparent")
                                }
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="btn-primary px-4 py-2 text-sm font-medium disabled:opacity-60"
                            >
                                {saving ? "Booking…" : "Book Appointment"}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
