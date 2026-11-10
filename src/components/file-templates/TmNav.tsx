"use client";
// Template Manager add-on sub-navigation.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BASE, NAV } from "@/lib/file-templates/constants";

const TAB = "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors";
const ON = "bg-accent-soft font-medium text-accent";
const OFF = "text-muted hover:bg-subtle hover:text-fg";

export default function TmNav({ inbox = 0, trash = 0 }: { inbox?: number; trash?: number }) {
  const pathname = usePathname() ?? BASE;
  const sub = NAV.filter((n) => n.href !== BASE).map((n) => n.href);
  const active = (href: string) => (href === BASE ? !sub.some((s) => pathname.startsWith(s)) : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Template Manager sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {NAV.map((n) => {
        const count = n.href.endsWith("/inbox") ? inbox : n.href.endsWith("/trash") ? trash : 0;
        return (
          <Link key={n.href} href={n.href} className={`${TAB} ${active(n.href) ? ON : OFF}`} aria-current={active(n.href) ? "page" : undefined}>
            {n.label}
            {count > 0 && <span className="ml-1.5 rounded-full bg-subtle-2 px-1.5 py-0.5 text-[10px] font-semibold text-fg">{count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
