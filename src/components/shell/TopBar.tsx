"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { NAV_ITEMS, SignOut, isActive, navGroupsWith } from "@/components/Nav";
import { OPEN_SEARCH } from "@/components/search/SearchPalette";

/** The sections that live in the bar itself; everything else is under "More". */
const PRIMARY = ["/", "/calendar", "/tasks", "/notes", "/finance", "/habits"];

/**
 * Top bar (Blocks design): logo, main sections as pills, a "More" menu for the rest,
 * then search, calendar and Capture. Below lg the sections move to the bottom tab bar (MobileTabs).
 */
export default function TopBar({
  pathname,
  favorites,
  calOpen,
  onToggleCalendar,
}: {
  pathname: string;
  favorites: string[];
  calOpen: boolean;
  onToggleCalendar: () => void;
}) {
  const [more, setMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const primary = PRIMARY.map((h) => NAV_ITEMS.find((i) => i.href === h)!).filter(Boolean);
  const groups = navGroupsWith(favorites)
    .map((g) => ({ ...g, items: g.items.filter((i) => !PRIMARY.includes(i.href)) }))
    .filter((g) => g.items.length > 0);
  const moreActive = !primary.some((p) => isActive(p.href, pathname)) && pathname !== "/capture";

  useEffect(() => setMore(false), [pathname]);
  useEffect(() => {
    if (!more) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setMore(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMore(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [more]);

  const iconBtn =
    "grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-fg";

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-app/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:gap-5 lg:px-8">
        <Link href="/" className="font-display text-xl font-bold tracking-tight" title="Personal OS">
          Personal OS
        </Link>

        <nav aria-label="Main navigation" className="hidden flex-1 items-center gap-1 lg:flex">
          {primary.map((it) => {
            const active = isActive(it.href, pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                title={it.key ? `${it.label} (g then ${it.key})` : it.label}
                className={`rounded-full px-3.5 py-1.5 text-[0.9375rem] font-medium transition-colors ${
                  active ? "bg-fg text-app" : "text-muted hover:bg-subtle hover:text-fg"
                }`}
              >
                {it.label}
              </Link>
            );
          })}

          <div ref={box} className="relative">
            <button
              type="button"
              onClick={() => setMore(!more)}
              aria-expanded={more}
              aria-haspopup="menu"
              className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[0.9375rem] font-medium transition-colors ${
                more || moreActive ? "bg-subtle text-fg" : "text-muted hover:bg-subtle hover:text-fg"
              }`}
            >
              More
              <Icon name="chevronRight" size={14} className={`transition-transform ${more ? "-rotate-90" : "rotate-90"}`} />
            </button>
            {more && (
              <div
                role="menu"
                className="absolute left-0 top-full z-50 mt-2 max-h-[80dvh] w-80 overflow-y-auto rounded-2xl border border-line bg-surface p-2 shadow-pop"
              >
                {groups.map((g) => (
                  <div key={g.label} className="py-1">
                    <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-faint">{g.label}</p>
                    <ul>
                      {g.items.map((it) => {
                        const active = isActive(it.href, pathname);
                        return (
                          <li key={it.href}>
                            <Link
                              href={it.href}
                              role="menuitem"
                              aria-current={active ? "page" : undefined}
                              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                                active ? "bg-accent-soft font-medium text-accent" : "text-fg hover:bg-subtle"
                              }`}
                            >
                              <Icon name={it.icon} size={18} className={active ? "" : "text-muted"} />
                              <span className="flex-1">{it.label}</span>
                              {it.key && <span className="text-xs text-faint">g {it.key}</span>}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between gap-2 border-t border-line px-1 pt-2">
                  <ThemeToggle compact />
                  <SignOut />
                </div>
              </div>
            )}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SEARCH, { detail: "" }))}
            title="Search notes (Ctrl+F)"
            aria-label="Search notes"
            className={iconBtn}
          >
            <Icon name="search" size={18} />
          </button>
          <button
            type="button"
            onClick={onToggleCalendar}
            title={calOpen ? "Hide calendar ( \\ )" : "Show calendar ( \\ )"}
            aria-label={calOpen ? "Hide calendar" : "Show calendar"}
            aria-pressed={calOpen}
            className={`${iconBtn} hidden lg:grid ${calOpen ? "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent" : ""}`}
          >
            <Icon name="calendar" size={18} />
          </button>
          <Link
            href="/capture"
            className="ml-1 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Capture
          </Link>
        </div>
      </div>
    </header>
  );
}
