"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentStudio } from "@/components/studio-context";
import { findNavPage, isPageVisible } from "@/lib/nav";

/**
 * Redirects away from a page that is hidden for the active studio. Hiding a tab
 * from the sidebar isn't enough on its own — a direct URL (or a stale link after
 * switching studios) must not reach a disabled feature. Bounces to /leads.
 */
export function NavGuard() {
    const pathname = usePathname();
    const router = useRouter();
    const { currentStudio } = useCurrentStudio();

    useEffect(() => {
        const page = findNavPage(pathname);
        if (page && !isPageVisible(page.href, currentStudio.nav_overrides)) {
            router.replace("/leads");
        }
    }, [pathname, currentStudio, router]);

    return null;
}
