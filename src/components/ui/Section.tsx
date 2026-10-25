import Link from "next/link";

const TONE = {
  default: "text-muted",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
} as const;

/** A titled group on a page: small uppercase title, optional count and "see all" link, then content. */
export default function Section({
  title,
  count,
  href,
  linkLabel,
  action,
  tone = "default",
  children,
  className = "",
}: {
  title: React.ReactNode;
  count?: number;
  href?: string;
  linkLabel?: string;
  action?: React.ReactNode;
  tone?: keyof typeof TONE;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${TONE[tone]}`}>
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-subtle-2 px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted">{count}</span>
          )}
        </h2>
        {action}
        {href && (
          <Link href={href} className="text-xs font-medium text-muted transition-colors hover:text-accent">
            {linkLabel ?? "See all"} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
