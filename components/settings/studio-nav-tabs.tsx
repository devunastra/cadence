"use client";

import { useState } from "react";
import { setStudioNavOverrides } from "@/app/actions";
import { useToast } from "@/components/ui/toast-provider";
import { useCurrentStudio } from "@/components/studio-context";
import { TOGGLEABLE_PAGES, isPageVisible, type NavOverrides } from "@/lib/nav";
import type { Studio } from "@/lib/types";

/**
 * Super_admin control for which sidebar tabs each studio sees.
 * Writes studios.nav_overrides via setStudioNavOverrides (super_admin only).
 */
export function StudioNavTabs({ studios }: { studios: Studio[] }) {
    const { showError } = useToast();
    const { currentStudio, updateCurrentStudio } = useCurrentStudio();
    const [overridesByStudio, setOverridesByStudio] = useState<Record<string, NavOverrides>>(
        () => Object.fromEntries(studios.map((s) => [s.id, { ...(s.nav_overrides ?? {}) }])),
    );
    const [savingKey, setSavingKey] = useState<string | null>(null);

    async function toggle(studioId: string, href: string) {
        const current = overridesByStudio[studioId] ?? {};
        const nextVisible = !isPageVisible(href, current);
        const nextOverrides = { ...current, [href]: nextVisible };
        const prev = overridesByStudio;
        const key = `${studioId}${href}`;

        setOverridesByStudio({ ...prev, [studioId]: nextOverrides });
        setSavingKey(key);
        try {
            await setStudioNavOverrides(studioId, nextOverrides);
            // If editing the active studio, sync context so the sidebar updates live.
            if (studioId === currentStudio.id) {
                updateCurrentStudio({ nav_overrides: nextOverrides });
            }
        } catch (err) {
            setOverridesByStudio(prev);
            showError(err instanceof Error ? err.message : "Failed to update tabs.");
        } finally {
            setSavingKey(null);
        }
    }

    return (
        <div className="mt-12">
            <h3
                className="text-lg font-semibold mb-1"
                style={{ color: "var(--color-text-primary)" }}
            >
                Sidebar Tabs
            </h3>
            <p
                className="text-base mb-4"
                style={{ color: "var(--color-text-secondary)" }}
            >
                Choose which tabs each studio sees in the sidebar. Turn one off to hide
                the page for that studio; it can be switched back on any time. Leads is
                always shown.
            </p>

            <div
                className="rounded-xl overflow-hidden divide-y"
                style={{
                    backgroundColor: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    borderColor: "var(--color-border)",
                }}
            >
                {studios.map((studio) => {
                    const overrides = overridesByStudio[studio.id] ?? {};
                    return (
                        <div key={studio.id} className="px-6 py-5">
                            <div
                                className="text-sm font-semibold mb-3"
                                style={{ color: "var(--color-text-primary)" }}
                            >
                                {studio.name}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {TOGGLEABLE_PAGES.map((page) => {
                                    const on = isPageVisible(page.href, overrides);
                                    const key = `${studio.id}${page.href}`;
                                    const busy = savingKey === key;
                                    return (
                                        <button
                                            key={page.href}
                                            type="button"
                                            role="switch"
                                            aria-checked={on}
                                            disabled={busy}
                                            onClick={() => toggle(studio.id, page.href)}
                                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                                            style={{
                                                border: "1px solid var(--color-border)",
                                                backgroundColor: on
                                                    ? "var(--color-accent-subtle)"
                                                    : "var(--color-bg)",
                                                color: on
                                                    ? "var(--color-accent)"
                                                    : "var(--color-text-secondary)",
                                                borderColor: on
                                                    ? "var(--color-accent)"
                                                    : "var(--color-border)",
                                            }}
                                        >
                                            <span
                                                aria-hidden
                                                className="inline-block rounded-full"
                                                style={{
                                                    width: 8,
                                                    height: 8,
                                                    backgroundColor: on
                                                        ? "var(--color-accent)"
                                                        : "var(--color-text-muted)",
                                                }}
                                            />
                                            {page.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
