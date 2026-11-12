// Alarms for the Android app (pure logic + one loader). A block type with `alarm_minutes_before`
// rings that many minutes before each of its upcoming occurrences. The phone app asks for the next
// days, sets real alarms, and replaces them all on every sync.
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, localNow, zonedToUtc } from "@/lib/time";
import { blockNotesByKey, noteKey } from "@/lib/block-notes";
import { getBlockTypes, getOccurrences } from "@/lib/calendar/model";
import type { BlockType, Occurrence } from "@/lib/calendar/types";

export const ALARM_DAYS = 7;

/** One alarm for the phone. Times are epoch milliseconds so the app needs no date parsing. */
export type PhoneAlarm = {
  id: string; // occurrence id: a moved or resized block keeps it
  title: string;
  date: string; // YYYY-MM-DD of the block's start
  start: string; // HH:MM
  end: string; // HH:MM
  startsAtMs: number;
  alarmAtMs: number;
  minutesBefore: number;
  note: string;
};

export function generateAlarmKey() {
  return `pos_${randomBytes(24).toString("base64url")}`;
}

export function hashAlarmKey(key: string) {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** First lines of a block note as plain text for the alarm screen. */
export function noteSnippet(content: string | undefined | null, max = 240) {
  const text = (content ?? "")
    .replace(/^\s*[-*]\s+\[( |x|X)\]\s*/gm, "• ")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Alarms that still lie ahead (from `now`) within `days` days. Cancelled, paused (free day) and
 * already-done blocks never ring. Sorted by alarm time.
 */
export function buildAlarms(args: {
  occurrences: Pick<Occurrence, "id" | "block_type_id" | "date" | "start_time" | "end_time" | "status">[];
  types: (Pick<BlockType, "id" | "name"> & { alarm_minutes_before?: number | null })[];
  notes: Map<string, string>;
  timezone: string;
  now: Date;
  days?: number;
}): PhoneAlarm[] {
  const byId = new Map(args.types.map((t) => [t.id, t]));
  const limit = args.now.getTime() + (args.days ?? ALARM_DAYS) * 86_400_000;
  const out: PhoneAlarm[] = [];
  for (const o of args.occurrences) {
    if (o.status === "cancelled" || o.status === "free_day" || o.status === "done") continue;
    const t = byId.get(o.block_type_id);
    const minutes = t?.alarm_minutes_before;
    if (!t || minutes === null || minutes === undefined) continue;
    const start = o.start_time.slice(0, 5);
    const startsAtMs = zonedToUtc(o.date, start, args.timezone).getTime();
    const alarmAtMs = startsAtMs - minutes * 60_000;
    if (alarmAtMs <= args.now.getTime() || alarmAtMs > limit) continue;
    out.push({
      id: o.id,
      title: t.name,
      date: o.date,
      start,
      end: o.end_time.slice(0, 5),
      startsAtMs,
      alarmAtMs,
      minutesBefore: minutes,
      note: args.notes.get(noteKey(t.name)) ?? "",
    });
  }
  return out.sort((a, b) => a.alarmAtMs - b.alarmAtMs);
}

/** Loads one user's upcoming alarms. Works with the admin client (the phone has no browser session). */
export async function loadAlarms(sb: SupabaseClient, userId: string, timezone: string, now = new Date()) {
  const today = localNow(timezone).date;
  const [types, occurrences, notes] = await Promise.all([
    getBlockTypes(sb, userId),
    getOccurrences(sb, userId, today, addDays(today, ALARM_DAYS + 1)),
    blockNotesByKey(sb, userId),
  ]);
  const noteText = new Map([...notes].map(([k, n]) => [k, noteSnippet(n.content)]));
  return buildAlarms({ occurrences, types, notes: noteText, timezone, now });
}
