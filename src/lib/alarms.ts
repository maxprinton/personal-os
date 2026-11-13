// Alarms for the Android app (pure logic + one loader). A block type has alarm rules (rings anchored to
// the start or the end of the block, see alarm-rules.ts) or, in the old way, `alarm_minutes_before`.
// Every ring of a chain (the first one and its repeats) becomes one entry for the phone. The phone app
// asks for the next days, sets real alarms, and replaces them all on every sync.
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, localNow, zonedToUtc } from "@/lib/time";
import { blockNotesByKey, noteKey } from "@/lib/block-notes";
import { getBlockTypes, getOccurrences } from "@/lib/calendar/model";
import { effectiveRules, hasAlarm, levelOf, soundOf } from "@/lib/alarm-rules";
import { getChecks, getHabits } from "@/lib/calendar/habits";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import { getCalendarTasks } from "@/lib/calendar/tasks";
import { tasksForOccurrence } from "@/lib/calendar/taskview";
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
  endsAtMs: number;
  alarmAtMs: number;
  /** Old field kept for older app versions: minutes before the start (0 when the ring is later). */
  minutesBefore: number;
  note: string;
  /** Same for every ring of one chain on one block: "I'm up" on the phone cancels the rest of it. */
  chain: string;
  /** Position in the chain (0 = first ring) and how many rings the chain has in total. */
  seq: number;
  total: number;
  anchor: "start" | "end";
  /** "default" (the sound chosen in the phone app) or the id of a bundled sound. */
  sound: string;
  style: "alarm" | "notify";
  /** 0 normal, 1 louder, 2+ full volume at once. */
  level: number;
  /** Minutes between the rings of this chain (0 when it has one ring). */
  every: number;
  /** Names of the block's habits still to do, in the user's order. */
  habits: string[];
  /** Titles of the pending tasks placed in the block that day. */
  tasks: string[];
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
 * Rings that still lie ahead (from `now`) within `days` days. Cancelled, paused (free day) and
 * already-done blocks never ring. A ring of the start that would ring after the block ended is dropped.
 * Sorted by alarm time.
 */
export function buildAlarms(args: {
  occurrences: Pick<Occurrence, "id" | "block_type_id" | "date" | "start_time" | "end_time" | "status">[];
  types: (Pick<BlockType, "id" | "name"> & { alarm_minutes_before?: number | null; alarm_rules?: unknown })[];
  notes: Map<string, string>;
  /** occurrence id -> habit names / task titles (optional) */
  habits?: Map<string, string[]>;
  tasks?: Map<string, string[]>;
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
    const rings = t ? effectiveRules(t) : [];
    if (!t || rings.length === 0) continue;
    const start = o.start_time.slice(0, 5);
    const end = o.end_time.slice(0, 5);
    const startsAtMs = zonedToUtc(o.date, start, args.timezone).getTime();
    // A block that ends before it starts ends the next day
    const endDate = end < start ? addDays(o.date, 1) : o.date;
    const endsAtMs = zonedToUtc(endDate, end, args.timezone).getTime();
    rings.forEach((r, ringIdx) => {
      const base = (r.anchor === "start" ? startsAtMs : endsAtMs) + r.offset * 60_000;
      const chain = `${o.id}|${ringIdx}|${base}`;
      // Every time of the chain, except those after the block ended (for rings of the start)
      const times: number[] = [];
      for (let k = 0; k <= r.repeats; k++) {
        const at = base + k * r.every * 60_000;
        if (k > 0 && r.anchor === "start" && at >= endsAtMs) break;
        times.push(at);
      }
      times.forEach((at, k) => {
        if (at <= args.now.getTime() || at > limit) return;
        out.push({
          id: `${o.id}.${ringIdx}.${k}`,
          title: t.name,
          date: o.date,
          start,
          end,
          startsAtMs,
          endsAtMs,
          alarmAtMs: at,
          minutesBefore: Math.max(0, Math.round((startsAtMs - at) / 60_000)),
          note: args.notes.get(noteKey(t.name)) ?? "",
          habits: args.habits?.get(o.id) ?? [],
          tasks: args.tasks?.get(o.id) ?? [],
          chain,
          seq: k,
          total: times.length,
          anchor: r.anchor,
          sound: soundOf(r, k),
          style: r.style,
          level: levelOf(r, k),
          every: times.length > 1 ? r.every : 0,
        });
      });
    });
  }
  return out.sort((a, b) => a.alarmAtMs - b.alarmAtMs || a.id.localeCompare(b.id));
}

/** Loads one user's upcoming alarms. Works with the admin client (the phone has no browser session). */
export async function loadAlarms(sb: SupabaseClient, userId: string, timezone: string, now = new Date()) {
  const today = localNow(timezone).date;
  const to = addDays(today, ALARM_DAYS + 1);
  const [types, occurrences, notes, allHabits, checks, { tasks: allTasks }] = await Promise.all([
    getBlockTypes(sb, userId),
    getOccurrences(sb, userId, today, to),
    blockNotesByKey(sb, userId),
    getHabits(sb, userId),
    getChecks(sb, userId, addDays(today, -1), to),
    getCalendarTasks(sb, userId, today, to, today),
  ]);
  const noteText = new Map([...notes].map(([k, n]) => [k, noteSnippet(n.content)]));
  const alarmTypes = new Set(types.filter((t) => hasAlarm(t)).map((t) => t.id));
  const habits = new Map<string, string[]>();
  const tasks = new Map<string, string[]>();
  for (const o of occurrences) {
    if (!alarmTypes.has(o.block_type_id)) continue;
    habits.set(
      o.id,
      habitsForOccurrence(o, allHabits, checks, today)
        .filter((h) => h.state !== "done" && h.state !== "skipped")
        .map((h) => h.habit.name)
    );
    tasks.set(
      o.id,
      tasksForOccurrence(o, occurrences, allTasks)
        .filter((t) => t.status === "pending")
        .map((t) => t.title)
    );
  }
  return buildAlarms({ occurrences, types, notes: noteText, habits, tasks, timezone, now });
}
