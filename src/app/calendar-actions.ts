"use server";

// Calendar v2 server actions. Called directly from the calendar panel (client components).
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { addDays, isDate, isTime, isoWeekday, localNow, zonedToUtc } from "@/lib/time";
import { ensureOccurrences, getOccurrence, getSlots } from "@/lib/calendar/model";
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
import type { CalResult, EditScope } from "@/lib/calendar/types";

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  const timezone = await userTimezone(sb, user.id);
  return { sb, userId: user.id, timezone, today: localNow(timezone).date };
}

function done(): CalResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

function fail(e: unknown): CalResult {
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
    if (input.date !== occ.date) await afterOccurrencesChanged(c.sb, c.userId, [occ.id]);
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
