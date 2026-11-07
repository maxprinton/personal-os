// /portfolio/pages — every slot with its status per language; filter by kind; create a slot.
import Link from "next/link";
import PagesTable from "@/components/portfolio/PagesTable";
import NewSlotForm from "@/components/portfolio/NewSlotForm";
import Section from "@/components/ui/Section";
import { BASE, KINDS } from "@/lib/portfolio/constants";
import { portfolioServer } from "@/lib/portfolio/db";
import { loadSlotViews } from "@/lib/portfolio/link";
import { isKind, KIND_LABEL } from "@/lib/portfolio/slots";

export const metadata = { title: "Portfolio pages · Personal OS" };

export default async function PortfolioPages({ searchParams }: { searchParams: Promise<{ kind?: string; archived?: string }> }) {
  const sp = await searchParams;
  const { supabase, userId } = await portfolioServer();
  if (!userId) return null;
  const showArchived = sp.archived === "1";
  const { slots: all } = await loadSlotViews(supabase, userId, { includeArchived: true });
  const kind = isKind(sp.kind) ? sp.kind : null;
  const slots = all.filter((s) => (showArchived ? s.archived : !s.archived) && (!kind || s.kind === kind));
  const existing = all.filter((s) => !s.archived).map((s) => s.kind);
  const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-xs ${on ? "bg-accent-soft font-medium text-accent" : "bg-subtle text-muted hover:text-fg"}`;
  const href = (k: string | null, archived = showArchived) => `${BASE}/pages${k || archived ? "?" : ""}${[k ? `kind=${k}` : "", archived ? "archived=1" : ""].filter(Boolean).join("&")}`;

  return (
    <div className="space-y-6">
      <Section title="New slot">
        <NewSlotForm existing={existing} />
      </Section>
      <Section title={showArchived ? "Archived" : "Pages"} count={slots.length}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Link href={href(null)} className={chip(!kind)}>All</Link>
          {KINDS.map((k) => (
            <Link key={k} href={href(k)} className={chip(kind === k)}>
              {KIND_LABEL[k]}
            </Link>
          ))}
          <Link href={href(kind, !showArchived)} className={`ml-auto ${chip(showArchived)}`}>
            {showArchived ? "Back to active" : "Archived"}
          </Link>
        </div>
        {slots.length ? <PagesTable slots={slots} /> : <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">Nothing here yet.</p>}
      </Section>
    </div>
  );
}
