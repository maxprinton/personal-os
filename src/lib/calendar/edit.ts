// Calendar v2 write helpers (server only). Every query filters by user_id explicitly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, formatMinutes, isoWeekday, ISO_DAY_SHORT, timeToMinutes } from "@/lib/time";
import { findOccurrenceConflict, findSlotConflict, rangesIntersect, type SlotCandidate } from "@/lib/calendar/overlap";
import { ensureOccurrences, getBlockTypes, getOccurrences, getSlots, OCC_COLS, SLOT_COLS } from "@/lib/calendar/model";
import type { BlockType, Occurrence, Slot } from "@/lib/calendar/types";

export const PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#84cc16", "#f97316",
];

export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function isColor(c: string) {
  return /^#[0-9a-fA-F]{6}$/.test(c);
}

function hm(t: string) {
  return formatMinutes(timeToMinutes(t));
}

export async function findBlockTypeByName(sb: SupabaseClient, userId: string, name: string) {
  const types = await getBlockTypes(sb, userId);
  const key = normalizeName(name).toLowerCase();
  return { match: types.find((t) => t.name.toLowerCase() === key) ?? null, count: types.length };
}

/** Typing a name that already exists reuses that block (its color and habits). */
export async function findOrCreateBlockType(sb: SupabaseClient, userId: string, rawName: string, color?: string) {
  const name = normalizeName(rawName);
  const { match, count } = await findBlockTypeByName(sb, userId, name);
  if (match) return { type: match, created: false };
  const { data, error } = await sb
    .from("block_types")
    .insert({ user_id: userId, name, color: color && isColor(color) ? color : PALETTE[count % PALETTE.length] })
    .select("id,name,color")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the block.");
  return { type: data as BlockType, created: true };
}

/**
 * Explains why the candidate slots would overlap another block, or returns null.
 * Checks weekly slots and the "this day only" overrides that are already on the calendar.
 */
export async function slotConflictMessage(
  sb: SupabaseClient,
  userId: string,
  candidates: SlotCandidate[],
  ignoreSlots: Set<string> = new Set()
) {
  if (!candidates.length) return null;
  const from = candidates.map((c) => c.valid_from).sort()[0];
  const [slots, types, overridesRes] = await Promise.all([
    getSlots(sb, userId, from),
    getBlockTypes(sb, userId),
    sb
      .from("block_occurrences")
      .select(OCC_COLS)
      .eq("user_id", userId)
      .eq("is_override", true)
      .neq("status", "cancelled")
      .gte("date", addDays(from, -1)),
  ]);
  const name = new Map(types.map((t) => [t.id, t.name]));
  for (const c of candidates) {
    const hit = findSlotConflict(c, slots, ignoreSlots);
    if (hit) {
      return `Blocks can't overlap: this would overlap ${name.get(hit.block_type_id) ?? "another block"} (${
        ISO_DAY_SHORT[hit.weekday - 1]
      } ${hm(hit.start_time)}–${hm(hit.end_time)}).`;
    }
  }
  const overrides = ((overridesRes.data ?? []) as Occurrence[]).filter((o) => !o.slot_id || !ignoreSlots.has(o.slot_id));
  for (const o of overrides) {
    for (const d of [addDays(o.date, -1), o.date, addDays(o.date, 1)]) {
      for (const c of candidates) {
        if (c.weekday !== isoWeekday(d) || !rangesIntersect(c.valid_from, c.valid_to, d, d)) continue;
        if (findOccurrenceConflict({ date: d, start_time: c.start_time, end_time: c.end_time }, [o])) {
          return `Blocks can't overlap: on ${o.date} ${name.get(o.block_type_id) ?? "another block"} was moved to ${hm(
            o.start_time
          )}–${hm(o.end_time)}.`;
        }
      }
    }
  }
  return null;
}

/** Explains why a one-day block would overlap another block, or returns null. */
export async function occurrenceConflictMessage(
  sb: SupabaseClient,
  userId: string,
  candidate: { date: string; start_time: string; end_time: string },
  ignore: Set<string> = new Set()
) {
  const [occurrences, types] = await Promise.all([
    getOccurrences(sb, userId, candidate.date, addDays(candidate.date, 1)),
    getBlockTypes(sb, userId),
  ]);
  const hit = findOccurrenceConflict(candidate, occurrences, ignore);
  if (!hit) return null;
  const name = types.find((t) => t.id === hit.block_type_id)?.name ?? "another block";
  return `Blocks can't overlap: this would overlap ${name} (${hit.date} ${hm(hit.start_time)}–${hm(hit.end_time)}).`;
}

/**
 * An occurrence nobody has touched: still just what the pattern generated, with no history.
 * Later phases add more conditions (habit marks, tasks).
 */
export async function untouchedIds(sb: SupabaseClient, userId: string, occurrences: Occurrence[]) {
  void sb;
  void userId;
  return new Set(
    occurrences.filter((o) => !o.is_override && (o.status === "scheduled" || o.status === "free_day")).map((o) => o.id)
  );
}

/** Called after occurrences were removed or moved, so tasks/marks can follow (filled in later phases). */
export async function afterOccurrencesChanged(sb: SupabaseClient, userId: string, removedIds: string[]) {
  void sb;
  void userId;
  void removedIds;
}

/** Ends a slot the day before `from` (or retires it if it had not started yet). */
async function closeSlot(sb: SupabaseClient, userId: string, slot: Slot, from: string) {
  if (slot.valid_from >= from) {
    await sb.from("block_slots").update({ deleted_at: new Date().toISOString() }).eq("id", slot.id).eq("user_id", userId);
  } else {
    await sb.from("block_slots").update({ valid_to: addDays(from, -1) }).eq("id", slot.id).eq("user_id", userId);
  }
}

async function futureOccurrencesOf(sb: SupabaseClient, userId: string, slotId: string, from: string) {
  const { data } = await sb
    .from("block_occurrences")
    .select(OCC_COLS)
    .eq("user_id", userId)
    .eq("slot_id", slotId)
    .gte("origin_date", from);
  return (data ?? []) as Occurrence[];
}

/**
 * "From today on": closes the old slot and opens a new one from `from`.
 * Occurrences before `from` are never touched.
 */
export async function changeSlotForward(
  sb: SupabaseClient,
  userId: string,
  slot: Slot,
  next: { weekday: number; start_time: string; end_time: string },
  from: string
) {
  await closeSlot(sb, userId, slot, from);
  const { data: created, error } = await sb
    .from("block_slots")
    .insert({
      user_id: userId,
      block_type_id: slot.block_type_id,
      weekday: next.weekday,
      start_time: next.start_time,
      end_time: next.end_time,
      valid_from: from,
      valid_to: slot.valid_to && slot.valid_to >= from ? slot.valid_to : null,
    })
    .select(SLOT_COLS)
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not save the new pattern.");
  const newSlot = created as Slot;

  const future = await futureOccurrencesOf(sb, userId, slot.id, from);
  const untouched = await untouchedIds(sb, userId, future);
  const removed: string[] = [];
  for (const f of future) {
    if (next.weekday === slot.weekday) {
      // Same weekday: keep the row (and anything attached to it), follow the new times
      const values = untouched.has(f.id)
        ? { slot_id: newSlot.id, start_time: next.start_time, end_time: next.end_time, date: f.origin_date ?? f.date }
        : { slot_id: newSlot.id };
      await sb.from("block_occurrences").update(values).eq("id", f.id).eq("user_id", userId);
    } else if (untouched.has(f.id)) {
      removed.push(f.id);
    } else {
      await sb.from("block_occurrences").update({ slot_id: null }).eq("id", f.id).eq("user_id", userId);
    }
  }
  if (removed.length) {
    await sb.from("block_occurrences").delete().in("id", removed).eq("user_id", userId);
    await afterOccurrencesChanged(sb, userId, removed);
  }
  await ensureOccurrences(sb, userId, from, addDays(from, 13));
  return newSlot;
}

/** "From today on" removal: the block stops repeating; the past stays as it was. */
export async function removeSlotForward(sb: SupabaseClient, userId: string, slot: Slot, from: string) {
  await closeSlot(sb, userId, slot, from);
  const future = await futureOccurrencesOf(sb, userId, slot.id, from);
  const untouched = await untouchedIds(sb, userId, future);
  const removed = future.filter((f) => untouched.has(f.id)).map((f) => f.id);
  if (removed.length) {
    await sb.from("block_occurrences").delete().in("id", removed).eq("user_id", userId);
    await afterOccurrencesChanged(sb, userId, removed);
  }
}

export async function getSlot(sb: SupabaseClient, userId: string, id: string) {
  const { data } = await sb.from("block_slots").select(SLOT_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  return (data as Slot | null) ?? null;
}
