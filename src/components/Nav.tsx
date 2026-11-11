"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { addonById } from "@/lib/addons/registry";

type NavItem = { href: string; label: string; icon: IconName; key?: string };

/** The app's sections, grouped as in the redesign plan. `key` = keyboard shortcut after "g". */
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Now",
    items: [
      { href: "/", label: "Today", icon: "today", key: "h" },
      { href: "/telegram", label: "Telegram", icon: "telegram", key: "c" },
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
      { href: "/insights", label: "Insights", icon: "insights", key: "i" },
      { href: "/notes", label: "Notes", icon: "notes", key: "n" },
      { href: "/search", label: "Search", icon: "search", key: "r" },
      { href: "/finance", label: "Finance", icon: "finance", key: "f" },
    ],
  },
  {
    label: "Add-ons",
    items: [{ href: "/addons", label: "All add-ons", icon: "addons", key: "o" }],
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

/** The menu with the pinned add-ons (favorites) listed above "All add-ons", in pin order. */
export function navGroupsWith(favorites: string[]) {
  const pinned: NavItem[] = favorites.flatMap((id) => {
    const a = addonById(id);
    return a ? [{ href: a.href, label: a.name, icon: a.icon, key: a.key }] : [];
  });
  return NAV_GROUPS.map((g) => (g.label === "Add-ons" ? { ...g, items: [...pinned, ...g.items] } : g));
}

export function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SignOut({ collapsed = false }: { collapsed?: boolean }) {
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

const TABS = ["/", "/tasks", "/calendar", "/finance"];

/** Phone tab bar (< lg): 4 main sections + More. */
export function MobileTabs({ pathname, favorites }: { pathname: string; favorites: string[] }) {
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [pathname]);
  const tabs = TABS.map((h) => NAV_ITEMS.find((i) => i.href === h)!);
  const sheet = navGroupsWith(favorites)
    .flatMap((g) => g.items)
    .filter((i) => !TABS.includes(i.href));
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
              {sheet.map((it) => (
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
