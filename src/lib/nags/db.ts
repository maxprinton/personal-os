// Event nags (BL-98): reading and replacing the saved nags. No "use server" here: the actions call these.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanNags, type Nag, type NagRow } from "@/lib/nags/rules";

/** A nag as the editor works with it (no id). */
export type NagDraft = Omit<Nag, "id">;

const draftOf = (r: NagRow): NagDraft => ({
  kind: r.kind === "before" || r.kind === "mid" ? r.kind : "start",
  offsetMinutes: Number(r.offset_minutes) || 0,
  channel: r.channel === "phone" || r.channel === "both" ? r.channel : "telegram",
  phoneStyle: r.phone_style === "notify" ? "notify" : "alarm",
});

const ORDER = { before: 0, start: 1, mid: 2 } as const;
const sorted = (l: NagDraft[]) =>
  [...l].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.offsetMinutes - a.offsetMinutes);

/** The default set (eventId null) or the own list of one event. */
export async function readNags(sb: SupabaseClient, userId: string, eventId: string | null) {
  let q = sb.from("event_nags").select("id,event_id,kind,offset_minutes,channel,phone_style").eq("user_id", userId);
  q = eventId ? q.eq("event_id", eventId) : q.is("event_id", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return sorted(((data ?? []) as NagRow[]).map(draftOf));
}

/** Replaces the whole list. The list is cleaned first (valid kinds, no duplicates, at most 12). */
export async function replaceNags(sb: SupabaseClient, userId: string, eventId: string | null, list: unknown[]) {
  const clean = cleanNags(list as Parameters<typeof cleanNags>[0]);
  let del = sb.from("event_nags").delete().eq("user_id", userId);
  del = eventId ? del.eq("event_id", eventId) : del.is("event_id", null);
  const { error: delErr } = await del;
  if (delErr) throw new Error(delErr.message);
  if (clean.length) {
    const { error } = await sb.from("event_nags").insert(
      clean.map((n) => ({
        user_id: userId,
        event_id: eventId,
        kind: n.kind,
        offset_minutes: n.offsetMinutes,
        channel: n.channel,
        phone_style: n.phoneStyle,
      }))
    );
    if (error) throw new Error(error.message);
  }
  return clean.length;
}
