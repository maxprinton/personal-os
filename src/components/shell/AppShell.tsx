"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileTabs, NAV_ITEMS, Sidebar } from "@/components/Nav";
import CalendarPanel from "@/components/calendar/CalendarPanel";
import { useSystemThemeSync } from "@/components/ui/ThemeToggle";
import { readPref, writePref } from "@/components/calendar/util";

const BARE = ["/login", "/reset-password", "/auth"];

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[role=dialog]");
}

/**
 * The app frame: sidebar (desktop) or tab bar (phone), the page, and the calendar panel on the right.
 * Keyboard: "[" sidebar, "\" calendar panel, "g" + letter jumps to a section (see the sidebar tooltips).
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const gPressed = useRef(0);
  useSystemThemeSync();

  useEffect(() => {
    setCollapsed(readPref("ui.sidebar") === "collapsed");
    const saved = readPref("ui.calPanel");
    // Open by default on wide screens; on medium screens it floats over the page, so it starts closed
    setCalOpen(saved ? saved === "open" : window.innerWidth >= 1280);
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      writePref("ui.sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  }, []);
  const toggleCal = useCallback(() => {
    setCalOpen((o) => {
      writePref("ui.calPanel", o ? "closed" : "open");
      return !o;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      if (e.key === "[") return toggleSidebar();
      if (e.key === "\\") return toggleCal();
      if (e.key === "g") {
        gPressed.current = Date.now();
        return;
      }
      if (Date.now() - gPressed.current < 1200) {
        const item = NAV_ITEMS.find((i) => i.key === e.key.toLowerCase());
        gPressed.current = 0;
        if (item) router.push(item.href);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggleSidebar, toggleCal]);

  if (BARE.some((p) => pathname.startsWith(p))) return <>{children}</>;
  const showPanel = !pathname.startsWith("/calendar");

  return (
    <div className="flex min-h-dvh">
      <Sidebar pathname={pathname} collapsed={collapsed} onToggle={toggleSidebar} />
      <div className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      {showPanel && <CalendarPanel open={calOpen} onToggle={toggleCal} />}
      <MobileTabs pathname={pathname} />
    </div>
  );
}
