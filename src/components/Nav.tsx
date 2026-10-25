"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import ThemeToggle from "@/components/ui/ThemeToggle";

type NavItem = { href: string; label: string; icon: IconName; key?: string };

/** The app's sections, grouped as in the redesign plan. `key` = keyboard shortcut after "g". */
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Now",
    items: [
      { href: "/", label: "Today", icon: "today", key: "h" },
      { href: "/capture", label: "Capture", icon: "capture", key: "c" },
    ],
  },
  {
    label: "Plan",
    items: [
      { href: "/calendar", label: "Calendar", icon: "calendar", key: "k" },
      { href: "/tasks", label: "Tasks", icon: "tasks", key: "t" },
      { href: "/blocks", label: "Blocks", icon: "blocks", key: "b" },
      { href: "/events", label: "Events", icon: "events", key: "e" },
    ],
  },
  {
    label: "Life",
    items: [
      { href: "/habits", label: "Habits", icon: "habits", key: "a" },
      { href: "/notes", label: "Notes", icon: "notes", key: "n" },
      { href: "/finance", label: "Finance", icon: "finance", key: "f" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/import", label: "Import", icon: "import" },
      { href: "/settings", label: "Settings", icon: "settings", key: "s" },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function SignOut({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <form action="/auth/signout" method="post">
      <button
        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted transition-colors hover:bg-subtle hover:text-fg"
        title="Sign out"
      >
        <Icon name="logout" size={18} />
        {!collapsed && "Sign out"}
      </button>
    </form>
  );
}

/** Desktop sidebar (≥ lg). */
export function Sidebar({ pathname, collapsed, onToggle }: { pathname: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface lg:flex ${
        collapsed ? "w-16" : "w-56"
      } transition-[width] duration-200`}
      aria-label="Main navigation"
    >
      <div className={`flex h-14 items-center gap-2 px-3 ${collapsed ? "justify-center" : ""}`}>
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" title="Personal OS">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg">
            <Icon name="logo" size={16} />
          </span>
          {!collapsed && <span>Personal OS</span>}
        </Link>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            {!collapsed && <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = isActive(it.href, pathname);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? it.label : it.key ? `${it.label} (g then ${it.key})` : it.label}
                      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        collapsed ? "justify-center" : ""
                      } ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle hover:text-fg"}`}
                    >
                      <Icon name={it.icon} size={18} />
                      {!collapsed && it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-2 border-t border-line p-2">
        {!collapsed && (
          <div className="px-1">
            <ThemeToggle />
          </div>
        )}
        <SignOut collapsed={collapsed} />
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? "Expand sidebar ( [ )" : "Collapse sidebar ( [ )"}
          className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-muted transition-colors hover:bg-subtle hover:text-fg ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <Icon name="sidebar" size={18} />
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}

const TABS = ["/", "/tasks", "/calendar", "/finance"];

/** Phone tab bar (< lg): 4 main sections + More. */
export function MobileTabs({ pathname }: { pathname: string }) {
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [pathname]);
  const tabs = TABS.map((h) => NAV_ITEMS.find((i) => i.href === h)!);
  const moreActive = !tabs.some((t) => isActive(t.href, pathname));

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setMore(false)}>
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+5rem)] shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-subtle-2" />
            <ul className="grid grid-cols-3 gap-2">
              {NAV_ITEMS.filter((i) => !TABS.includes(i.href)).map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    className={`flex flex-col items-center gap-1 rounded-xl p-3 text-xs ${
                      isActive(it.href, pathname) ? "bg-accent-soft font-medium text-accent" : "bg-subtle text-fg"
                    }`}
                  >
                    <Icon name={it.icon} size={22} />
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between gap-3">
              <ThemeToggle />
              <SignOut />
            </div>
          </div>
        </div>
      )}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Main navigation"
      >
        <ul className="grid grid-cols-5">
          {tabs.map((t) => {
            const active = isActive(t.href, pathname);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? "font-semibold text-accent" : "text-muted"}`}
                >
                  <Icon name={t.icon} size={22} />
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMore(!more)}
              aria-expanded={more}
              className={`flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] ${
                more || moreActive ? "font-semibold text-accent" : "text-muted"
              }`}
            >
              <Icon name="more" size={22} />
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
