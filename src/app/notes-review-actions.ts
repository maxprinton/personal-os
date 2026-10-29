"use server";
// "📖 Notes to review" on Today: ✓ Reviewed (clears "Review on") · +1 week / +1 month (moves it).
// Runs as the signed-in user (RLS). Migration 0021.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { addDays, localNow } from "@/lib/time";
import { getProperties } from "@/lib/notes-db/server";
import { setNoteValue } from "@/app/notes-db-actions";

type Result = { ok: true; date?: string | null } | { ok?: false; error: string };

async function reviewPropId(): Promise<{ id: string; timezone: string } | { error: string }> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { error: "Sign in again." };
  const [props, { timezone }] = await Promise.all([getProperties(sb, user.id), getSettings(sb)]);
  const p = props.find((x) => x.builtin && x.key === "review_on");
  if (!p) return { error: "The “Review on” property is missing. Open Notes once and try again." };
  return { id: p.id, timezone };
}

/** `when` gets today (YYYY-MM-DD, your timezone) and returns the new date, or null to clear it. */
async function setReview(noteId: string, when: (today: string) => string | null): Promise<Result> {
  try {
    if (!noteId) return { error: "Missing note." };
    const p = await reviewPropId();
    if ("error" in p) return p;
    const date = when(localNow(p.timezone).date);
    const r = await setNoteValue(noteId, p.id, date ? { start: date } : null);
    if (!r.ok) return { error: r.error };
    revalidatePath("/");
    return { ok: true, date };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save it." };
  }
}

/** ✓ Reviewed: clears "Review on" (the note leaves the list). */
export async function markReviewed(noteId: string): Promise<Result> {
  return setReview(noteId, () => null);
}

/** Review it again in `days` days (from today, in your timezone). */
export async function reviewAgain(noteId: string, days: number): Promise<Result> {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > 366) return { error: "Pick between 1 and 366 days." };
  return setReview(noteId, (today) => addDays(today, n));
}
