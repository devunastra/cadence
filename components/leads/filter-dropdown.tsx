"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

interface FilterDropdownProps {
    values: string[];
    onChange: (v: string[]) => void;
    placeholder: string;
    options: readonly string[];
}

export function FilterDropdown({
    values,
    onChange,
    placeholder,
    options,
}: FilterDropdownProps) {
    const [open, setOpen] = useState(false);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    function handleToggle() {
        if (!open && buttonRef.current) setRect(buttonRef.current.getBoundingClientRect());
        setOpen((o) => !o);
    }

    useEffect(() => {
        if (!open) return;
        function h(e: MouseEvent) {
            if (buttonRef.current?.contains(e.target as Node)) return;
            if (panelRef.current?.contains(e.target as Node)) return;
            setOpen(false);
        }
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [open]);

    function toggle(opt: string) {
        if (values.includes(opt)) {
            onChange(values.filter((v) => v !== opt));
        } else {
            const next = [...values, opt];
            onChange(next.length === options.length ? [] : next);
        }
    }

    const label =
        values.length === 0
            ? placeholder
            : values.length === 1
              ? values[0]
              : `${values.length} selected`;

    return (
        <div className="relative">
            <button
                ref={buttonRef}
                onClick={handleToggle}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm rounded-lg w-full"
                style={{
                    border: "1px solid var(--color-border)",
                    boxShadow: open ? "0 0 0 2px var(--color-accent)" : "none",
                    backgroundColor: "var(--color-surface)",
                    color: values.length > 0 ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    transition: "background var(--transition-fast), color var(--transition-fast)",
                }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-bg)"}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"}
            >
                <span className="truncate text-left flex-1">{label}</span>
                <ChevronDown
                    size={13}
                    className={`flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                    style={{ color: "var(--color-text-muted)" }}
                />
            </button>

            {open && rect && (
                <div
                    ref={panelRef}
                    className="rounded-xl py-1 max-h-[360px] overflow-y-auto"
                    style={{
                        position: "fixed",
                        top: rect.bottom + 4,
                        left: rect.left,
                        width: rect.width,
                        zIndex: 1000,
                        backgroundColor: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                    }}
                >
                    {/* Clear / All option */}
                    <button
                        onClick={() => onChange([])}
                        className="w-full text-left px-3 py-2 text-sm whitespace-nowrap"
                        style={{
                            backgroundColor: values.length === 0 ? "var(--color-accent)" : "transparent",
                            color: values.length === 0 ? "#ffffff" : "var(--color-text-muted)",
                            transition: "none",
                        }}
                        onMouseEnter={(e) => {
                            if (values.length > 0)
                                (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface-hover)";
                        }}
                        onMouseLeave={(e) => {
                            if (values.length > 0)
                                (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                        }}
                    >
                        {placeholder}
                    </button>
                    {options.map((opt) => {
                        const checked = values.includes(opt);
                        return (
                            <button
                                key={opt}
                                onClick={() => toggle(opt)}
                                className="w-full flex items-center justify-between px-3 py-2 text-sm whitespace-nowrap"
                                style={{
                                    backgroundColor: "transparent",
                                    color: "var(--color-text-primary)",
                                    fontWeight: checked ? 500 : 400,
                                    transition: "none",
                                }}
                                onMouseEnter={(e) =>
                                    ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface-hover)")
                                }
                                onMouseLeave={(e) =>
                                    ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")
                                }
                            >
                                <span>{opt}</span>
                                {checked && <Check size={13} style={{ color: "var(--color-accent)", flexShrink: 0 }} />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
