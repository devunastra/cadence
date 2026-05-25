"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { useCurrentStudio } from "@/components/studio-context";
import { useIsMobile, useMounted } from "@/lib/hooks";
import type { Studio } from "@/lib/types";

interface AppShellProps {
    studios: Studio[];
    initialStudioId: string;
    initialCollapsed: boolean;
    children: React.ReactNode;
}

export function AppShell({ studios, initialStudioId, initialCollapsed, children }: AppShellProps) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const { currentStudio } = useCurrentStudio();
    const mounted = useMounted();
    const isMobile = useIsMobile();

    // Until mounted, render desktop layout to match SSR (avoids hydration mismatch)
    const showMobile = mounted && isMobile;

    return (
        <>
            <Sidebar
                studios={studios}
                initialStudioId={initialStudioId}
                initialCollapsed={initialCollapsed}
                isMobile={showMobile}
                mobileOpen={mobileOpen}
                onMobileClose={() => setMobileOpen(false)}
            />
            <div className="flex-1 flex flex-col overflow-y-auto md:overflow-hidden relative">
                {/* Mobile hamburger header */}
                {showMobile && (
                    <div
                        className="flex-shrink-0 flex items-center justify-between px-4 py-3 sticky top-0 z-30"
                        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
                    >
                        <button
                            onClick={() => setMobileOpen(true)}
                            aria-label="Open menu"
                            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--color-surface)] transition-colors"
                            style={{ color: 'var(--color-text-primary)' }}
                        >
                            <Menu size={22} />
                        </button>
                        <span
                            className="text-sm font-medium truncate flex-1 text-right"
                            style={{ color: 'var(--color-text-primary)' }}
                        >
                            {currentStudio?.name}
                        </span>
                    </div>
                )}
                <main className="flex-1 flex flex-col md:overflow-hidden md:min-h-0">
                    <ErrorBoundary>{children}</ErrorBoundary>
                </main>
            </div>
        </>
    );
}
