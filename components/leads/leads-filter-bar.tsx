"use client";

import { useState, useRef, useEffect } from "react";
import {
    Filter,
    ArrowUpDown,
    Search,
    X,
    ArrowUp,
    ArrowDown,
    ChevronDown,
    RefreshCw,
} from "lucide-react";
import { FieldOption } from "@/lib/field-options";
import { FilterDropdown } from "./filter-dropdown";

const SORT_FIELDS: { key: string; label: string }[] = [
    { key: "created_at", label: "Created time" },
    { key: "name", label: "Name" },
    { key: "last_contacted", label: "Last contacted" },
    { key: "first_lesson", label: "First lesson" },
    { key: "phone", label: "Phone" },
];

const SORT_DIRECTIONS: { key: string; label: string }[] = [
    { key: "desc", label: "Descending" },
    { key: "asc", label: "Ascending" },
];

interface LeadsFilterBarProps {
    onSearchChange: (v: string) => void;
    statusFilter: string[];
    onStatusFilterChange: (v: string[]) => void;
    levelFilter: string[];
    onLevelFilterChange: (v: string[]) => void;
    actionFilter: string[];
    onActionFilterChange: (v: string[]) => void;
    sourceFilter: string[];
    onSourceFilterChange: (v: string[]) => void;
    reasonFilter: string[];
    onReasonFilterChange: (v: string[]) => void;
    fieldOptions: Record<string, FieldOption[]>;
    sortField: string;
    sortAscending: boolean;
    onSortChange: (field: string, ascending: boolean) => void;
    onRefresh: () => void;
}

/* Shared pill button style helper */
function pillStyle(active: boolean): React.CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        fontSize: 14,
        lineHeight: "1.25rem",
        fontWeight: 500,
        borderRadius: 8,
        cursor: "pointer",
        border: '1px solid var(--color-border)',
        boxShadow: active ? '0 0 0 2px var(--color-accent)' : 'none',
        backgroundColor: active ? "var(--color-surface)" : "var(--color-bg)",
        color: active
            ? "var(--color-text-primary)"
            : "var(--color-text-secondary)",
        transition: `background var(--transition-fast), color var(--transition-fast)`,
        whiteSpace: "nowrap" as const,
    };
}

function onPillEnter(e: React.MouseEvent) {
    const el = e.currentTarget as HTMLElement;
    el.style.backgroundColor = "var(--color-surface-hover)";
    el.style.color = "var(--color-text-primary)";
}

function onPillLeave(e: React.MouseEvent, active: boolean) {
    if (active) return;
    const el = e.currentTarget as HTMLElement;
    el.style.backgroundColor = "var(--color-bg)";
    el.style.color = "var(--color-text-secondary)";
}

/* Custom select for sort panel — matches FilterDropdown style */
function SortSelect({
    value,
    onChange,
    options,
}: {
    value: string;
    onChange: (v: string) => void;
    options: { key: string; label: string }[];
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = options.find((o) => o.key === value);

    useEffect(() => {
        if (!open) return;
        function h(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node))
                setOpen(false);
        }
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [open]);

    return (
        <div ref={ref} className="relative flex-1 md:flex-none">
            <button
                onClick={() => setOpen((o) => !o)}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm rounded-lg w-full md:w-auto"
                style={{
                    minWidth: 130,
                    border: "1px solid var(--color-border)",
                    boxShadow: open ? "0 0 0 2px var(--color-accent)" : "none",
                    backgroundColor: "var(--color-surface)",
                    color: "var(--color-text-primary)",
                    fontWeight: 500,
                    transition: "background var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-bg)";
                }}
                onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)";
                }}
            >
                <span className="truncate">{selected?.label ?? value}</span>
                <ChevronDown
                    size={13}
                    style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
                />
            </button>

            {open && (
                <div
                    className="absolute top-full left-0 mt-1 z-50 rounded-xl py-1 overflow-hidden"
                    style={{
                        minWidth: "100%",
                        backgroundColor: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                    }}
                >
                    {options.map((opt) => (
                        <button
                            key={opt.key}
                            onClick={() => {
                                onChange(opt.key);
                                setOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
                            style={{
                                backgroundColor:
                                    value === opt.key
                                        ? "var(--color-accent)"
                                        : "transparent",
                                color:
                                    value === opt.key
                                        ? "#ffffff"
                                        : "var(--color-text-secondary)",
                                fontWeight: value === opt.key ? 500 : 400,
                                transition: "none",
                            }}
                            onMouseEnter={(e) => {
                                if (value !== opt.key)
                                    (
                                        e.currentTarget as HTMLElement
                                    ).style.backgroundColor =
                                        "var(--color-surface-hover)";
                            }}
                            onMouseLeave={(e) => {
                                if (value !== opt.key)
                                    (
                                        e.currentTarget as HTMLElement
                                    ).style.backgroundColor = "transparent";
                            }}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function LeadsFilterBar({
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    levelFilter,
    onLevelFilterChange,
    actionFilter,
    onActionFilterChange,
    sourceFilter,
    onSourceFilterChange,
    reasonFilter,
    onReasonFilterChange,
    fieldOptions,
    sortField,
    sortAscending,
    onSortChange,
    onRefresh,
}: LeadsFilterBarProps) {
    const [filterOpen, setFilterOpen] = useState(false);
    const [sortOpen, setSortOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchFocused, setSearchFocused] = useState(false);
    const [spinning, setSpinning] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const filterRef = useRef<HTMLDivElement>(null);
    const sortRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const toStringOptions = (field: string) =>
        (fieldOptions[field] ?? []).map((o) => o.value);

    const activeFilterCount = [
        statusFilter,
        levelFilter,
        actionFilter,
        sourceFilter,
        reasonFilter,
    ].filter((v) => v.length > 0).length;

    function clearAllFilters() {
        onStatusFilterChange([]);
        onLevelFilterChange([]);
        onActionFilterChange([]);
        onSourceFilterChange([]);
        onReasonFilterChange([]);
    }

    const isSortCustom = !(sortField === "created_at" && !sortAscending);

    // Outside-click close for filter
    useEffect(() => {
        if (!filterOpen) return;
        function h(e: MouseEvent) {
            if (
                filterRef.current &&
                !filterRef.current.contains(e.target as Node)
            )
                setFilterOpen(false);
        }
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [filterOpen]);

    // Outside-click close for sort
    useEffect(() => {
        if (!sortOpen) return;
        function h(e: MouseEvent) {
            if (sortRef.current && !sortRef.current.contains(e.target as Node))
                setSortOpen(false);
        }
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [sortOpen]);

    // Focus search input when opened
    useEffect(() => {
        if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 20);
    }, [searchOpen]);

    function handleSearchClose() {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        setInputValue('');
        onSearchChange('');
        setSearchOpen(false);
    }

    return (
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {/* ── Search — full-width on mobile (first row), 240px on desktop ── */}
            <div className="order-first md:order-last basis-full md:basis-auto md:w-60 md:shrink-0">
                {searchOpen ? (
                    <div
                        className="flex items-center gap-2 px-3 w-full"
                        style={{
                            height: 36,
                            border: searchFocused ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                            borderRadius: 8,
                            backgroundColor: "var(--color-bg)",
                        }}
                    >
                        <Search
                            size={13}
                            style={{
                                color: "var(--color-text-muted)",
                                flexShrink: 0,
                            }}
                        />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search by name…"
                            value={inputValue}
                            onChange={(e) => {
                                const v = e.target.value;
                                setInputValue(v);
                                if (searchTimer.current) clearTimeout(searchTimer.current);
                                searchTimer.current = setTimeout(() => onSearchChange(v), 350);
                            }}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setSearchFocused(false)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") handleSearchClose();
                            }}
                            className="text-base md:text-sm outline-none bg-transparent flex-1 min-w-0"
                            style={{ color: "var(--color-text-primary)" }}
                        />
                        <button
                            onClick={handleSearchClose}
                            style={{
                                color: "var(--color-text-muted)",
                                flexShrink: 0,
                            }}
                            onMouseEnter={(e) =>
                                ((e.currentTarget as HTMLElement).style.color =
                                    "var(--color-text-secondary)")
                            }
                            onMouseLeave={(e) =>
                                ((e.currentTarget as HTMLElement).style.color =
                                    "var(--color-text-muted)")
                            }
                        >
                            <X size={12} />
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setSearchOpen(true)}
                        className="w-full flex items-center gap-1.5 px-3"
                        style={{
                            height: 36,
                            fontSize: 14,
                            fontWeight: 500,
                            borderRadius: 8,
                            cursor: "pointer",
                            border: `1px solid ${inputValue ? "var(--color-border-strong)" : "var(--color-border)"}`,
                            backgroundColor: inputValue
                                ? "var(--color-surface)"
                                : "var(--color-bg)",
                            color: "var(--color-text-secondary)",
                            transition: `background var(--transition-fast), color var(--transition-fast)`,
                        }}
                        onMouseEnter={(e) => {
                            (
                                e.currentTarget as HTMLElement
                            ).style.backgroundColor =
                                "var(--color-surface-hover)";
                            (e.currentTarget as HTMLElement).style.color =
                                "var(--color-text-primary)";
                        }}
                        onMouseLeave={(e) => {
                            if (!inputValue)
                                (
                                    e.currentTarget as HTMLElement
                                ).style.backgroundColor = "var(--color-bg)";
                            (e.currentTarget as HTMLElement).style.color =
                                "var(--color-text-secondary)";
                        }}
                    >
                        <Search size={14} style={{ flexShrink: 0 }} />
                        <span className="flex-1 text-left truncate">
                            {inputValue
                                ? `"${inputValue.slice(0, 14)}${inputValue.length > 14 ? "…" : ""}"`
                                : "Search by name…"}
                        </span>
                    </button>
                )}
            </div>

            {/* ── Refresh ── */}
            <button
                onClick={() => {
                    setSpinning(true);
                    onRefresh();
                    setTimeout(() => setSpinning(false), 600);
                }}
                title="Refresh leads"
                style={{ ...pillStyle(false), padding: "9px 10px" }}
                onMouseEnter={onPillEnter}
                onMouseLeave={(e) => onPillLeave(e, false)}
            >
                <RefreshCw
                    size={14}
                    className={spinning ? "animate-spin" : ""}
                />
            </button>

            {/* ── Filter pill ── */}
            <div ref={filterRef} className="relative">
                <button
                    onClick={() => setFilterOpen((o) => !o)}
                    style={pillStyle(filterOpen)}
                    onMouseEnter={onPillEnter}
                    onMouseLeave={(e) => onPillLeave(e, filterOpen)}
                >
                    <Filter size={14} />
                    Filter
                    {activeFilterCount > 0 && (
                        <span
                            className="flex items-center justify-center text-xs font-semibold rounded-full"
                            style={{ minWidth: 18, height: 18, padding: '0 5px', backgroundColor: 'var(--color-accent)', color: '#ffffff' }}
                        >
                            {activeFilterCount}
                        </span>
                    )}
                </button>

                {filterOpen && (
                    <div
                        className="fixed left-5 right-5 md:absolute md:left-0 md:right-auto mt-2 z-40 rounded-xl p-4 md:w-[480px]"
                        style={{
                            backgroundColor: "var(--color-bg)",
                            border: "1px solid var(--color-border)",
                            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                        }}
                    >
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                                    Status
                                </label>
                                <FilterDropdown
                                    values={statusFilter}
                                    onChange={onStatusFilterChange}
                                    placeholder="All statuses"
                                    options={toStringOptions("status")}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                                    Level
                                </label>
                                <FilterDropdown
                                    values={levelFilter}
                                    onChange={onLevelFilterChange}
                                    placeholder="All levels"
                                    options={toStringOptions("level")}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                                    Action
                                </label>
                                <FilterDropdown
                                    values={actionFilter}
                                    onChange={onActionFilterChange}
                                    placeholder="All actions"
                                    options={toStringOptions("action")}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                                    Source
                                </label>
                                <FilterDropdown
                                    values={sourceFilter}
                                    onChange={onSourceFilterChange}
                                    placeholder="All sources"
                                    options={toStringOptions("source")}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>
                                    Reason
                                </label>
                                <FilterDropdown
                                    values={reasonFilter}
                                    onChange={onReasonFilterChange}
                                    placeholder="All reasons"
                                    options={toStringOptions("reason")}
                                />
                            </div>
                        </div>
                        {activeFilterCount > 0 && (
                            <div className="flex justify-end mt-3">
                                <button
                                    onClick={clearAllFilters}
                                    className="text-xs"
                                    style={{ color: "var(--color-accent)" }}
                                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--color-accent-hover)")}
                                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--color-accent)")}
                                >
                                    Clear all
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Sort — custom dropdowns matching filter style ── */}
            <div ref={sortRef} className="relative">
                <button
                    onClick={() => setSortOpen((o) => !o)}
                    style={pillStyle(sortOpen || isSortCustom)}
                    onMouseEnter={onPillEnter}
                    onMouseLeave={(e) =>
                        onPillLeave(e, sortOpen || isSortCustom)
                    }
                >
                    <ArrowUpDown size={14} />
                    Sort
                    {sortAscending ? (
                        <ArrowUp
                            size={14}
                            strokeWidth={2.5}
                            style={{ color: "var(--color-accent)" }}
                        />
                    ) : (
                        <ArrowDown
                            size={14}
                            strokeWidth={2.5}
                            style={{ color: "var(--color-accent)" }}
                        />
                    )}
                </button>

                {sortOpen && (
                    <div
                        className="fixed left-5 right-5 md:absolute md:left-0 md:right-auto md:w-auto mt-2 z-40 rounded-xl overflow-visible"
                        style={{
                            backgroundColor: "var(--color-bg)",
                            border: "1px solid var(--color-border)",
                            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                        }}
                    >
                        <div
                            className="flex items-center gap-2 px-3 py-2.5"
                            style={{
                                borderBottom: "1px solid var(--color-border)",
                            }}
                        >
                            <SortSelect
                                value={sortField}
                                onChange={(v) => onSortChange(v, sortAscending)}
                                options={SORT_FIELDS}
                            />
                            <SortSelect
                                value={sortAscending ? "asc" : "desc"}
                                onChange={(v) =>
                                    onSortChange(sortField, v === "asc")
                                }
                                options={SORT_DIRECTIONS}
                            />
                            {isSortCustom && (
                                <button
                                    onClick={() => {
                                        onSortChange("created_at", false);
                                        setSortOpen(false);
                                    }}
                                    className="p-1 rounded transition-colors"
                                    style={{ color: "var(--color-text-muted)" }}
                                    onMouseEnter={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.color =
                                            "var(--color-text-secondary)")
                                    }
                                    onMouseLeave={(e) =>
                                        ((
                                            e.currentTarget as HTMLElement
                                        ).style.color =
                                            "var(--color-text-muted)")
                                    }
                                    title="Reset sort"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
