"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { useCurrentStudio } from "@/components/studio-context";
import { useIsMobile } from "@/lib/hooks";
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
    const isMobile = useIsMobile();

    return (
        <>
            <Sidebar
                studios={studios}
                initialStudioId={initialStudioId}
                initialCollapsed={initialCollapsed}
                isMobile={isMobile}
                mobileOpen={mobileOpen}
                onMobileClose={() => setMobileOpen(false)}
            />
            <div className="flex-1 flex flex-col overflow-hidden relative">
                {/* Mobile hamburger header */}
                {isMobile && (
                    <div
                        className="flex-shrink-0 flex items-center justify-between px-4 py-3"
                        style={{ borderBottom: '1px solid var(--color-border)' }}
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
                            className="text-sm font-medium truncate max-w-[150px]"
                            style={{ color: 'var(--color-text-primary)' }}
                        >
                            {currentStudio?.name}
                        </span>
                    </div>
                )}
                <main className="flex-1 flex flex-col overflow-hidden">
                    <ErrorBoundary>{children}</ErrorBoundary>
                </main>
            </div>
        </>
    );
}
