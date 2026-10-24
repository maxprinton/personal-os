// Calendar v2 data access (server only). Works with the signed-in client (RLS) and with the
// admin client used by Telegram/cron, so every query filters by user_id explicitly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, dateRange, daysBetween, isoWeekday } from "@/lib/time";
import type { BlockType, Occurrence, Slot } from "@/lib/calendar/types";

export const SLOT_COLS = "id,block_type_id,weekday,start_time,end_time,valid_from,valid_to";
export const OCC_COLS = "id,block_type_id,slot_id,origin_date,date,start_time,end_time,status,is_override";

/** Longest range materialized in one call (keeps a month view + margins cheap). */
const MAX_RANGE_DAYS = 70;

export async function currentUserId(sb: SupabaseClient) {
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user?.id ?? null;
}

export function slotActiveOn(slot: Slot, date: string) {
  return (
    slot.weekday === isoWeekday(date) && slot.valid_from <= date && (!slot.valid_to || slot.valid_to >= date)
  );
}

/** Live block types. includeDeleted also returns removed ones (so past days keep their names). */
export async function getBlockTypes(
  sb: SupabaseClient,
  userId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<BlockType[]> {
  let q = sb.from("block_types").select("id,name,color,deleted_at").eq("user_id", userId);
  if (!opts.includeDeleted) q = q.is("deleted_at", null);
  const { data } = await q.order("name");
  return ((data ?? []) as (BlockType & { deleted_at: string | null })[]).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    ...(t.deleted_at ? { removed: true } : {}),
  }));
}

/** Slots that are valid at some point between from and to (both optional). */
export async function getSlots(sb: SupabaseClient, userId: string, from?: string, to?: string): Promise<Slot[]> {
  let q = sb.from("block_slots").select(SLOT_COLS).eq("user_id", userId).is("deleted_at", null);
  if (to) q = q.lte("valid_from", to);
  if (from) q = q.or(`valid_to.is.null,valid_to.gte.${from}`);
  const { data } = await q.order("weekday").order("start_time");
  return (data ?? []) as Slot[];
}

/** Dates (YYYY-MM-DD) inside free-day ranges between from and to. Filled in by phase 6. */
export async function freeDatesBetween(sb: SupabaseClient, userId: string, from: string, to: string) {
  void sb;
  void userId;
  void from;
  void to;
  return new Set<string>();
}

/**
 * Creates the missing occurrences that the weekly slots generate between from and to.
 * Existing rows are never touched (their history, moves and cancellations are kept).
 */
export async function ensureOccurrences(sb: SupabaseClient, userId: string, from: string, to: string) {
  if (daysBetween(from, to) > MAX_RANGE_DAYS) to = addDays(from, MAX_RANGE_DAYS);
  if (to < from) return;
  const slots = await getSlots(sb, userId, from, to);
  if (!slots.length) return;

  const [{ data }, freeDates] = await Promise.all([
    sb
      .from("block_occurrences")
      .select("slot_id,origin_date")
      .eq("user_id", userId)
      .not("slot_id", "is", null)
      .gte("origin_date", from)
      .lte("origin_date", to),
    freeDatesBetween(sb, userId, from, to),
  ]);
  const have = new Set(((data ?? []) as { slot_id: string; origin_date: string }[]).map((r) => `${r.slot_id}|${r.origin_date}`));

  const rows: Record<string, unknown>[] = [];
  for (const date of dateRange(from, to)) {
    for (const s of slots) {
      if (!slotActiveOn(s, date) || have.has(`${s.id}|${date}`)) continue;
      rows.push({
        user_id: userId,
        block_type_id: s.block_type_id,
        slot_id: s.id,
        origin_date: date,
        date,
        start_time: s.start_time,
        end_time: s.end_time,
        status: freeDates.has(date) ? "free_day" : "scheduled",
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    await sb
      .from("block_occurrences")
      .upsert(rows.slice(i, i + 500), { onConflict: "slot_id,origin_date", ignoreDuplicates: true });
  }
}

/**
 * Occurrences that show between from and to (cancelled ones excluded).
 * Includes the day before `from` when an overnight block spills into it.
 */
export async function getOccurrences(
  sb: SupabaseClient,
  userId: string,
  from: string,
  to: string,
  opts: { includeCancelled?: boolean } = {}
): Promise<Occurrence[]> {
  const before = addDays(from, -1);
  await ensureOccurrences(sb, userId, before, to);
  let q = sb
    .from("block_occurrences")
    .select(OCC_COLS)
    .eq("user_id", userId)
    .gte("date", before)
    .lte("date", to);
  if (!opts.includeCancelled) q = q.neq("status", "cancelled");
  const { data } = await q.order("date").order("start_time");
  return ((data ?? []) as Occurrence[]).filter(
    (o) => o.date !== before || o.end_time.slice(0, 5) <= o.start_time.slice(0, 5)
  );
}

export async function getOccurrence(sb: SupabaseClient, userId: string, id: string) {
  const { data } = await sb.from("block_occurrences").select(OCC_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  return (data as Occurrence | null) ?? null;
}
