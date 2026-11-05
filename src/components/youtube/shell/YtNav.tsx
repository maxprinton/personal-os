"use client";
// YouTube add-on navigation (owned by the Lead): the add-on sub-nav and the stage tabs of a video.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADDON_NAV, BASE, VIDEO_FULLSCREEN, VIDEO_TABS, videoHref } from "@/lib/youtube/constants";

const TAB = "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors";
const ON = "bg-accent-soft font-medium text-accent";
const OFF = "text-muted hover:bg-subtle hover:text-fg";

/** True on the full-screen views (filming mode, teleprompter): the navigation hides itself there. */
export function isFullscreenPath(pathname: string) {
  return VIDEO_FULLSCREEN.some((v) => new RegExp(`^${BASE}/v/[^/]+/${v}(/|$)`).test(pathname));
}

export function AddonNav() {
  const pathname = usePathname() ?? BASE;
  if (isFullscreenPath(pathname)) return null;
  const active = (href: string) =>
    href === BASE ? pathname === BASE || pathname.startsWith(`${BASE}/v/`) : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="YouTube sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {ADDON_NAV.map((n) => (
        <Link key={n.href} href={n.href} className={`${TAB} ${active(n.href) ? ON : OFF}`} aria-current={active(n.href) ? "page" : undefined}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function VideoTabs({ id, hidden = [] }: { id: string; hidden?: string[] }) {
  const pathname = usePathname() ?? "";
  if (isFullscreenPath(pathname)) return null;
  const base = videoHref(id);
  const current = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : "";
  return (
    <nav aria-label="Video stages" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 pb-2">
      {VIDEO_TABS.filter((t) => !hidden.includes(t.id)).map((t, i) => (
        <Link key={t.id} href={videoHref(id, t.id)} className={`${TAB} ${current === t.id ? ON : OFF}`} aria-current={current === t.id ? "page" : undefined}>
          <span className="mr-1 text-xs text-faint tabular-nums">{i + 1}</span>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function HideOnFullscreen({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  return isFullscreenPath(pathname) ? null : <>{children}</>;
}
