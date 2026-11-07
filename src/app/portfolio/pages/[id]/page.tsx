// /portfolio/pages/[id] — one slot: EN / ES cards (note + status) and its details.
import Link from "next/link";
import { notFound } from "next/navigation";
import LangCard from "@/components/portfolio/LangCard";
import SlotEditor from "@/components/portfolio/SlotEditor";
import { StatusBadge } from "@/components/portfolio/ui";
import { BASE, LANGS } from "@/lib/portfolio/constants";
import { portfolioServer } from "@/lib/portfolio/db";
import { loadSlotViews } from "@/lib/portfolio/link";
import { KIND_LABEL } from "@/lib/portfolio/slots";

export const metadata = { title: "Portfolio slot · Personal OS" };

export default async function SlotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, userId } = await portfolioServer();
  if (!userId) return null;
  const { slots } = await loadSlotViews(supabase, userId, { includeArchived: true });
  const slot = slots.find((s) => s.id === id);
  if (!slot) notFound();

  // normal, unlinked notes to pick from (latest first)
  const { data } = await supabase
    .from("notes")
    .select("id,title")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("block_name", null)
    .is("portfolio_slot_id", null)
    .eq("is_template", false)
    .order("updated_at", { ascending: false })
    .limit(80);
  const choices = ((data ?? []) as { id: string; title: string }[]).map((n) => ({ id: n.id, title: (n.title ?? "").trim() || "Untitled" }));
  const everPublished = LANGS.some((l) => !!slot.pages[l].published);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`${BASE}/pages`} className="text-xs text-muted hover:text-fg">← All pages</Link>
        <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
          {slot.kind === slot.key ? KIND_LABEL[slot.kind] : slot.key}
          <span className="text-sm font-normal text-muted">{slot.kind === slot.key ? "" : KIND_LABEL[slot.kind]}</span>
          {slot.archived && <StatusBadge status="unpublished" />}
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {LANGS.map((lang) => (
          <LangCard key={lang} slot={slot} lang={lang} choices={choices} />
        ))}
      </div>
      <SlotEditor slot={slot} everPublished={everPublished} />
    </div>
  );
}
