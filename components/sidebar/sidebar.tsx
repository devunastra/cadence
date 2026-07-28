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
    ClipboardCheck,
    PhoneForwarded,
    LogOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { StudioSwitcher } from "./studio-switcher";
import { setSelectedStudio, saveNavCollapsed } from "@/app/actions";
import { createClient } from "@/lib/supabase/client";
import { useCurrentStudio } from "@/components/studio-context";
import type { Studio } from "@/lib/types";

const NAV_ITEMS = [
    { href: "/leads", label: "Leads", Icon: Users },
    { href: "/conversations", label: "Conversations", Icon: MessageSquare },
    { href: "/calendar", label: "Calendar", Icon: Calendar },
    { href: "/call-analytics", label: "Call Analytics", Icon: BarChart2 },
    { href: "/call-history", label: "Call History", Icon: Phone },
    { href: "/call-quality", label: "Quality Review", Icon: ClipboardCheck },
    { href: "/follow-ups", label: "Follow-ups", Icon: PhoneForwarded },
    { href: "/test", label: "Test", Icon: FlaskConical },
];

interface SidebarProps {
    studios: Studio[];
    initialStudioId: string;
    initialCollapsed?: boolean;
    isMobile?: boolean;
    mobileOpen?: boolean;
    onMobileClose?: () => void;
}

export function Sidebar({
    studios,
    initialStudioId,
    initialCollapsed = false,
    isMobile = false,
    mobileOpen = false,
    onMobileClose,
}: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { currentStudio, setCurrentStudio } = useCurrentStudio();
    const [collapsed, setCollapsed] = useState(initialCollapsed);
    const [pendingHref, setPendingHref] = useState<string | null>(null);

    // Close mobile drawer on navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setPendingHref(null); if (isMobile) onMobileClose?.() }, [pathname]);

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
            gap: isCollapsed ? undefined : "12px",
            padding: isCollapsed ? "13px 0" : "13px 16px",
            justifyContent: isCollapsed ? ("center" as const) : undefined,
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

    // On mobile, sidebar is always expanded (never collapsed)
    const isCollapsed = isMobile ? false : collapsed;

    const sidebarContent = (
        <>
            {/* Logo */}
            <div
                className={`${isCollapsed ? "px-2" : "px-5"} pt-8 pb-5 flex items-center justify-center`}
            >
                <div className="h-9 relative w-full">
                    <Image
                        src="/AMLogoNew.svg"
                        alt="Arthur Murray"
                        fill
                        priority
                        className="object-contain object-center logo-am"
                        style={{ opacity: isCollapsed ? 0 : 1, pointerEvents: isCollapsed ? 'none' : 'auto' }}
                    />
                    <Image
                        src="/AMLogoNew-icon.svg"
                        alt=""
                        fill
                        priority
                        className="object-contain object-center logo-am"
                        style={{ opacity: isCollapsed ? 1 : 0, pointerEvents: isCollapsed ? 'auto' : 'none' }}
                    />
                </div>
            </div>

            {/* Studio switcher */}
            <div className={`${isCollapsed ? "px-2" : "px-3"} pb-3`}>
                <StudioSwitcher
                    studios={studios}
                    currentStudio={currentStudio}
                    onSwitch={handleSwitch}
                    collapsed={isCollapsed}
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
                            title={isCollapsed ? label : undefined}
                            className="flex items-center text-sm leading-none"
                            style={navStyle(active)}
                            onClick={() => setPendingHref(href)}
                            onMouseEnter={(e) => onNavEnter(e, active)}
                            onMouseLeave={(e) => onNavLeave(e, active)}
                        >
                            <Icon size={20} className="flex-shrink-0" />
                            {!isCollapsed && label}
                        </Link>
                    );
                })}
            </nav>

            {/* Divider above Settings */}
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
                    title={isCollapsed ? "Settings" : undefined}
                    className="flex items-center text-sm leading-none"
                    style={navStyle(pendingHref ? pendingHref.startsWith("/settings") : pathname.startsWith("/settings"))}
                    onClick={() => setPendingHref("/settings")}
                    onMouseEnter={(e) =>
                        onNavEnter(e, pathname.startsWith("/settings"))
                    }
                    onMouseLeave={(e) =>
                        onNavLeave(e, pathname.startsWith("/settings"))
                    }
                >
                    <Settings size={20} className="flex-shrink-0" />
                    {!isCollapsed && "Settings"}
                </Link>

                {/* Sign out — mobile only */}
                {isMobile && (
                    <button
                        onClick={async () => {
                            const supabase = createClient();
                            await supabase.auth.signOut();
                            router.push('/login');
                        }}
                        className="flex items-center text-sm leading-none"
                        style={{
                            gap: 12,
                            padding: '13px 16px',
                            color: 'var(--color-text-secondary)',
                            fontWeight: 500,
                            backgroundColor: 'transparent',
                            transition: 'background var(--transition-fast), color var(--transition-fast)',
                        }}
                    >
                        <LogOut size={20} className="flex-shrink-0" />
                        Sign out
                    </button>
                )}
            </div>

            {/* Collapse toggle — desktop only */}
            {!isMobile && (
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
            )}
        </>
    );

    // Mobile: overlay drawer
    if (isMobile) {
        return (
            <>
                {/* Backdrop */}
                <div
                    className="fixed inset-0 z-[60] transition-opacity duration-200"
                    style={{
                        backgroundColor: 'rgba(0,0,0,0.4)',
                        opacity: mobileOpen ? 1 : 0,
                        pointerEvents: mobileOpen ? 'auto' : 'none',
                    }}
                    onClick={onMobileClose}
                />
                <aside
                    className="fixed inset-y-0 left-0 z-[61] flex flex-col transition-transform duration-200"
                    style={{
                        width: 'min(var(--sidebar-width), calc(100vw - 56px))',
                        backgroundColor: 'var(--sidebar-bg)',
                        borderRight: '1px solid var(--color-border)',
                        transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
                    }}
                >
                    {sidebarContent}
                </aside>
            </>
        );
    }

    // Desktop: static sidebar
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
            {sidebarContent}
        </aside>
    );
}
