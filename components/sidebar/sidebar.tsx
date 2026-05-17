"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
    Users,
    BarChart2,
    Phone,
    MessageSquare,
    Calendar,
    Settings,
    ChevronLeft,
    ChevronRight,
    FlaskConical,
} from "lucide-react";
import { StudioSwitcher } from "./studio-switcher";
import { setSelectedStudio, saveNavCollapsed } from "@/app/actions";
import { useCurrentStudio } from "@/components/studio-context";
import type { Studio } from "@/lib/types";

const NAV_ITEMS = [
    { href: "/leads", label: "Leads", Icon: Users },
    { href: "/conversations", label: "Conversations", Icon: MessageSquare },
    { href: "/calendar", label: "Calendar", Icon: Calendar },
    { href: "/call-analytics", label: "Call Analytics", Icon: BarChart2 },
    { href: "/call-history", label: "Call History", Icon: Phone },
    { href: "/test", label: "Test", Icon: FlaskConical },
];

interface SidebarProps {
    studios: Studio[];
    initialStudioId: string;
    initialCollapsed?: boolean;
}

export function Sidebar({
    studios,
    initialStudioId,
    initialCollapsed = false,
}: SidebarProps) {
    const pathname = usePathname();
    const { currentStudio, setCurrentStudio } = useCurrentStudio();
    const [collapsed, setCollapsed] = useState(initialCollapsed);
    const [pendingHref, setPendingHref] = useState<string | null>(null);

    // Clear pending state when pathname catches up
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setPendingHref(null) }, [pathname]);

    async function handleSwitch(studio: Studio) {
        setCurrentStudio(studio);
        await setSelectedStudio(studio.id);
        window.location.href = pathname;
    }

    function toggleCollapse() {
        const next = !collapsed;
        setCollapsed(next);
        saveNavCollapsed(next).catch(console.error);
    }

    // Shared nav link style helper
    function navStyle(active: boolean) {
        return {
            gap: collapsed ? undefined : "12px",
            padding: collapsed ? "13px 0" : "13px 16px",
            justifyContent: collapsed ? ("center" as const) : undefined,
            backgroundColor: active
                ? "var(--color-surface-hover)"
                : "transparent",
            color: active
                ? "var(--color-text-primary)"
                : "var(--color-text-secondary)",
            fontWeight: active ? 600 : 500,
            borderRadius: 8,
            transition: `background var(--transition-fast), color var(--transition-fast)`,
        };
    }

    function onNavEnter(e: React.MouseEvent, active: boolean) {
        if (!active) {
            (e.currentTarget as HTMLElement).style.backgroundColor =
                "var(--color-surface-hover)";
            (e.currentTarget as HTMLElement).style.color =
                "var(--color-text-primary)";
        }
    }

    function onNavLeave(e: React.MouseEvent, active: boolean) {
        if (!active) {
            (e.currentTarget as HTMLElement).style.backgroundColor =
                "transparent";
            (e.currentTarget as HTMLElement).style.color =
                "var(--color-text-secondary)";
        }
    }

    return (
        <aside
            className="relative z-[60] flex-shrink-0 flex flex-col h-screen sticky top-0 transition-all duration-200"
            style={{
                width: collapsed
                    ? "var(--sidebar-width-collapsed)"
                    : "var(--sidebar-width)",
                backgroundColor: "var(--sidebar-bg)",
                borderRight: "1px solid var(--color-border)",
            }}
        >
            {/* Logo — always rendered so nav icons never shift position */}
            <div
                className={`${collapsed ? "px-2" : "px-5"} pt-8 pb-5 flex items-center justify-center`}
            >
                <div className="h-9 relative w-full">
                    {/* Both images always in DOM — opacity crossfade prevents load glitch */}
                    <Image
                        src="/AMLogoNew.svg"
                        alt="Arthur Murray"
                        fill
                        priority
                        className="object-contain object-center logo-am"
                        style={{ opacity: collapsed ? 0 : 1, pointerEvents: collapsed ? 'none' : 'auto' }}
                    />
                    <Image
                        src="/AMLogoNew-icon.svg"
                        alt=""
                        fill
                        priority
                        className="object-contain object-center logo-am"
                        style={{ opacity: collapsed ? 1 : 0, pointerEvents: collapsed ? 'auto' : 'none' }}
                    />
                </div>
            </div>

            {/* Studio switcher */}
            <div className={`${collapsed ? "px-2" : "px-3"} pb-3`}>
                <StudioSwitcher
                    studios={studios}
                    currentStudio={currentStudio}
                    onSwitch={handleSwitch}
                    collapsed={collapsed}
                />
                <div
                    className="mx-1 mt-4 h-px"
                    style={{ backgroundColor: "var(--color-border)" }}
                />
            </div>

            {/* Nav items */}

            <nav className="flex-1 px-3 pt-3 space-y-1">
                {NAV_ITEMS.map(({ href, label, Icon }) => {
                    const active = pendingHref ? pendingHref.startsWith(href) : pathname.startsWith(href);
                    return (
                        <Link
                            key={href}
                            href={href}
                            title={collapsed ? label : undefined}
                            className="flex items-center text-sm leading-none"
                            style={navStyle(active)}
                            onClick={() => setPendingHref(href)}
                            onMouseEnter={(e) => onNavEnter(e, active)}
                            onMouseLeave={(e) => onNavLeave(e, active)}
                        >
                            <Icon size={20} className="flex-shrink-0" />
                            {!collapsed && label}
                        </Link>
                    );
                })}
            </nav>

            {/* Horizontal divider — sits above Settings, independently moveable */}
            <div
                style={{
                    borderTop: "1px solid var(--color-border)",
                    marginBottom: 8,
                }}
            />

            {/* Settings — pinned at bottom */}
            <div
                className="px-3"
                style={{
                    paddingTop: 2,
                    paddingBottom: 2,
                    marginBottom: 13,
                }}
            >
                <Link
                    href="/settings/business-profile"
                    title={collapsed ? "Settings" : undefined}
                    className="flex items-center text-sm leading-none"
                    style={{
                        ...navStyle(pendingHref ? pendingHref.startsWith("/settings") : pathname.startsWith("/settings")),
                        padding: collapsed ? "13px 0" : "13px 16px",
                        justifyContent: collapsed
                            ? ("center" as const)
                            : undefined,
                    }}
                    onClick={() => setPendingHref("/settings")}
                    onMouseEnter={(e) =>
                        onNavEnter(e, pathname.startsWith("/settings"))
                    }
                    onMouseLeave={(e) =>
                        onNavLeave(e, pathname.startsWith("/settings"))
                    }
                >
                    <Settings size={20} className="flex-shrink-0" />
                    {!collapsed && "Settings"}
                </Link>
            </div>

            {/* Collapse toggle — blue circle on right edge, vertically centered with Settings row */}
            <button
                onClick={toggleCollapse}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="absolute flex items-center justify-center transition-colors"
                style={{
                    right: -10,
                    bottom: 26,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    backgroundColor: "var(--color-accent)",
                    color: "#ffffff",
                    zIndex: 10,
                }}
                onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.backgroundColor =
                        "var(--color-accent-hover)")
                }
                onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.backgroundColor =
                        "var(--color-accent)")
                }
            >
                {collapsed ? (
                    <ChevronRight size={11} strokeWidth={2.5} />
                ) : (
                    <ChevronLeft size={11} strokeWidth={2.5} />
                )}
            </button>
        </aside>
    );
}
