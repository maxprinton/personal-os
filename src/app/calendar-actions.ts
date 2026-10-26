"use server";

// Calendar v2 server actions. Called directly from the calendar panel (client components).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { addDays, isDate, isTime, isoWeekday, localNow, minutesToTime, timeToMinutes, zonedToUtc } from "@/lib/time";
import { ensureOccurrences, getOccurrence, getOccurrences, getSlots } from "@/lib/calendar/model";
import {
  afterOccurrencesChanged,
  changeSlotForward,
  findOrCreateBlockType,
  getSlot,
  isColor,
  normalizeName,
  occurrenceConflictMessage,
  removeSlotForward,
  slotConflictMessage,
} from "@/lib/calendar/edit";
import { userTimezone } from "@/lib/calendar/load";
import { getChecks, getHabits, recomputeOccurrenceStatus, setHabitCheck } from "@/lib/calendar/habits";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import { autoPlaceTasks, countMove, getTask, nextOccurrenceAfter } from "@/lib/calendar/tasks";
import { applyFreeDays, undoFreeDays } from "@/lib/calendar/freedays";
import { ensurePaymentEvents } from "@/lib/calendar/payments";
import type { RepeatUnit } from "@/lib/calendar/recurrence";
import { isMobileRequest, READ_ONLY_MESSAGE } from "@/lib/device";
import type { CalResult, EditScope, FreeDayPolicy, HabitState, Occurrence } from "@/lib/calendar/types";
import { durationOf, findOccurrenceConflict } from "@/lib/calendar/overlap";

/** Thrown when an edit comes from a phone (the calendar is read-only there). */
class ReadOnlyError extends Error {}

async function ctx() {
  // Every action in this file edits the calendar: never from a phone
  if (await isMobileRequest()) throw new ReadOnlyError(READ_ONLY_MESSAGE);
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  const { data: s } = await sb
    .from("user_settings")
    .select("timezone,past_edit_until")
    .eq("user_id", user.id)
    .maybeSingle();
  const timezone = (s?.timezone as string | undefined) ?? (await userTimezone(sb, user.id));
  const until = s?.past_edit_until as string | null | undefined;
  return {
    sb,
    userId: user.id,
    timezone,
    today: localNow(timezone).date,
    /** "Edit the past" window is open (confirmed less than an hour ago). */
    pastOpen: Boolean(until && new Date(until).getTime() > Date.now()),
  };
}

const PAST_LOCKED: CalResult = {
  error: "The past is locked. Confirm to edit past days for the next hour.",
  code: "PAST_LOCKED",
};

/** Past days are locked unless the 1-hour window is open. Returns the refusal, or null to go on. */
function pastGuard(c: { today: string; pastOpen: boolean }, ...dates: (string | null | undefined)[]): CalResult | null {
  if (c.pastOpen) return null;
  return dates.some((d) => d && d < c.today) ? PAST_LOCKED : null;
}

/** Confirmation given: past days can be edited for one hour without more questions. */
export async function unlockPast(): Promise<CalResult> {
  try {
    const c = await ctx();
    await c.sb
      .from("user_settings")
      .update({ past_edit_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
      .eq("user_id", c.userId);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Close the window early ("Stop editing the past"). */
export async function lockPast(): Promise<CalResult> {
  try {
    const c = await ctx();
    await c.sb.from("user_settings").update({ past_edit_until: null }).eq("user_id", c.userId);
    return done();
  } catch (e) {
    return fail(e);
  }
}

function done(): CalResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

function fail(e: unknown): CalResult {
  if (e instanceof ReadOnlyError) return { error: e.message, code: "READ_ONLY" };
  return { error: e instanceof Error ? e.message : "Something went wrong." };
}

function hhmm(t: string) {
  return t.slice(0, 5);
}

function checkTimes(start: string, end: string) {
  if (!isTime(start) || !isTime(end)) return "Pick a start and an end time.";
  if (hhmm(start) === hhmm(end)) return "Start and end can't be the same time.";
  return null;
}

// ---------- Blocks ------------------------------------------------------------

export type NewBlockInput = {
  name: string;
  color?: string;
  date: string;
  start: string;
  end: string;
  /** weekly = every week on that weekday (default), this_day = only that date, days = several weekdays */
  repeat: "weekly" | "this_day" | "days";
  weekdays?: number[];
};

export async function createBlock(input: NewBlockInput): Promise<CalResult> {
  try {
    const c = await ctx();
    const name = normalizeName(input.name ?? "");
    if (!name) return { error: "Give the block a name." };
    if (!isDate(input.date)) return { error: "Pick a date." };
    const bad = checkTimes(input.start, input.end);
    if (bad) return { error: bad };
    const start_time = hhmm(input.start);
    const end_time = hhmm(input.end);
    const locked = pastGuard(c, input.date);
    if (locked) return locked;
    if (input.date < c.today && input.repeat !== "this_day") {
      return { error: "A block on a past day can only be for that day. Pick “Only this day”." };
    }

    if (input.repeat === "this_day") {
      const msg = await occurrenceConflictMessage(c.sb, c.userId, { date: input.date, start_time, end_time });
      if (msg) return { error: msg };
      const { type } = await findOrCreateBlockType(c.sb, c.userId, name, input.color);
      const { error } = await c.sb.from("block_occurrences").insert({
        user_id: c.userId,
        block_type_id: type.id,
        slot_id: null,
        origin_date: null,
        date: input.date,
        start_time,
        end_time,
        is_override: true,
      });
      if (error) return { error: error.message };
      return done();
    }

    const weekdays =
      input.repeat === "days"
        ? [...new Set((input.weekdays ?? []).map(Number))].filter((w) => Number.isInteger(w) && w >= 1 && w <= 7)
        : [isoWeekday(input.date)];
    if (!weekdays.length) return { error: "Pick at least one day." };

    const candidates = weekdays.map((weekday) => ({
      weekday,
      start_time,
      end_time,
      valid_from: input.date,
      valid_to: null,
    }));
    const msg = await slotConflictMessage(c.sb, c.userId, candidates);
    if (msg) return { error: msg };

    const { type } = await findOrCreateBlockType(c.sb, c.userId, name, input.color);
    const { error } = await c.sb
      .from("block_slots")
      .insert(candidates.map((s) => ({ ...s, user_id: c.userId, block_type_id: type.id })));
    if (error) return { error: error.message };
    await ensureOccurrences(c.sb, c.userId, input.date, addDays(input.date, 13));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export type EditOccurrenceInput = { id: string; date: string; start: string; end: string; scope: EditScope };

/** Move or resize a block. Default scope is "this day only"; "forward" changes the weekly pattern from today on. */
export async function editOccurrence(input: EditOccurrenceInput): Promise<CalResult> {
  try {
    const c = await ctx();
    const occ = await getOccurrence(c.sb, c.userId, input.id);
    if (!occ) return { error: "That block is no longer on the calendar." };
    if (!isDate(input.date)) return { error: "Pick a date." };
    const locked = pastGuard(c, occ.date, input.date);
    if (locked) return locked;
    const bad = checkTimes(input.start, input.end);
    if (bad) return { error: bad };
    const start_time = hhmm(input.start);
    const end_time = hhmm(input.end);

    if (input.scope === "forward") {
      if (!occ.slot_id) return { error: "This block was only for one day, so it has no weekly pattern to change." };
      if (occ.date < c.today) return { error: "Past days can only be changed for that day." };
      const slot = await getSlot(c.sb, c.userId, occ.slot_id);
      if (!slot) return { error: "The weekly pattern of this block was not found." };
      const origin = occ.origin_date ?? occ.date;
      const from = origin > c.today ? origin : c.today;
      const next = { weekday: isoWeekday(input.date), start_time, end_time };
      const msg = await slotConflictMessage(
        c.sb,
        c.userId,
        [{ ...next, valid_from: from, valid_to: slot.valid_to && slot.valid_to >= from ? slot.valid_to : null }],
        new Set([slot.id])
      );
      if (msg) return { error: msg };
      await changeSlotForward(c.sb, c.userId, slot, next, from);
      // The block being edited follows the new times even if it had been edited before
      if (next.weekday === slot.weekday) {
        await c.sb
          .from("block_occurrences")
          .update({ start_time, end_time })
          .eq("id", occ.id)
          .eq("user_id", c.userId);
      }
      return done();
    }

    const msg = await occurrenceConflictMessage(
      c.sb,
      c.userId,
      { date: input.date, start_time, end_time },
      new Set([occ.id])
    );
    if (msg) return { error: msg };
    const { error } = await c.sb
      .from("block_occurrences")
      .update({ date: input.date, start_time, end_time, is_override: true })
      .eq("id", occ.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    // Its tasks follow the block to the new day (moving the block is not moving the task)
    if (input.date !== occ.date) {
      await c.sb
        .from("tasks")
        .update({ scheduled_for: input.date })
        .eq("user_id", c.userId)
        .eq("occurrence_id", occ.id)
        .eq("status", "pending");
    }
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Remove a block for one day ("this_day", default) or stop it repeating from today on ("forward"). */
export async function removeOccurrence(input: { id: string; scope: EditScope }): Promise<CalResult> {
  try {
    const c = await ctx();
    const occ = await getOccurrence(c.sb, c.userId, input.id);
    if (!occ) return { error: "That block is no longer on the calendar." };
    const locked = pastGuard(c, occ.date);
    if (locked) return locked;

    if (input.scope === "forward") {
      if (!occ.slot_id) return { error: "This block was only for one day." };
      if (occ.date < c.today) return { error: "Past days can only be changed for that day." };
      const slot = await getSlot(c.sb, c.userId, occ.slot_id);
      if (!slot) return { error: "The weekly pattern of this block was not found." };
      const origin = occ.origin_date ?? occ.date;
      await removeSlotForward(c.sb, c.userId, slot, origin > c.today ? origin : c.today);
    }
    // The block that was clicked always disappears (if it still exists)
    await c.sb
      .from("block_occurrences")
      .update({ status: "cancelled" })
      .eq("id", occ.id)
      .eq("user_id", c.userId);
    await afterOccurrencesChanged(c.sb, c.userId, [occ.id]);
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------- Several blocks at once (multi-select) --------------------------------
// Always "only these days": weekly patterns are changed one block at a time.

const MAX_BULK = 100;

async function loadMany(c: Awaited<ReturnType<typeof ctx>>, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, MAX_BULK);
  if (!unique.length) return { error: "Select at least one block." } as const;
  const { data } = await c.sb
    .from("block_occurrences")
    .select("id,block_type_id,slot_id,origin_date,date,start_time,end_time,status,is_override")
    .eq("user_id", c.userId)
    .in("id", unique);
  const list = ((data ?? []) as Occurrence[]).filter((o) => o.status !== "cancelled");
  if (!list.length) return { error: "Those blocks are no longer on the calendar." } as const;
  return { list } as const;
}

/** Move the selected blocks together by the same number of days and minutes (only those days). */
export async function moveOccurrences(input: { ids: string[]; dayShift: number; minuteShift: number }): Promise<CalResult> {
  try {
    const c = await ctx();
    const dayShift = Math.trunc(Number(input.dayShift) || 0);
    const minuteShift = Math.trunc(Number(input.minuteShift) || 0);
    if (!dayShift && !minuteShift) return done();
    if (Math.abs(dayShift) > 366 || Math.abs(minuteShift) > 1440) return { error: "That move is too far." };
    const got = await loadMany(c, input.ids);
    if ("error" in got) return { error: got.error };
    const moved = got.list.map((o) => {
      const startAbs = timeToMinutes(o.start_time) + minuteShift;
      const date = addDays(o.date, dayShift + Math.floor(startAbs / 1440));
      const start = ((startAbs % 1440) + 1440) % 1440;
      return {
        o,
        date,
        start_time: minutesToTime(start),
        end_time: minutesToTime(start + durationOf(o.start_time, o.end_time)),
      };
    });
    const locked = pastGuard(c, ...got.list.map((o) => o.date), ...moved.map((m) => m.date));
    if (locked) return locked;

    // Check against every other block around the new days (the selected ones move together)
    const dates = moved.map((m) => m.date).sort();
    const others = await getOccurrences(c.sb, c.userId, dates[0], addDays(dates[dates.length - 1], 1));
    const ignore = new Set(got.list.map((o) => o.id));
    for (const m of moved) {
      const hit = findOccurrenceConflict(m, others, ignore);
      if (hit) {
        return {
          error: `Blocks can't overlap: on ${m.date} a selected block would overlap another one at ${hit.start_time.slice(0, 5)}–${hit.end_time.slice(0, 5)}.`,
        };
      }
    }

    for (const m of moved) {
      const { error } = await c.sb
        .from("block_occurrences")
        .update({ date: m.date, start_time: m.start_time, end_time: m.end_time, is_override: true })
        .eq("id", m.o.id)
        .eq("user_id", c.userId);
      if (error) return { error: error.message };
      if (m.date !== m.o.date) {
        await c.sb
          .from("tasks")
          .update({ scheduled_for: m.date })
          .eq("user_id", c.userId)
          .eq("occurrence_id", m.o.id)
          .eq("status", "pending");
      }
    }
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Remove the selected blocks for their days only (weekly patterns stay). */
export async function removeOccurrences(input: { ids: string[] }): Promise<CalResult> {
  try {
    const c = await ctx();
    const got = await loadMany(c, input.ids);
    if ("error" in got) return { error: got.error };
    const locked = pastGuard(c, ...got.list.map((o) => o.date));
    if (locked) return locked;
    const ids = got.list.map((o) => o.id);
    const { error } = await c.sb
      .from("block_occurrences")
      .update({ status: "cancelled" })
      .eq("user_id", c.userId)
      .in("id", ids);
    if (error) return { error: error.message };
    await afterOccurrencesChanged(c.sb, c.userId, ids);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Mark the selected blocks done (all their habits), or undo it. Future and inactive blocks are skipped. */
export async function setOccurrencesDone(input: { ids: string[]; done: boolean }): Promise<CalResult> {
  try {
    const c = await ctx();
    const got = await loadMany(c, input.ids);
    if ("error" in got) return { error: got.error };
    const list = got.list.filter((o) => o.date <= c.today && o.status !== "free_day");
    if (!list.length) return { error: "None of the selected blocks can be ticked yet (their day hasn't come)." };
    const locked = pastGuard(c, ...list.map((o) => o.date));
    if (locked) return locked;
    for (const occ of list) await applyDone(c, occ, Boolean(input.done));
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Shared by move and copy: where each block lands after shifting by days and minutes. */
function shifted(list: Occurrence[], dayShift: number, minuteShift: number) {
  return list.map((o) => {
    const startAbs = timeToMinutes(o.start_time) + minuteShift;
    const start = ((startAbs % 1440) + 1440) % 1440;
    return {
      o,
      date: addDays(o.date, dayShift + Math.floor(startAbs / 1440)),
      start_time: minutesToTime(start),
      end_time: minutesToTime(start + durationOf(o.start_time, o.end_time)),
    };
  });
}

/** Alt+drag: copies of the selected blocks, shifted by days/minutes, each "only that day" (habits come with the name). */
export async function duplicateOccurrences(input: { ids: string[]; dayShift: number; minuteShift: number }): Promise<CalResult> {
  try {
    const c = await ctx();
    const dayShift = Math.trunc(Number(input.dayShift) || 0);
    const minuteShift = Math.trunc(Number(input.minuteShift) || 0);
    if (Math.abs(dayShift) > 366 || Math.abs(minuteShift) > 1440) return { error: "That copy is too far." };
    const got = await loadMany(c, input.ids);
    if ("error" in got) return { error: got.error };
    const copies = shifted(got.list, dayShift, minuteShift);
    const locked = pastGuard(c, ...copies.map((m) => m.date));
    if (locked) return locked;
    const dates = copies.map((m) => m.date).sort();
    const existing = await getOccurrences(c.sb, c.userId, dates[0], addDays(dates[dates.length - 1], 1));
    for (const m of copies) {
      const hit = findOccurrenceConflict(m, existing);
      if (hit) {
        return {
          error: `Blocks can't overlap: on ${m.date} a copy would overlap another block at ${hit.start_time.slice(0, 5)}–${hit.end_time.slice(0, 5)}.`,
        };
      }
    }
    const { error } = await c.sb.from("block_occurrences").insert(
      copies.map((m) => ({
        user_id: c.userId,
        block_type_id: m.o.block_type_id,
        slot_id: null,
        origin_date: null,
        date: m.date,
        start_time: m.start_time,
        end_time: m.end_time,
        is_override: true,
      }))
    );
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Stretch or shrink the selected blocks by the same minutes (their end moves; only those days). */
export async function resizeOccurrences(input: { ids: string[]; minuteDelta: number }): Promise<CalResult> {
  try {
    const c = await ctx();
    const delta = Math.trunc(Number(input.minuteDelta) || 0);
    if (!delta) return done();
    const got = await loadMany(c, input.ids);
    if ("error" in got) return { error: got.error };
    const locked = pastGuard(c, ...got.list.map((o) => o.date));
    if (locked) return locked;
    const resized: Occurrence[] = got.list.map((o) => {
      const dur = Math.max(15, Math.min(1440 - 5, durationOf(o.start_time, o.end_time) + delta));
      return { ...o, end_time: minutesToTime(timeToMinutes(o.start_time) + dur) };
    });
    const dates = resized.map((o) => o.date).sort();
    const selectedIds = new Set(resized.map((o) => o.id));
    const others = (await getOccurrences(c.sb, c.userId, dates[0], addDays(dates[dates.length - 1], 1))).filter(
      (o) => !selectedIds.has(o.id)
    );
    for (const r of resized) {
      const hit = findOccurrenceConflict(r, [...others, ...resized.filter((x) => x.id !== r.id)]);
      if (hit) {
        return {
          error: `Blocks can't overlap: on ${r.date} a stretched block would overlap another at ${hit.start_time.slice(0, 5)}–${hit.end_time.slice(0, 5)}.`,
        };
      }
    }
    for (const r of resized) {
      const { error } = await c.sb
        .from("block_occurrences")
        .update({ end_time: r.end_time, is_override: true })
        .eq("id", r.id)
        .eq("user_id", c.userId);
      if (error) return { error: error.message };
    }
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------- Block types (the block as a concept) --------------------------------

/** Renaming changes the name everywhere (all slots share the block type). */
export async function renameBlockType(input: { id: string; name: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const name = normalizeName(input.name ?? "");
    if (!name) return { error: "The name can't be empty." };
    const { data: same } = await c.sb
      .from("block_types")
      .select("id,name")
      .eq("user_id", c.userId)
      .is("deleted_at", null);
    const clash = ((same ?? []) as { id: string; name: string }[]).find(
      (t) => t.id !== input.id && t.name.toLowerCase() === name.toLowerCase()
    );
    if (clash) return { error: `There is already a block called "${clash.name}".` };
    const { error } = await c.sb.from("block_types").update({ name }).eq("id", input.id).eq("user_id", c.userId);
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function setBlockTypeColor(input: { id: string; color: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    if (!isColor(input.color)) return { error: "Pick a color." };
    const { error } = await c.sb
      .from("block_types")
      .update({ color: input.color })
      .eq("id", input.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Stops a block everywhere from today on. Past days keep it (and its name). */
export async function removeBlockType(input: { id: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const slots = (await getSlots(c.sb, c.userId, c.today)).filter((s) => s.block_type_id === input.id);
    for (const s of slots) await removeSlotForward(c.sb, c.userId, s, c.today);
    const { data: oneOffs } = await c.sb
      .from("block_occurrences")
      .select("id")
      .eq("user_id", c.userId)
      .eq("block_type_id", input.id)
      .gte("date", c.today)
      .neq("status", "cancelled");
    const ids = ((oneOffs ?? []) as { id: string }[]).map((o) => o.id);
    if (ids.length) {
      await c.sb.from("block_occurrences").update({ status: "cancelled" }).in("id", ids).eq("user_id", c.userId);
      await afterOccurrencesChanged(c.sb, c.userId, ids);
    }
    await c.sb
      .from("block_types")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("user_id", c.userId);
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------- Events (their own layer; may overlap blocks and each other) -------

export type EventInput = {
  id?: string;
  title: string;
  /** Name of the event type; a new name creates the type with typeColor. Empty = no type. */
  typeName?: string;
  typeColor?: string;
  date: string;
  endDate?: string;
  hasTime: boolean;
  start?: string;
  end?: string;
};

async function findOrCreateEventType(c: Awaited<ReturnType<typeof ctx>>, rawName: string, color?: string) {
  const name = normalizeName(rawName);
  if (!name) return null;
  const { data } = await c.sb.from("event_types").select("id,name").eq("user_id", c.userId).is("deleted_at", null);
  const found = ((data ?? []) as { id: string; name: string }[]).find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const { data: created, error } = await c.sb
    .from("event_types")
    .insert({ user_id: c.userId, name, color: color && isColor(color) ? color : "#64748b" })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the event type.");
  return created.id as string;
}

export async function saveEvent(input: EventInput): Promise<CalResult> {
  try {
    const c = await ctx();
    const title = (input.title ?? "").trim().slice(0, 300);
    if (!title) return { error: "Give the event a title." };
    if (!isDate(input.date)) return { error: "Pick a date." };
    let endDate = input.endDate && isDate(input.endDate) ? input.endDate : input.date;
    if (endDate < input.date) return { error: "The end date is before the start date." };
    let before: string | null = null;
    if (input.id) {
      const { data: old } = await c.sb.from("events").select("event_date").eq("id", input.id).eq("user_id", c.userId).maybeSingle();
      before = (old?.event_date as string | undefined) ?? null;
    }
    const locked = pastGuard(c, input.date, before);
    if (locked) return locked;

    let start_time: string | null = null;
    let end_time: string | null = null;
    if (input.hasTime) {
      const bad = checkTimes(input.start ?? "", input.end ?? "");
      if (bad) return { error: bad };
      const s = hhmm(input.start!);
      const e = hhmm(input.end!);
      // Same day and an end earlier than the start = ends the next day
      if (endDate === input.date && e < s) endDate = addDays(input.date, 1);
      const startAt = zonedToUtc(input.date, s, c.timezone);
      const endAt = zonedToUtc(endDate, e, c.timezone);
      if (!(endAt > startAt)) return { error: "The event must end after it starts." };
      start_time = startAt.toISOString();
      end_time = endAt.toISOString();
      if (e === "00:00" && endDate > input.date) endDate = addDays(endDate, -1);
    }

    const event_type_id = input.typeName ? await findOrCreateEventType(c, input.typeName, input.typeColor) : null;
    const values = { title, event_type_id, event_date: input.date, end_date: endDate, start_time, end_time };
    const { error } = input.id
      ? await c.sb.from("events").update(values).eq("id", input.id).eq("user_id", c.userId)
      : await c.sb.from("events").insert({ ...values, user_id: c.userId });
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function removeEvent(input: { id: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const { data: old } = await c.sb.from("events").select("event_date").eq("id", input.id).eq("user_id", c.userId).maybeSingle();
    const locked = pastGuard(c, old?.event_date as string | undefined);
    if (locked) return locked;
    const now = new Date().toISOString();
    await c.sb
      .from("entity_relations")
      .update({ deleted_at: now })
      .eq("user_id", c.userId)
      .eq("source_type", "event")
      .eq("source_id", input.id);
    const { error } = await c.sb.from("events").update({ deleted_at: now }).eq("id", input.id).eq("user_id", c.userId);
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Rename or recolor an event type (the color applies to all its events). */
export async function saveEventType(input: { id: string; name: string; color: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const name = normalizeName(input.name ?? "");
    if (!name) return { error: "The name can't be empty." };
    if (!isColor(input.color)) return { error: "Pick a color." };
    const { error } = await c.sb
      .from("event_types")
      .update({ name, color: input.color })
      .eq("id", input.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.code === "23505" ? "There is already an event type with that name." : error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function removeEventType(input: { id: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    await c.sb.from("events").update({ event_type_id: null }).eq("user_id", c.userId).eq("event_type_id", input.id);
    const { error } = await c.sb
      .from("event_types")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------- Habits (they live inside blocks) ----------------------------------

/** Mark one habit in one block occurrence. state null = clear the mark. */
export async function markHabit(input: { habitId: string; occurrenceId: string; state: HabitState | null }): Promise<CalResult> {
  try {
    const c = await ctx();
    const occ = await getOccurrence(c.sb, c.userId, input.occurrenceId);
    if (!occ) return { error: "That block is no longer on the calendar." };
    if (occ.date > c.today) return { error: "You can only mark habits once their day has come." };
    const locked = pastGuard(c, occ.date);
    if (locked) return locked;
    const { data: habit } = await c.sb
      .from("habits")
      .select("id")
      .eq("id", input.habitId)
      .eq("user_id", c.userId)
      .maybeSingle();
    if (!habit) return { error: "That habit no longer exists." };
    if (input.state !== null && !["done", "skipped", "missed"].includes(input.state)) return { error: "Unknown mark." };
    const { error } = await setHabitCheck(c.sb, c.userId, input.habitId, occ, input.state, "web");
    if (error) return { error: error.message };
    await recomputeOccurrenceStatus(c.sb, c.userId, occ.id, c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Ticks every habit of a block and marks it done (makeDone), or clears them and reopens it. */
async function applyDone(c: Awaited<ReturnType<typeof ctx>>, occ: Occurrence, makeDone: boolean) {
  const [habits, checks] = await Promise.all([
    getHabits(c.sb, c.userId, { includeRemoved: true }),
    getChecks(c.sb, c.userId, occ.date, occ.date),
  ]);
  const list = habitsForOccurrence(occ, habits, checks, c.today);
  for (const { habit, state } of list) {
    if (!makeDone && state === "done") await setHabitCheck(c.sb, c.userId, habit.id, occ, null, "web");
    if (makeDone && state !== "done") await setHabitCheck(c.sb, c.userId, habit.id, occ, "done", "web");
  }
  await c.sb
    .from("block_occurrences")
    .update({ status: makeDone ? "done" : "scheduled" })
    .eq("id", occ.id)
    .eq("user_id", c.userId);
  await recomputeOccurrenceStatus(c.sb, c.userId, occ.id, c.today);
}

/** The quick ✓ on a block: marks all its habits done (or undoes it if the block was already done). */
export async function toggleOccurrenceDone(input: { occurrenceId: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const occ = await getOccurrence(c.sb, c.userId, input.occurrenceId);
    if (!occ) return { error: "That block is no longer on the calendar." };
    if (occ.date > c.today) return { error: "You can only tick a block once its day has come." };
    const locked = pastGuard(c, occ.date);
    if (locked) return locked;
    if (occ.status === "free_day" || occ.status === "cancelled") return { error: "This block is not active that day." };
    await applyDone(c, occ, occ.status !== "done");
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** New habit inside a block (from today on). Without a block it waits in "Unscheduled". */
export async function createHabit(input: { name: string; blockTypeId: string | null }): Promise<CalResult> {
  try {
    const c = await ctx();
    const name = normalizeName(input.name ?? "");
    if (!name) return { error: "Give the habit a name." };
    const { error } = await c.sb.from("habits").insert({
      user_id: c.userId,
      name,
      block_type_id: input.blockTypeId || null,
      active_from: c.today,
    });
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Rename a habit or move it to another block (or to "Unscheduled"). Past marks stay where they were. */
export async function updateHabit(input: { id: string; name?: string; blockTypeId?: string | null }): Promise<CalResult> {
  try {
    const c = await ctx();
    const values: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = normalizeName(input.name);
      if (!name) return { error: "The name can't be empty." };
      values.name = name;
    }
    if (input.blockTypeId !== undefined) {
      values.block_type_id = input.blockTypeId || null;
      values.active_from = c.today;
    }
    const { error } = await c.sb.from("habits").update(values).eq("id", input.id).eq("user_id", c.userId);
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Stop tracking a habit. Its past marks are kept. */
export async function removeHabit(input: { id: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const { error } = await c.sb
      .from("habits")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------- Tasks: home block, placement, morning ritual -------------------------

/**
 * Put a task in a block appearance or an event (or take it out: both null = unassigned).
 * Same day = just placing it. Another day = a manual move: the moved counter goes up by 1.
 */
export async function placeTask(input: {
  taskId: string;
  occurrenceId?: string | null;
  eventId?: string | null;
  date?: string;
}): Promise<CalResult> {
  try {
    const c = await ctx();
    const task = await getTask(c.sb, c.userId, input.taskId);
    if (!task) return { error: "That task no longer exists." };
    let date = input.date && isDate(input.date) ? input.date : task.scheduled_for ?? c.today;
    let occurrence_id: string | null = null;
    let event_id: string | null = null;
    if (input.occurrenceId) {
      const occ = await getOccurrence(c.sb, c.userId, input.occurrenceId);
      if (!occ || occ.status === "cancelled") return { error: "That block is no longer on the calendar." };
      occurrence_id = occ.id;
      date = occ.date;
    } else if (input.eventId) {
      const { data: ev } = await c.sb
        .from("events")
        .select("id,event_date,end_date")
        .eq("id", input.eventId)
        .eq("user_id", c.userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!ev) return { error: "That event no longer exists." };
      event_id = ev.id as string;
      if (date < (ev.event_date as string) || date > (ev.end_date as string)) date = ev.event_date as string;
    }
    if (date < c.today && task.status === "pending") return { error: "Pending tasks can only be placed today or later." };
    const movedDay = Boolean(task.scheduled_for && task.scheduled_for !== date && task.scheduled_for >= c.today);
    const { error } = await c.sb
      .from("tasks")
      .update({
        occurrence_id,
        event_id,
        scheduled_for: date,
        hold_placement: false,
        status: task.status === "backlog" ? "pending" : task.status,
      })
      .eq("id", task.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    if (movedDay) await countMove(c.sb, c.userId, task, task.scheduled_for);
    if (task.occurrence_id) await recomputeOccurrenceStatus(c.sb, c.userId, task.occurrence_id, c.today);
    if (occurrence_id) await recomputeOccurrenceStatus(c.sb, c.userId, occurrence_id, c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Morning ritual option: move the task to the next appearance of its home block (counts as a move). */
export async function moveTaskToNextHome(input: { taskId: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const task = await getTask(c.sb, c.userId, input.taskId);
    if (!task) return { error: "That task no longer exists." };
    if (!task.home_block_type_id) return { error: "This task has no home block." };
    const next = await nextOccurrenceAfter(c.sb, c.userId, task.home_block_type_id, c.today);
    if (!next) return { error: "Its home block is not on the calendar in the next 8 weeks." };
    const { error } = await c.sb
      .from("tasks")
      .update({ occurrence_id: next.id, event_id: null, scheduled_for: next.date, status: "pending" })
      .eq("id", task.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    await countMove(c.sb, c.userId, task, task.scheduled_for && task.scheduled_for >= c.today ? task.scheduled_for : c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Set (or clear) a task's home block. If that block is on the task's day, it goes straight in. */
export async function setTaskHome(input: { taskId: string; blockTypeId: string | null }): Promise<CalResult> {
  try {
    const c = await ctx();
    const { error } = await c.sb
      .from("tasks")
      .update({ home_block_type_id: input.blockTypeId || null })
      .eq("id", input.taskId)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    await autoPlaceTasks(c.sb, c.userId, c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Tick or untick a task. Done in one appearance of a block = done in all of them. */
export async function setTaskDone(input: { taskId: string; done: boolean }): Promise<CalResult> {
  try {
    const c = await ctx();
    const task = await getTask(c.sb, c.userId, input.taskId);
    if (!task) return { error: "That task no longer exists." };
    const locked = pastGuard(c, task.scheduled_for);
    if (locked) return locked;
    const { error } = await c.sb
      .from("tasks")
      .update({
        status: input.done ? "completed" : "pending",
        completed_at: input.done ? new Date().toISOString() : null,
      })
      .eq("id", task.id)
      .eq("user_id", c.userId);
    if (error) return { error: error.message };
    if (task.occurrence_id) await recomputeOccurrenceStatus(c.sb, c.userId, task.occurrence_id, c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Quick add from a block or an event: the task is placed there (and the block becomes its home). */
export async function addTaskHere(input: {
  title: string;
  occurrenceId?: string;
  eventId?: string;
  date?: string;
}): Promise<CalResult> {
  try {
    const c = await ctx();
    const title = (input.title ?? "").trim().slice(0, 300);
    if (!title) return { error: "Write the task first." };
    let values: Record<string, unknown> = { user_id: c.userId, title, status: "pending", scheduled_for: input.date || c.today };
    if (input.occurrenceId) {
      const occ = await getOccurrence(c.sb, c.userId, input.occurrenceId);
      if (!occ) return { error: "That block is no longer on the calendar." };
      values = { ...values, occurrence_id: occ.id, home_block_type_id: occ.block_type_id, scheduled_for: occ.date };
    } else if (input.eventId) {
      values = { ...values, event_id: input.eventId };
    }
    if (String(values.scheduled_for) < c.today) return { error: "New tasks go on today or later." };
    const { error } = await c.sb.from("tasks").insert(values);
    if (error) return { error: error.message };
    if (input.occurrenceId) await recomputeOccurrenceStatus(c.sb, c.userId, input.occurrenceId, c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** "Done" on the morning ritual card: hide it until tomorrow. */
export async function dismissRitual(): Promise<CalResult> {
  try {
    const c = await ctx();
    await c.sb.from("user_settings").update({ ritual_seen_on: c.today }).eq("user_id", c.userId);
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------- Free days ------------------------------------------------------------

/** Mark one day or a range as free (trip, holiday). Events stay visible. */
export async function createFreeDays(input: {
  from: string;
  to?: string;
  policy: FreeDayPolicy;
  note?: string;
}): Promise<CalResult> {
  try {
    const c = await ctx();
    if (!isDate(input.from)) return { error: "Pick the first free day." };
    const locked = pastGuard(c, input.from);
    if (locked) return locked;
    const to = input.to && isDate(input.to) ? input.to : input.from;
    if (to < input.from) return { error: "The last day is before the first one." };
    const policy: FreeDayPolicy = ["move_next", "unassigned", "home_block"].includes(input.policy) ? input.policy : "move_next";
    const { data: overlap } = await c.sb
      .from("free_days")
      .select("id")
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .lte("from_date", to)
      .gte("to_date", input.from)
      .limit(1);
    if (overlap?.length) return { error: "Some of those days are already free. Remove that range first." };
    const { error } = await c.sb.from("free_days").insert({
      user_id: c.userId,
      from_date: input.from,
      to_date: to,
      task_policy: policy,
      note: (input.note ?? "").trim().slice(0, 200) || null,
    });
    if (error) return { error: error.message };
    await applyFreeDays(c.sb, c.userId, input.from, to, policy, c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function removeFreeDays(input: { id: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const { data: f } = await c.sb
      .from("free_days")
      .select("id,from_date,to_date")
      .eq("id", input.id)
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!f) return { error: "That free day was already removed." };
    await c.sb.from("free_days").update({ deleted_at: new Date().toISOString() }).eq("id", f.id).eq("user_id", c.userId);
    await undoFreeDays(c.sb, c.userId, f.from_date as string, f.to_date as string, c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

// ---------- Payments (events with a pre-filled transaction) ------------------------

export type PaymentInput = {
  name: string;
  type?: "income" | "expense";
  expectedAmount?: string;
  accountId?: string;
  categoryId?: string;
  startDate: string;
  repeatUnit: RepeatUnit;
  repeatEvery?: number;
  endDate?: string;
};

function money(v: string | undefined) {
  const s = String(v ?? "").trim().replace(/[$\s]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** Same record whether it is created from Finance or from the calendar: a template + its events. */
export async function createPayment(input: PaymentInput): Promise<CalResult> {
  try {
    const c = await ctx();
    const name = normalizeName(input.name ?? "");
    if (!name) return { error: "Name the payment (e.g. Rent, Internet)." };
    if (!isDate(input.startDate)) return { error: "Pick the (first) date." };
    const expected = money(input.expectedAmount);
    if (Number.isNaN(expected) || (expected !== null && expected <= 0)) return { error: "The expected amount must be a number above 0." };
    const unit: RepeatUnit = ["none", "days", "weeks", "months", "years"].includes(input.repeatUnit) ? input.repeatUnit : "none";
    const every = Math.min(366, Math.max(1, Math.floor(Number(input.repeatEvery) || 1)));
    const end = input.endDate && isDate(input.endDate) ? input.endDate : null;
    if (end && end < input.startDate) return { error: "The end date is before the first date." };
    const { data: t, error } = await c.sb
      .from("payment_templates")
      .insert({
        user_id: c.userId,
        name,
        type: input.type === "income" ? "income" : "expense",
        expected_amount: expected,
        account_id: input.accountId || null,
        category_id: input.categoryId || null,
        repeat_unit: unit,
        repeat_every: every,
        start_date: input.startDate,
        end_date: end,
      })
      .select("id")
      .single();
    if (error || !t) return { error: error?.message ?? "Could not save the payment." };
    // Its events: from the first date (even if it's in the past) up to ~2 months ahead
    await ensurePaymentEvents(c.sb, c.userId, c.today, t.id as string, input.startDate < c.today ? input.startDate : c.today);
    revalidatePath("/finance");
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Stop a payment: no new events; upcoming unpaid ones are removed. Paid ones stay. */
export async function stopPaymentTemplate(input: { id: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const now = new Date().toISOString();
    await c.sb.from("payment_templates").update({ deleted_at: now }).eq("id", input.id).eq("user_id", c.userId);
    await c.sb
      .from("events")
      .update({ deleted_at: now })
      .eq("user_id", c.userId)
      .eq("payment_template_id", input.id)
      .is("payment_status", null)
      .gt("event_date", c.today);
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** The draft of the day: you write the real amount and confirm. Creates the real transaction. */
export async function confirmPayment(input: {
  eventId: string;
  amount: string;
  accountId?: string;
  categoryId?: string;
  date?: string;
  description?: string;
  /** Already paid: the user saw the warning and wants another transaction anyway. */
  again?: boolean;
}): Promise<CalResult> {
  try {
    const c = await ctx();
    const { data: ev } = await c.sb
      .from("events")
      .select("id,title,event_date,is_payment,payment_status,payment_template_id")
      .eq("id", input.eventId)
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!ev || !ev.is_payment) return { error: "That payment no longer exists." };
    if (ev.payment_status === "paid" && !input.again) {
      return { error: "This payment is already marked as paid. Confirm to record another transaction.", code: "ALREADY_PAID" };
    }
    const amount = money(input.amount);
    if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "Write the real amount (above 0)." };
    const date = input.date && isDate(input.date) ? input.date : (ev.event_date as string);
    if (date > c.today) return { error: "You can confirm a payment on its day or later." };
    let type: "income" | "expense" = "expense";
    if (ev.payment_template_id) {
      const { data: t } = await c.sb
        .from("payment_templates")
        .select("type")
        .eq("id", ev.payment_template_id)
        .eq("user_id", c.userId)
        .maybeSingle();
      if (t?.type === "income") type = "income";
    }
    const { data: txn, error } = await c.sb
      .from("transactions")
      .insert({
        user_id: c.userId,
        type,
        amount,
        description: (input.description ?? "").trim() || (ev.title as string),
        account_id: input.accountId || null,
        category_id: input.categoryId || null,
        occurred_at: date === c.today ? new Date().toISOString() : zonedToUtc(date, "12:00", c.timezone).toISOString(),
        event_id: ev.id,
        payment_template_id: ev.payment_template_id,
      })
      .select("id")
      .single();
    if (error || !txn) return { error: error?.message ?? "Could not save the transaction." };
    await c.sb
      .from("events")
      .update({ payment_status: "paid", payment_transaction_id: txn.id })
      .eq("id", ev.id)
      .eq("user_id", c.userId);
    revalidatePath("/finance");
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Not paying this one (e.g. waived this month). */
export async function skipPayment(input: { eventId: string }): Promise<CalResult> {
  try {
    const c = await ctx();
    const { error } = await c.sb
      .from("events")
      .update({ payment_status: "skipped" })
      .eq("id", input.eventId)
      .eq("user_id", c.userId)
      .eq("is_payment", true);
    if (error) return { error: error.message };
    return done();
  } catch (e) {
    return fail(e);
  }
}
