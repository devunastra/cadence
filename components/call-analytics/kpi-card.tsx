"use client";

import { useState, useEffect, useRef } from "react";
import {
    Info,
    BarChart2,
    TrendingUp,
    Activity,
    PieChart,
    AlignLeft,
} from "lucide-react";

export type ChartType = "bar" | "line" | "area" | "donut";

interface KpiCardProps {
    title: string;
    description: string;
    value?: string;
    summary: React.ReactNode;
    availableChartTypes: ChartType[];
    defaultChartType: ChartType;
    children: (type: ChartType) => React.ReactNode;
}

const CHART_ICONS: Record<ChartType, React.ReactNode> = {
    bar: <BarChart2 size={14} />,
    line: <TrendingUp size={14} />,
    area: <Activity size={14} />,
    donut: <PieChart size={14} />,
};

const CHART_LABELS: Record<ChartType, string> = {
    bar: "Bar",
    line: "Line",
    area: "Area",
    donut: "Donut",
};

export function KpiCard({
    title,
    description,
    value,
    summary,
    availableChartTypes,
    defaultChartType,
    children,
}: KpiCardProps) {
    const [chartType, setChartType] = useState<ChartType>(defaultChartType);
    const [infoOpen, setInfoOpen] = useState(false);
    const [showSummary, setShowSummary] = useState(false);
    const infoRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!infoOpen) return;
        function handleClick(e: MouseEvent) {
            if (
                infoRef.current &&
                !infoRef.current.contains(e.target as Node)
            ) {
                setInfoOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [infoOpen]);

    return (
        <div
            className="rounded-2xl p-5 flex flex-col gap-3 h-[330px]"
            style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
            }}
        >
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-1.5">
                        <p
                            className="text-sm font-semibold uppercase tracking-wider"
                            style={{ color: "var(--color-text-secondary)" }}
                        >
                            {title}
                        </p>
                        <div className="relative" ref={infoRef}>
                            <button
                                onClick={() => setInfoOpen((v) => !v)}
                                className="p-0.5 rounded transition-colors"
                                style={{ color: "var(--color-text-muted)" }}
                                title="About this metric"
                                onMouseEnter={(e) =>
                                    ((
                                        e.currentTarget as HTMLElement
                                    ).style.color =
                                        "var(--color-text-secondary)")
                                }
                                onMouseLeave={(e) =>
                                    ((
                                        e.currentTarget as HTMLElement
                                    ).style.color = "var(--color-text-muted)")
                                }
                            >
                                <Info size={14} />
                            </button>
                            {infoOpen && (
                                <div
                                    className="absolute left-0 top-6 w-56 rounded-xl shadow-xl p-3 z-50"
                                    style={{
                                        backgroundColor: "var(--color-bg)",
                                        border: "1px solid var(--color-border)",
                                    }}
                                >
                                    <p
                                        className="text-xs font-semibold mb-1"
                                        style={{
                                            color: "var(--color-text-primary)",
                                        }}
                                    >
                                        {title}
                                    </p>
                                    <p
                                        className="text-xs leading-relaxed"
                                        style={{
                                            color: "var(--color-text-secondary)",
                                        }}
                                    >
                                        {description}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                    {value && (
                        <p
                            className="text-2xl font-bold mt-1"
                            style={{ color: "var(--color-text-primary)" }}
                        >
                            {value}
                        </p>
                    )}
                </div>

                {/* Summary toggle */}
                <button
                    onClick={() => setShowSummary((v) => !v)}
                    title={showSummary ? "Show chart" : "Show summary"}
                    className="p-1.5 rounded-lg transition-colors"
                    style={{
                        backgroundColor: showSummary
                            ? "var(--color-accent)"
                            : "transparent",
                        color: showSummary
                            ? "#ffffff"
                            : "var(--color-text-muted)",
                    }}
                    onMouseEnter={(e) => {
                        if (!showSummary) {
                            (
                                e.currentTarget as HTMLElement
                            ).style.backgroundColor = "var(--color-surface)";
                            (e.currentTarget as HTMLElement).style.color =
                                "var(--color-text-secondary)";
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (!showSummary) {
                            (
                                e.currentTarget as HTMLElement
                            ).style.backgroundColor = "transparent";
                            (e.currentTarget as HTMLElement).style.color =
                                "var(--color-text-muted)";
                        }
                    }}
                >
                    <AlignLeft size={14} />
                </button>
            </div>

            {/* Chart or summary area */}
            <div className="flex-1 min-h-0 relative">
                {showSummary ? (
                    <div
                        className="text-sm leading-relaxed space-y-1"
                        style={{ color: "var(--color-text-secondary)" }}
                    >
                        {summary}
                    </div>
                ) : (
                    children(chartType)
                )}
            </div>

            {/* Chart type switcher */}
            {!showSummary && availableChartTypes.length > 1 && (
                <div
                    className="flex items-center gap-1 pt-1"
                    style={{ borderTop: "1px solid var(--color-border)" }}
                >
                    {availableChartTypes.map((type) => (
                        <button
                            key={type}
                            onClick={() => setChartType(type)}
                            title={CHART_LABELS[type]}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
                            style={{
                                backgroundColor:
                                    chartType === type
                                        ? "var(--color-accent)"
                                        : "transparent",
                                color:
                                    chartType === type
                                        ? "#ffffff"
                                        : "var(--color-text-muted)",
                            }}
                            onMouseEnter={(e) => {
                                if (chartType !== type)
                                    (
                                        e.currentTarget as HTMLElement
                                    ).style.backgroundColor =
                                        "var(--color-surface)";
                            }}
                            onMouseLeave={(e) => {
                                if (chartType !== type)
                                    (
                                        e.currentTarget as HTMLElement
                                    ).style.backgroundColor = "transparent";
                            }}
                        >
                            {CHART_ICONS[type]}
                            <span>{CHART_LABELS[type]}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
