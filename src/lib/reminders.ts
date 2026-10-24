import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, formatDateLong, formatMinutes, localNow, occursOn, timeToMinutes, utcToLocal, zonedToUtc } from "@/lib/time";
import { getBlockTypes, getOccurrences } from "@/lib/calendar/model";
import { spanOn } from "@/lib/calendar/overlap";

// Server-only: runs with the admin client, so EVERY query filters by user_id.

export type ReminderSettings = {
  user_id: string;
  timezone: string;
  telegram_chat_id: number;
  reminder_morning_enabled: boolean;
  reminder_morning_time: string;
  reminder_evening_enabled: boolean;
  reminder_evening_time: string;
  reminder_before_minutes: number;
  reminder_insights: boolean;
};

export const REMINDER_COLUMNS =
  "user_id,timezone,telegram_chat_id,reminder_morning_enabled,reminder_morning_time,reminder_evening_enabled,reminder_evening_time,reminder_before_minutes,reminder_insights";

type Block = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  rrule: string;
  valid_from: string;
  valid_until: string | null;
  is_habit: boolean;
};
type Ev = { id: string; title: string; start_time: string; end_time: string };
/** block: id is the occurrence id and blockTypeId its block type. */
export type DayItem = { kind: "block" | "event"; id: string; title: string; start: number; end: number; blockTypeId?: string };

/** Today's schedule, open tasks and habits for one user. */
export async function dayData(admin: SupabaseClient, s: Pick<ReminderSettings, "user_id" | "timezone">, date: string) {
  const tz = s.timezone;
  const dayStart = zonedToUtc(date, "00:00", tz).toISOString();
  const dayEnd = zonedToUtc(addDays(date, 1), "00:00", tz).toISOString();
  const [types, occurrences] = await Promise.all([
    getBlockTypes(admin, s.user_id),
    getOccurrences(admin, s.user_id, date, date),
  ]);
  const typeName = new Map(types.map((x) => [x.id, x.name]));
  const [b, e, t, logs] = await Promise.all([
    admin
      .from("time_blocks")
      .select("id,title,start_time,end_time,rrule,valid_from,valid_until,is_habit")
      .eq("user_id", s.user_id)
      .is("deleted_at", null),
    admin
      .from("events")
      .select("id,title,start_time,end_time")
      .eq("user_id", s.user_id)
      .is("deleted_at", null)
      .lt("start_time", dayEnd)
      .gt("end_time", dayStart)
      .order("start_time"),
    admin
      .from("tasks")
      .select("id,title")
      .eq("user_id", s.user_id)
      .is("deleted_at", null)
      .eq("status", "pending")
      .lte("scheduled_for", date)
      .order("scheduled_for"),
    admin
      .from("activity_logs")
      .select("entity_id,status")
      .eq("user_id", s.user_id)
      .eq("entity_type", "time_block")
      .eq("log_date", date)
      .is("deleted_at", null),
  ]);
  const blocks = ((b.data ?? []) as Block[]).filter((x) => occursOn(x, date));
  const events = (e.data ?? []) as Ev[];
  const logged = new Map(((logs.data ?? []) as { entity_id: string; status: string }[]).map((l) => [l.entity_id, l.status]));

  const blockItems: DayItem[] = [];
  for (const o of occurrences) {
    const span = spanOn(o, date);
    if (!span || span.continued || o.status === "free_day") continue; // reminders only where a block starts
    blockItems.push({
      kind: "block",
      id: o.id,
      title: typeName.get(o.block_type_id) ?? "Block",
      start: span.start,
      end: span.continues ? timeToMinutes(o.end_time) + 1440 : span.end,
      blockTypeId: o.block_type_id,
    });
  }

  const items: DayItem[] = [
    ...blockItems,
    ...events.map((x) => {
      const st = utcToLocal(x.start_time, tz);
      const en = utcToLocal(x.end_time, tz);
      return { kind: "event" as const, id: x.id, title: x.title, start: st.date < date ? 0 : st.minutes, end: en.date > date ? 1440 : en.minutes };
    }),
  ].sort((a, b2) => a.start - b2.start);

  return {
    items,
    tasks: (t.data ?? []) as { id: string; title: string }[],
    habits: blocks.filter((x) => x.is_habit).map((x) => ({ id: x.id, title: x.title, status: logged.get(x.id) ?? null })),
  };
}

type Day = Awaited<ReturnType<typeof dayData>>;

const list = (titles: string[], max = 5) =>
  titles.slice(0, max).map((t) => `• ${t}`).join("\n") + (titles.length > max ? `\n• +${titles.length - max} more` : "");

export function morningText(date: string, d: Day) {
  const parts = [`☀️ Good morning! ${formatDateLong(date)}`];
  parts.push(
    d.items.length
      ? `\n📅 Today\n${d.items.map((i) => `• ${formatMinutes(i.start % 1440)} ${i.title}${i.kind === "event" ? "" : " (block)"}`).join("\n")}`
      : "\n📅 Nothing scheduled today."
  );
  if (d.tasks.length) parts.push(`\n✅ Tasks (${d.tasks.length})\n${list(d.tasks.map((t) => t.title))}`);
  if (d.habits.length) parts.push(`\n🔁 Habits: ${d.habits.map((h) => h.title).join(", ")}`);
  return parts.join("\n");
}

export function beforeText(item: DayItem, minutes: number, ctx: { tasks: string[]; notes: string[] }) {
  const lines = [`⏰ In ${minutes} min: ${item.title}`, `${formatMinutes(item.start % 1440)} – ${formatMinutes(item.end % 1440)}`];
  if (ctx.tasks.length) lines.push(`\nTasks for this:\n${list(ctx.tasks)}`);
  if (ctx.notes.length) lines.push(`\nNotes:\n${list(ctx.notes)}`);
  return lines.join("\n");
}

export function eveningText(d: Day) {
  const pending = d.habits.filter((h) => !h.status);
  const lines = ["🌙 Evening check-in"];
  if (pending.length) lines.push("\nDid you do these today? Tap to log:");
  else if (d.habits.length) lines.push("\nAll habits logged today. 👏");
  if (d.tasks.length) lines.push(`\n${d.tasks.length} task${d.tasks.length > 1 ? "s" : ""} still open. Unfinished ones roll over at midnight.`);
  return { text: lines.join("\n"), pending };
}

/** Tasks and notes linked to a block type or event. */
export async function linkedTo(admin: SupabaseClient, userId: string, kind: "block" | "event", id: string) {
  const { data } = await admin
    .from("entity_relations")
    .select("source_type,source_id")
    .eq("user_id", userId)
    .eq("target_type", kind === "block" ? "block_type" : "event")
    .eq("target_id", id)
    .in("source_type", ["task", "note"])
    .is("deleted_at", null);
  const rels = (data ?? []) as { source_type: string; source_id: string }[];
  const taskIds = rels.filter((r) => r.source_type === "task").map((r) => r.source_id);
  const noteIds = rels.filter((r) => r.source_type === "note").map((r) => r.source_id);
  const [t, n] = await Promise.all([
    taskIds.length
      ? admin.from("tasks").select("title").eq("user_id", userId).in("id", taskIds).eq("status", "pending").is("deleted_at", null)
      : Promise.resolve({ data: [] }),
    noteIds.length
      ? admin.from("notes").select("title").eq("user_id", userId).in("id", noteIds).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    tasks: ((t.data ?? []) as { title: string }[]).map((x) => x.title),
    notes: ((n.data ?? []) as { title: string }[]).map((x) => x.title || "Untitled"),
  };
}

/** Records that a reminder is being sent. Returns false if it was already sent. */
export async function claim(admin: SupabaseClient, userId: string, kind: string, ref: string) {
  const { error } = await admin.from("reminder_log").insert({ user_id: userId, kind, ref });
  return !error;
}

/** Log a habit from a Telegram button. */
export async function logHabitFromBot(
  admin: SupabaseClient,
  userId: string,
  blockId: string,
  date: string,
  status: "completed" | "skipped"
) {
  const { data: block } = await admin
    .from("time_blocks")
    .select("id,title")
    .eq("id", blockId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!block) return null;
  const values = { status, skip_reason: status === "skipped" ? "Skipped from Telegram" : null };
  const { data: existing } = await admin
    .from("activity_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("entity_type", "time_block")
    .eq("entity_id", blockId)
    .eq("log_date", date)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) await admin.from("activity_logs").update(values).eq("id", existing.id);
  else
    await admin
      .from("activity_logs")
      .insert({ user_id: userId, entity_type: "time_block", entity_id: blockId, log_date: date, ...values });
  return block.title as string;
}

export function nowFor(s: Pick<ReminderSettings, "timezone">) {
  return localNow(s.timezone);
}
