// A small chip on a note that is the page of a portfolio slot: where it lives and its status. Server component.
import Link from "next/link";
import { StatusBadge } from "@/components/portfolio/ui";
import { BASE, LANG_LABEL } from "@/lib/portfolio/constants";
import { loadSlotViews, portfolioLinkOfNote } from "@/lib/portfolio/link";
import { KIND_LABEL } from "@/lib/portfolio/slots";
import { createClient } from "@/lib/supabase/server";

export default async function PortfolioChip({ noteId }: { noteId: string }) {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return null;
    const userId = user.id;
    const link = await portfolioLinkOfNote(sb, userId, noteId);
    if (!link) return null;
    const { slots } = await loadSlotViews(sb, userId, { includeArchived: true });
    const slot = slots.find((s) => s.id === link.slotId);
    if (!slot) return null;
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Link href={`${BASE}/pages/${slot.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-subtle">
          <span aria-hidden>🌐</span>
          <span>
            Portfolio · {link.kind === link.key ? KIND_LABEL[link.kind] : link.key} · {LANG_LABEL[link.lang]}
          </span>
        </Link>
        <StatusBadge status={slot.pages[link.lang].status} />
      </div>
    );
  } catch {
    return null; // the chip must never break the note
  }
}
