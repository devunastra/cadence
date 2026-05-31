"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentStudio } from "@/components/studio-context";
import type { Appointment } from "@/lib/types";

interface CalendarGridProps {
    weekStart: Date;
    appointments: Appointment[];
    onSelect: (appointment: Appointment) => void;
    hourStart: number;
    hourEnd: number;
}

const STATUS_COLORS: Record<
    string,
    { bg: string; text: string; border: string }
> = {
    confirmed: {
        bg: "var(--badge-blue-bg)",
        text: "var(--badge-blue-text)",
        border: "var(--color-accent)",
    },
    showed: {
        bg: "var(--badge-green-bg)",
        text: "var(--badge-green-text)",
        border: "var(--badge-green-border)",
    },
    cancelled: {
        bg: "var(--badge-gray-bg)",
        text: "var(--badge-gray-text)",
        border: "var(--badge-gray-border)",
    },
    deleted: {
        bg: "var(--badge-gray-bg)",
        text: "var(--badge-gray-text)",
        border: "var(--badge-gray-border)",
    },
    noshow: {
        bg: "var(--badge-red-bg)",
        text: "var(--badge-red-text)",
        border: "var(--badge-red-border)",
    },
};
const DEFAULT_COLOR = {
    bg: "var(--badge-purple-bg)",
    text: "var(--badge-purple-text)",
    border: "var(--badge-purple-border)",
};

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MIN_slotH = 80; // ← minimum slot height (small screens / many hours)
const MAX_SLOT_H = 100; // ← maximum slot height (large screens)
function isSameDay(a: Date, b: Date, tz: string) {
    const fmt = (d: Date) =>
        d.toLocaleDateString("en-CA", { timeZone: tz });
    return fmt(a) === fmt(b);
}

function formatHour(h: number) {
    if (h === 0) return "12 AM";
    if (h < 12) return `${h} AM`;
    if (h === 12) return "12 PM";
    return `${h - 12} PM`;
}

// Parse appointment ISO string as UTC for date-only comparisons
const asUTCDate = (iso: string) => new Date(iso.substring(0, 19) + "Z");

// Read hours + minutes directly from the stored ISO string.
// Times are stored as plain local studio time (no UTC offset applied),
// so we must NOT do a UTC→timezone conversion here.
function localHourFraction(iso: string): number {
    const h = parseInt(iso.substring(11, 13), 10);
    const m = parseInt(iso.substring(14, 16), 10);
    return h + m / 60;
}

function formatApptTime(iso: string) {
    const h = parseInt(iso.substring(11, 13), 10);
    const m = parseInt(iso.substring(14, 16), 10);
    const period = h < 12 ? "AM" : "PM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0
        ? `${hour12} ${period}`
        : `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function getApptStyle(
    appt: Appointment,
    hourStart: number,
    hourEnd: number,
    slotH: number,
) {
    const startH = localHourFraction(appt.start_time);
    const endH = localHourFraction(appt.end_time);

    const clampedStart = Math.max(startH, hourStart);
    const clampedEnd = Math.min(endH, hourEnd);

    const top = (clampedStart - hourStart) * slotH;
    const height = Math.max((clampedEnd - clampedStart) * slotH, 20);

    const colorKey = appt.deleted_at ? "deleted" : (appt.status ?? "")
    const colors = STATUS_COLORS[colorKey] ?? DEFAULT_COLOR;
    return { top, height, ...colors };
}

export function CalendarGrid({
    weekStart,
    appointments,
    onSelect,
    hourStart,
    hourEnd,
}: CalendarGridProps) {
    const { currentStudio } = useCurrentStudio();
    const tz = currentStudio.timezone;
    const today = new Date();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [slotH, setSlotH] = useState(MIN_slotH);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const numHours = hourEnd - hourStart + 1;
        const compute = () => {
            const available = el.clientHeight - 16;
            setSlotH(
                Math.min(
                    MAX_SLOT_H,
                    Math.max(MIN_slotH, Math.floor(available / numHours)),
                ),
            );
        };
        compute();
        const ro = new ResizeObserver(compute);
        ro.observe(el);
        return () => ro.disconnect();
    }, [hourStart, hourEnd]);

    // Use time arithmetic — weekStart is studio-tz midnight as UTC, so +i days stays aligned
    const days = Array.from(
        { length: 7 },
        (_, i) => new Date(weekStart.getTime() + i * 86_400_000),
    );

    const hours = Array.from(
        { length: hourEnd - hourStart },
        (_, i) => hourStart + i,
    );
    const totalHeight = (hours.length + 1) * slotH; // +1 for end label

    return (
        <div
            className="rounded-2xl overflow-hidden flex flex-col flex-1 min-h-0 border border-[#e9e9e7] dark:border-[rgba(255,255,255,0.07)] shadow-sm"
            style={{ backgroundColor: "var(--color-bg)" }}
        >
            {/* Single scroll container — header inside so scrollbar covers full height, preventing misalignment */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
                {/* Sticky day headers */}
                <div
                    className="sticky top-0 z-10 flex flex-shrink-0"
                    style={{
                        borderBottom: "1px solid var(--color-border)",
                        backgroundColor: "var(--color-surface)",
                    }}
                >
                    <div
                        className="w-16 flex-shrink-0"
                        style={{ borderRight: "1px solid var(--color-border)" }}
                    />
                    {days.map((day, i) => {
                        const isToday = isSameDay(day, today, tz);
                        const isPast =
                            !isToday && day < today && !isSameDay(day, today, tz);
                        const color = isToday
                            ? "var(--color-accent)"
                            : isPast
                              ? "var(--color-text-muted)"
                              : "var(--color-text-body)";
                        return (
                            <div
                                key={i}
                                className="flex-1 py-2 text-center"
                                style={{
                                    borderRight:
                                        i < 6
                                            ? "1px solid var(--color-border)"
                                            : undefined,
                                    backgroundColor: isToday
                                        ? "var(--color-accent-subtle)"
                                        : "transparent",
                                }}
                            >
                                <p
                                    className="text-lg font-semibold"
                                    style={{ color }}
                                >
                                    {DAY_HEADERS[i]}
                                </p>
                                <p
                                    className="text-lg font-bold mt-0.5 leading-none"
                                    style={{ color }}
                                >
                                    {day.getDate()}
                                </p>
                            </div>
                        );
                    })}
                </div>

                <div
                    className="flex"
                    style={{ height: totalHeight + 16, paddingTop: 16 }}
                >
                    {/* Time labels column */}
                    <div
                        className="w-16 flex-shrink-0 relative"
                        style={{ borderRight: "1px solid var(--color-border)" }}
                    >
                        {hours.map((h) => (
                            <div
                                key={h}
                                className="absolute left-0 right-0 flex items-start justify-end pr-2"
                                style={{
                                    top: (h - hourStart) * slotH - 8,
                                    height: slotH,
                                }}
                            >
                                <span
                                    className="text-xs font-medium"
                                    style={{ color: "var(--color-text-body)" }}
                                >
                                    {formatHour(h)}
                                </span>
                            </div>
                        ))}
                        {/* End-of-day label (e.g. 9 PM) */}
                        <div
                            className="absolute left-0 right-0 flex items-start justify-end pr-2"
                            style={{ top: hours.length * slotH - 8 }}
                        >
                            <span
                                className="text-xs font-medium"
                                style={{ color: "var(--color-text-body)" }}
                            >
                                {formatHour(hourEnd)}
                            </span>
                        </div>
                    </div>

                    {/* Day columns */}
                    {days.map((day, i) => {
                        const isToday = isSameDay(day, today, tz);
                        const dayAppts = appointments.filter((a) =>
                            isSameDay(asUTCDate(a.start_time), day, tz),
                        );

                        return (
                            <div
                                key={i}
                                className="flex-1 relative"
                                style={{
                                    borderRight:
                                        i < 6
                                            ? "1px solid var(--color-border)"
                                            : undefined,
                                    backgroundColor: isToday
                                        ? "rgba(35,131,226,0.05)"
                                        : "transparent",
                                }}
                            >
                                {/* Hour grid lines */}
                                {hours.map((h) => (
                                    <div
                                        key={h}
                                        className="absolute left-0 right-0"
                                        style={{
                                            top: (h - hourStart) * slotH,
                                            borderTop:
                                                "1px solid var(--color-border)",
                                        }}
                                    />
                                ))}
                                {/* End-of-day grid line */}
                                <div
                                    className="absolute left-0 right-0"
                                    style={{
                                        top: hours.length * slotH,
                                        borderTop:
                                            "1px solid var(--color-border)",
                                    }}
                                />

                                {/* Appointments */}
                                {[...dayAppts]
                                    .sort((a, b) => localHourFraction(a.start_time) - localHourFraction(b.start_time))
                                    .map((appt, idx, sorted) => {
                                    const { top, height, bg, text, border } =
                                        getApptStyle(
                                            appt,
                                            hourStart,
                                            hourEnd,
                                            slotH,
                                        );
                                    const next = sorted[idx + 1]
                                    const adjacentToNext = next
                                        && Math.abs(localHourFraction(appt.end_time) - localHourFraction(next.start_time)) <= 5 / 60
                                    const bottomGap = adjacentToNext ? 4 : 0
                                    return (
                                        <button
                                            key={appt.id}
                                            onClick={() => onSelect(appt)}
                                            className="absolute left-0.5 right-0.5 rounded-md border-l-2 px-1.5 py-0.5 text-left overflow-hidden hover:brightness-90 transition-[filter]"
                                            style={{
                                                top,
                                                height: height - bottomGap,
                                                backgroundColor: bg,
                                                borderColor: border,
                                                color: text,
                                                zIndex: 1,
                                            }}
                                        >
                                            <p
                                                className="text-sm font-semibold leading-tight truncate"
                                                style={{
                                                    color: "var(--color-text-body)",
                                                }}
                                            >
                                                {appt.title || "Appointment"}
                                            </p>
                                            {height > 22 && (
                                                <p
                                                    className="text-xs truncate opacity-80 mt-0.5"
                                                    style={{
                                                        color: "var(--color-text-body)",
                                                    }}
                                                >
                                                    {formatApptTime(
                                                        appt.start_time,
                                                    )}
                                                    {appt.end_time
                                                        ? ` – ${formatApptTime(appt.end_time)}`
                                                        : ""}
                                                </p>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
