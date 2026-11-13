// What the phone tells Personal OS: every ring and every answer on the alarm screen.
// Pure helpers (validation, the rings-to-answer score) plus applyAlarmEvents, which records each event in
// alarm_events and makes it count: block status, habit marks, wake-up time, bedtime, the morning check-in.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, localNow, utcToLocal } from "@/lib/time";
import { sleepSlot } from "@/lib/daily-facts";
import { getOccurrence } from "@/lib/calendar/model";
import { getChecks, getHabits, recomputeOccurrenceStatus, setHabitCheck } from "@/lib/calendar/habits";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import type { HabitState, Occurrence } from "@/lib/calendar/types";

/** Answers of a ring of the START of a block. */
export const START_ANSWERS = ["started", "skip", "already_done"] as const;
/** Answers of a ring of the END of a block. */
export const END_ANSWERS = ["done", "partial", "not_done"] as const;
/** Answers that only silence the ring (the block is untouched). */
export const QUIET_ANSWERS = ["silence", "snooze", "dismiss", "missed"] as const;
export type AlarmAnswer = (typeof START_ANSWERS)[number] | (typeof END_ANSWERS)[number] | (typeof QUIET_ANSWERS)[number];
const ANSWERS = new Set<string>([...START_ANSWERS, ...END_ANSWERS, ...QUIET_ANSWERS]);

export type AlarmEvent = {
  clientId: string;
  kind: "rang" | "answer" | "checkin" | "tick" | "sleep";
  /** When it happened on the phone (epoch ms). */
  at: number;
  answer?: AlarmAnswer;
  occurrenceId?: string;
  blockTypeId?: string;
  chain?: string;
  seq?: number;
  total?: number;
  anchor?: "start" | "end";
  style?: "alarm" | "notify";
  alarmAt?: number;
  /** The ring was the wake chain ("I'm up" = wake-up time). */
  wake?: boolean;
  /** The ring was the start of an overnight block (its answer is the bedtime if "Going to sleep" is never tapped). */
  bed?: boolean;
  /** tick: a habit or a task of the block, done or not. */
  habitId?: string;
  taskId?: string;
  done?: boolean;
  /** checkin: the day (the wake ring's date) and the answers. */
  date?: string;
  mood?: number;
  energy?: number;
  sleepQuality?: number;
  highlight?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;

function str(v: unknown, max = 200) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function int(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  return r >= min && r <= max ? r : undefined;
}
function uuid(v: unknown) {
  const s = str(v, 40);
  return UUID.test(s) ? s : undefined;
}

/**
 * One event from the phone, checked field by field. Returns null when it can't be used
 * (no id, unknown kind, a time far from now, an answer that doesn't exist...).
 */
export function cleanAlarmEvent(raw: unknown, nowMs: number): AlarmEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clientId = str(r.clientId, 80);
  const kind = r.kind;
  if (!clientId || (kind !== "rang" && kind !== "answer" && kind !== "checkin" && kind !== "tick" && kind !== "sleep")) return null;
  const at = int(r.at, 0, Number.MAX_SAFE_INTEGER);
  // A queue on the phone may send a few days late, never from the future
  if (at === undefined || at > nowMs + 10 * 60_000 || at < nowMs - 8 * DAY) return null;
  const ev: AlarmEvent = { clientId, kind, at };
  const occ = uuid(r.occurrenceId);
  if (occ) ev.occurrenceId = occ;
  const type = uuid(r.blockTypeId);
  if (type) ev.blockTypeId = type;
  const chain = str(r.chain, 120);
  if (chain) ev.chain = chain;
  const seq = int(r.seq, 0, 50);
  if (seq !== undefined) ev.seq = seq;
  const total = int(r.total, 1, 50);
  if (total !== undefined) ev.total = total;
  if (r.anchor === "start" || r.anchor === "end") ev.anchor = r.anchor;
  if (r.style === "alarm" || r.style === "notify") ev.style = r.style;
  const alarmAt = int(r.alarmAt, 0, Number.MAX_SAFE_INTEGER);
  if (alarmAt !== undefined) ev.alarmAt = alarmAt;
  if (r.wake === true) ev.wake = true;
  if (r.bed === true) ev.bed = true;

  if (kind === "answer") {
    if (typeof r.answer !== "string" || !ANSWERS.has(r.answer)) return null;
    ev.answer = r.answer as AlarmAnswer;
  }
  if (kind === "tick") {
    const habitId = uuid(r.habitId);
    const taskId = uuid(r.taskId);
    if (!habitId && !taskId) return null;
    if (habitId) {
      if (!ev.occurrenceId) return null; // a habit mark belongs to one appearance of its block
      ev.habitId = habitId;
    }
    if (taskId) ev.taskId = taskId;
    ev.done = r.done !== false;
  }
  if (kind === "checkin") {
    const date = str(r.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    ev.date = date;
    ev.mood = int(r.mood, 1, 10);
    ev.energy = int(r.energy, 1, 10);
    ev.sleepQuality = int(r.sleepQuality, 1, 5);
    const hl = str(r.highlight, 280);
    if (hl) ev.highlight = hl;
    if (ev.mood === undefined && ev.energy === undefined && ev.sleepQuality === undefined && !ev.highlight) return null;
  }
  return ev;
}

/** The habit mark an answer leaves on the block's habits that are not marked yet (null = none). */
export function habitMarkFor(answer: AlarmAnswer | undefined): HabitState | null {
  if (answer === "done" || answer === "already_done") return "done";
  if (answer === "skip") return "skipped";
  if (answer === "not_done") return "missed";
  return null;
}

export type RingRow = { chain: string | null; kind: string; answer: string | null; seq: number | null; block_type_id: string | null; at: string };

/**
 * Rings it took to answer, per block: for every chain that got a real answer (not just Silence),
 * the position of that ring + 1 (1 = answered at the first ring). Averaged per block.
 */
export function ringsToAnswer(rows: RingRow[]) {
  const quiet = new Set<string>(QUIET_ANSWERS);
  const firstAnswer = new Map<string, { type: string; rings: number }>();
  const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at));
  for (const r of sorted) {
    if (r.kind !== "answer" || !r.chain || !r.block_type_id || !r.answer || quiet.has(r.answer)) continue;
    if (firstAnswer.has(r.chain)) continue;
    firstAnswer.set(r.chain, { type: r.block_type_id, rings: (r.seq ?? 0) + 1 });
  }
  const byType = new Map<string, { sum: number; n: number }>();
  for (const { type, rings } of firstAnswer.values()) {
    const cur = byType.get(type) ?? { sum: 0, n: 0 };
    cur.sum += rings;
    cur.n += 1;
    byType.set(type, cur);
  }
  return new Map([...byType].map(([type, { sum, n }]) => [type, { average: Math.round((sum / n) * 10) / 10, chains: n }]));
}

// ---- Applying the events -------------------------------------------------------------------------------

type Result = { clientId: string; ok: boolean; message?: string };

/** Writes typed inputs on one day's row, making the row first if the nightly job hasn't yet. */
async function setFacts(admin: SupabaseClient, userId: string, date: string, patch: Record<string, unknown>) {
  const upd = await admin.from("daily_facts").update(patch).eq("user_id", userId).eq("date", date).select("date");
  if (upd.error) return upd.error.message;
  if (upd.data?.length) return null;
  await admin.rpc("refresh_daily_facts", { p_user: userId, p_from: date, p_to: date });
  const again = await admin.from("daily_facts").update(patch).eq("user_id", userId).eq("date", date).select("date");
  if (again.error) return again.error.message;
  return again.data?.length ? null : "No row for that day yet.";
}

/** Mood / Energy are also metrics (what the Today widget and Telegram "mood 7" read). */
async function setMetric(admin: SupabaseClient, userId: string, name: "Mood" | "Energy", date: string, value: number) {
  let { data: def } = await admin
    .from("metric_definitions")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", name)
    .is("deleted_at", null)
    .maybeSingle();
  if (!def) {
    const ins = await admin
      .from("metric_definitions")
      .insert({ user_id: userId, name, unit: "1-10", min_value: 1, max_value: 10 })
      .select("id")
      .single();
    def = ins.data;
  }
  if (!def) return;
  const { data: existing } = await admin
    .from("daily_metrics")
    .select("id")
    .eq("user_id", userId)
    .eq("metric_id", def.id)
    .eq("log_date", date)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) await admin.from("daily_metrics").update({ value }).eq("id", existing.id);
  else await admin.from("daily_metrics").insert({ user_id: userId, metric_id: def.id, log_date: date, value });
}

/** Marks the block's habits that have no mark yet, then sets its status. */
async function closeBlock(admin: SupabaseClient, userId: string, occ: Occurrence, answer: AlarmAnswer, today: string) {
  const mark = habitMarkFor(answer);
  if (mark) {
    const [habits, checks] = await Promise.all([getHabits(admin, userId, { includeRemoved: true }), getChecks(admin, userId, occ.date, occ.date)]);
    for (const { habit, state } of habitsForOccurrence(occ, habits, checks, today)) {
      if (state === null || (mark === "done" && state !== "done")) await setHabitCheck(admin, userId, habit.id, occ, mark, "auto");
    }
  }
  if (answer === "done" || answer === "already_done") {
    const r = await admin.from("block_occurrences").update({ status: "done", done_manually: true }).eq("id", occ.id).eq("user_id", userId);
    if (r.error) await admin.from("block_occurrences").update({ status: "done" }).eq("id", occ.id).eq("user_id", userId);
    return;
  }
  if (answer === "partial") {
    await admin.from("block_occurrences").update({ status: "partial", done_manually: false }).eq("id", occ.id).eq("user_id", userId);
    return;
  }
  // Skip / Didn't do it: the block stays planned and not done; its habits now say why
  await recomputeOccurrenceStatus(admin, userId, occ.id, today);
}

async function applyOne(admin: SupabaseClient, userId: string, tz: string, ev: AlarmEvent, today: string): Promise<string | null> {
  const local = utcToLocal(new Date(ev.at).toISOString(), tz);

  if (ev.kind === "sleep") {
    // "Going to sleep": the bedtime of the night (on the row of the day you wake up)
    const slot = sleepSlot(local, null);
    return setFacts(admin, userId, slot.rowDate, { bedtime: new Date(ev.at).toISOString() });
  }

  if (ev.kind === "checkin") {
    const date = ev.date!;
    if (date > addDays(today, 1) || date < addDays(today, -6)) return "That day is too far back.";
    const patch: Record<string, unknown> = {};
    if (ev.mood !== undefined) {
      await setMetric(admin, userId, "Mood", date, ev.mood);
      patch.mood = ev.mood;
    }
    if (ev.energy !== undefined) {
      await setMetric(admin, userId, "Energy", date, ev.energy);
      patch.energy = ev.energy;
    }
    if (ev.sleepQuality !== undefined) patch.sleep_quality = ev.sleepQuality;
    let error = Object.keys(patch).length ? await setFacts(admin, userId, date, patch) : null;
    // Yesterday's highlight lives on yesterday's row
    if (ev.highlight) error = (await setFacts(admin, userId, addDays(date, -1), { highlight: ev.highlight })) ?? error;
    return error;
  }

  if (ev.kind === "tick") {
    if (ev.taskId) {
      const r = await admin
        .from("tasks")
        .update(ev.done ? { status: "completed", completed_at: new Date(ev.at).toISOString() } : { status: "pending", completed_at: null })
        .eq("id", ev.taskId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .select("occurrence_id");
      if (r.error) return r.error.message;
      const occId = (r.data?.[0] as { occurrence_id?: string | null } | undefined)?.occurrence_id;
      if (occId) await recomputeOccurrenceStatus(admin, userId, occId, today);
      return null;
    }
    const occ = await getOccurrence(admin, userId, ev.occurrenceId!);
    if (!occ) return "That block is no longer on the calendar.";
    if (occ.date > today) return "Habits can be ticked once their day has come.";
    const r = await setHabitCheck(admin, userId, ev.habitId!, occ, ev.done ? "done" : null, "auto");
    if (r.error) return r.error.message;
    if (!ev.done && occ.status === "done") {
      await admin.from("block_occurrences").update({ done_manually: false }).eq("id", occ.id).eq("user_id", userId);
    }
    await recomputeOccurrenceStatus(admin, userId, occ.id, today);
    return null;
  }

  if (ev.kind === "answer" && ev.occurrenceId) {
    const occ = await getOccurrence(admin, userId, ev.occurrenceId);
    if (!occ) return null; // the block was removed meanwhile: the answer is still recorded
    if (occ.status === "cancelled" || occ.status === "free_day") return null;
    const answer = ev.answer;
    if (answer === "started" && ev.wake) {
      // "I'm up" on the wake chain = this morning's wake-up time
      return setFacts(admin, userId, local.date, { wake_at: new Date(ev.at).toISOString() });
    }
    if (answer === "started" && ev.bed) {
      // Answering the Sleep ring: the bedtime, unless "Going to sleep" gives a better one later
      const slot = sleepSlot(local, null);
      const { data } = await admin.from("daily_facts").select("bedtime").eq("user_id", userId).eq("date", slot.rowDate).maybeSingle();
      if ((data as { bedtime?: string | null } | null)?.bedtime) return null;
      return setFacts(admin, userId, slot.rowDate, { bedtime: new Date(ev.at).toISOString() });
    }
    const closes = answer !== undefined && (habitMarkFor(answer) !== null || answer === "partial");
    if (closes) {
      if (occ.date > today) return null; // a future block can't be closed yet
      await closeBlock(admin, userId, occ, answer, today);
    }
  }
  return null;
}

/**
 * Records each event once (by its client id) and applies it. An event already recorded is skipped,
 * so the phone can safely send its queue again after a lost connection.
 */
export async function applyAlarmEvents(admin: SupabaseClient, userId: string, tz: string, events: AlarmEvent[]): Promise<Result[]> {
  const today = localNow(tz).date;
  const results: Result[] = [];
  for (const ev of [...events].sort((a, b) => a.at - b.at)) {
    const row = {
      user_id: userId,
      client_id: ev.clientId,
      kind: ev.kind,
      answer: ev.answer ?? null,
      occurrence_id: ev.occurrenceId ?? null,
      block_type_id: ev.blockTypeId ?? null,
      chain: ev.chain ?? null,
      seq: ev.seq ?? null,
      total: ev.total ?? null,
      anchor: ev.anchor ?? null,
      style: ev.style ?? null,
      at: new Date(ev.at).toISOString(),
      alarm_at: ev.alarmAt ? new Date(ev.alarmAt).toISOString() : null,
      detail:
        ev.kind === "tick"
          ? { habitId: ev.habitId ?? null, taskId: ev.taskId ?? null, done: ev.done }
          : ev.kind === "checkin"
            ? { date: ev.date, mood: ev.mood ?? null, energy: ev.energy ?? null, sleepQuality: ev.sleepQuality ?? null, highlight: ev.highlight ?? null }
            : ev.wake
              ? { wake: true }
              : null,
    };
    const ins = await admin.from("alarm_events").insert(row);
    if (ins.error && ins.error.code === "23505") {
      results.push({ clientId: ev.clientId, ok: true, message: "already recorded" });
      continue;
    }
    if (ins.error && ins.error.code !== "42P01" && ins.error.code !== "PGRST205") {
      // a foreign key to a removed block: keep the event without it
      if (ins.error.code === "23503") await admin.from("alarm_events").insert({ ...row, occurrence_id: null, block_type_id: null });
      else {
        results.push({ clientId: ev.clientId, ok: false, message: ins.error.message });
        continue;
      }
    }
    try {
      const error = ev.kind === "rang" ? null : await applyOne(admin, userId, tz, ev, today);
      results.push(error ? { clientId: ev.clientId, ok: true, message: error } : { clientId: ev.clientId, ok: true });
    } catch (e) {
      results.push({ clientId: ev.clientId, ok: false, message: e instanceof Error ? e.message : "failed" });
    }
  }
  return results;
}

/** Rings-to-answer per block over the last `days` days, for the Insights page. */
export async function loadRingsToAnswer(sb: SupabaseClient, userId: string, days = 14) {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const { data, error } = await sb
    .from("alarm_events")
    .select("chain,kind,answer,seq,block_type_id,at")
    .eq("user_id", userId)
    .eq("kind", "answer")
    .gte("at", since);
  if (error) return null;
  return ringsToAnswer((data ?? []) as RingRow[]);
}
