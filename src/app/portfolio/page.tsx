// /portfolio — Overview: site status, what needs attention, and every page with its status.
import Link from "next/link";
import Section from "@/components/ui/Section";
import PagesTable from "@/components/portfolio/PagesTable";
import { StatusBadge } from "@/components/portfolio/ui";
import { BASE, LANGS } from "@/lib/portfolio/constants";
import { portfolioServer } from "@/lib/portfolio/db";
import { loadSlotViews } from "@/lib/portfolio/link";
import { loadSite } from "@/lib/portfolio/site";
import { KIND_LABEL } from "@/lib/portfolio/slots";
import { NEEDS_ATTENTION } from "@/lib/portfolio/status";

export default async function PortfolioOverview() {
  const { supabase, userId } = await portfolioServer();
  if (!userId) return null;
  const [{ slots }, { site, saved }] = await Promise.all([loadSlotViews(supabase, userId), loadSite(supabase, userId)]);

  const rows = slots.flatMap((s) => LANGS.map((lang) => ({ s, lang, p: s.pages[lang] })));
  const live = rows.filter((r) => r.p.published?.is_live).length;
  const attention = rows.filter((r) => NEEDS_ATTENTION.includes(r.p.status));
  const empty = rows.filter((r) => r.p.status === "no_note" && site.langs.includes(r.lang));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Slots" value={slots.length} />
        <Stat label="Pages live" value={live} />
        <Stat label="Need attention" value={attention.length} tone={attention.length ? "warning" : undefined} />
        <Stat label="Languages without a note" value={empty.length} />
      </div>

      {!saved && (
        <p className="rounded-lg border border-dashed border-line p-3 text-sm text-muted">
          Your site settings are still the defaults. <Link href={`${BASE}/settings`} className="text-accent hover:underline">Set the name, tagline and links</Link>.
        </p>
      )}
      {!slots.length && (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">
          No pages yet. Start with <Link href={`${BASE}/pages`} className="text-accent hover:underline">Home, About and Now</Link>: create each slot, then write its note in English and Spanish.
        </p>
      )}

      {attention.length > 0 && (
        <Section title="Needs attention" count={attention.length}>
          <ul className="space-y-2">
            {attention.map(({ s, lang, p }) => (
              <li key={`${s.id}:${lang}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
                <Link href={`${BASE}/pages/${s.id}`} className="font-medium hover:underline">
                  {KIND_LABEL[s.kind]} · {s.kind === s.key ? "" : `${s.key} · `}
                  {lang.toUpperCase()}
                </Link>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {slots.length > 0 && (
        <Section title="All pages" count={slots.length} href={`${BASE}/pages`} linkLabel="Open the list">
          <PagesTable slots={slots} />
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone === "warning" ? "text-warning" : ""}`}>{value}</p>
    </div>
  );
}
