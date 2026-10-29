// "Review on" (built-in date property): the notes whose review day has come. Shown on Today
// ("📖 Notes to review") and in the Telegram morning message. Server side, but it only reads, and it
// works with the signed-in client and with the admin client (every query filters by user_id).
// If migration 0021 isn't run yet (no note_properties / notes.props), it simply finds nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, daysBetween } from "@/lib/time";
import type { DateValue, PropValue, SelectOption } from "@/lib/notes-db/types";

export type ReviewNote = { id: string; title: string; icon: string | null; date: string; overdueDays: number };

/** Overdue notes older than this are not shown any more (you forgot them on purpose). */
export const REVIEW_LOOKBACK_DAYS = 14;

type PropRow = { id: string; key: string; config: { options?: SelectOption[]; defaultOptionId?: string } | null };
type NoteRow = { id: string; title: string | null; block_name: string | null; page: { icon?: string | null } | null; props: Record<string, PropValue> | null };

export type ReviewProps = { reviewId: string; statusId: string | null; doneIds: Set<string>; defaultStatus: string | null };

/** The property ids that matter, from the built-in properties (null = no "Review on" yet). */
export function reviewProps(rows: PropRow[]): ReviewProps | null {
  const review = rows.find((p) => p.key === "review_on");
  if (!review) return null;
  const status = rows.find((p) => p.key === "status") ?? null;
  const opts = status?.config?.options ?? [];
  return {
    reviewId: review.id,
    statusId: status?.id ?? null,
    doneIds: new Set(opts.filter((o) => o.group === "done").map((o) => o.id)),
    defaultStatus: status?.config?.defaultOptionId ?? null,
  };
}

const dateOf = (v: PropValue | undefined): string | null => {
  const d = v as DateValue | null | undefined;
  return d && typeof d === "object" && !Array.isArray(d) && typeof d.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.start) ? d.start : null;
};

/** Pure: the notes to review today (due today or overdue up to REVIEW_LOOKBACK_DAYS, not done), most overdue first. */
export function pickToReview(notes: NoteRow[], p: ReviewProps, today: string): ReviewNote[] {
  const oldest = addDays(today, -REVIEW_LOOKBACK_DAYS);
  const out: ReviewNote[] = [];
  for (const n of notes) {
    const date = dateOf(n.props?.[p.reviewId]);
    if (!date || date > today || date < oldest) continue;
    const status = (p.statusId ? (n.props?.[p.statusId] as string | null | undefined) : null) ?? p.defaultStatus;
    if (status && p.doneIds.has(status)) continue;
    out.push({ id: n.id, title: n.block_name || n.title || "Untitled", icon: n.page?.icon ?? null, date, overdueDays: daysBetween(date, today) });
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays || a.title.localeCompare(b.title));
}

/** The notes to review on `today` (YYYY-MM-DD in the user's timezone). Never throws: [] on any problem. */
export async function notesToReview(sb: SupabaseClient, userId: string, today: string): Promise<ReviewNote[]> {
  try {
    const { data: propRows, error } = await sb
      .from("note_properties")
      .select("id,key,config")
      .eq("user_id", userId)
      .eq("builtin", true)
      .is("deleted_at", null)
      .in("key", ["review_on", "status"]);
    if (error) return [];
    const p = reviewProps((propRows ?? []) as PropRow[]);
    if (!p) return [];
    const rows: NoteRow[] = [];
    for (let from = 0; from < 5000; from += 1000) {
      const { data, error: e2 } = await sb
        .from("notes")
        .select("id,title,block_name,page,props")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .eq("is_template", false)
        .order("updated_at", { ascending: false })
        .range(from, from + 999);
      if (e2) return [];
      rows.push(...((data ?? []) as NoteRow[]));
      if (!data || data.length < 1000) break;
    }
    return pickToReview(rows, p, today);
  } catch {
    return [];
  }
}

/** One line for the Telegram morning message ("" when there is nothing to review). */
export function reviewLine(notes: Pick<ReviewNote, "title">[], max = 4) {
  if (!notes.length) return "";
  const shown = notes.slice(0, max).map((n) => n.title.replace(/\s+/g, " ").trim().slice(0, 60));
  return `\n📖 To review: ${shown.join(" · ")}${notes.length > max ? ` (+${notes.length - max} more)` : ""}`;
}
