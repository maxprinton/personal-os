"use client";
// Portfolio add-on sub-navigation.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADDON_NAV, BASE } from "@/lib/portfolio/constants";

const TAB = "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors";
const ON = "bg-accent-soft font-medium text-accent";
const OFF = "text-muted hover:bg-subtle hover:text-fg";

export default function PortfolioNav({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname() ?? BASE;
  const active = (href: string) => (href === BASE ? pathname === BASE : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Portfolio sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {ADDON_NAV.map((n) => (
        <Link key={n.href} href={n.href} className={`${TAB} ${active(n.href) ? ON : OFF}`} aria-current={active(n.href) ? "page" : undefined}>
          {n.label}
          {n.href.endsWith("/inbox") && unread > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg">{unread}</span>}
        </Link>
      ))}
    </nav>
  );
}
