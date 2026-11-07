"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileTabs, NAV_ITEMS } from "@/components/Nav";
import TopBar from "@/components/shell/TopBar";
import CalendarPanel from "@/components/calendar/CalendarPanel";
import { useSystemThemeSync } from "@/components/ui/ThemeToggle";
import SearchPalette from "@/components/search/SearchPalette";
import { useAddonFavorites } from "@/components/addons/useFavorites";
import { ADDONS } from "@/lib/addons/registry";

const BARE = ["/login", "/reset-password", "/auth"];

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[role=dialog]");
}

/**
 * The app frame (Blocks design): top bar (desktop) or tab bar (phone), the page, and the calendar as a
 * slide-over you open from the top bar. Keyboard: "\" calendar, "g" + letter jumps to a section.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [calOpen, setCalOpen] = useState(false);
  const gPressed = useRef(0);
  const { favorites } = useAddonFavorites();
  useSystemThemeSync();

  const toggleCal = useCallback(() => setCalOpen((o) => !o), []);
  // The slide-over closes when you move to another page
  useEffect(() => setCalOpen(false), [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCalOpen(false);
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      if (e.key === "\\") return toggleCal();
      if (e.key === "g") {
        gPressed.current = Date.now();
        return;
      }
      if (Date.now() - gPressed.current < 1200) {
        const k = e.key.toLowerCase();
        // Sections first, then any add-on's own shortcut (pinned or not)
        const item = NAV_ITEMS.find((i) => i.key === k) ?? ADDONS.find((a) => a.key === k);
        gPressed.current = 0;
        if (item) router.push(item.href);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggleCal]);

  if (BARE.some((p) => pathname.startsWith(p))) return <>{children}</>;
  const showPanel = !pathname.startsWith("/calendar");

  return (
    <div className="min-h-dvh">
      <TopBar pathname={pathname} favorites={favorites} calOpen={calOpen && showPanel} onToggleCalendar={toggleCal} />
      <div className="min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      {showPanel && <CalendarPanel open={calOpen} onToggle={toggleCal} />}
      <MobileTabs pathname={pathname} favorites={favorites} />
      <SearchPalette />
    </div>
  );
}
