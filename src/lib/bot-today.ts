import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMinutes, localNow, timeToMinutes } from "@/lib/time";
import { getBlockTypes } from "@/lib/calendar/model";
import { dayData } from "@/lib/reminders";
import { packId } from "@/lib/telegram";

// Server-only: the "/hoy" status message for Telegram. Runs with the admin client, so EVERY query filters by user_id.

/** Words that ask for today's status (whole message, case and accents ignored, "?" allowed). */
const TRIGGERS = new Set([
  "/hoy", "/today", "/now", "/status", "/pendientes",
  "hoy", "today", "now", "status", "estado", "pendientes", "pending",
  "que tengo", "que tengo hoy", "que me falta", "que falta", "whats left", "what's left",
]);

export function isTodayRequest(text: string) {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?!.]/g, "")
    .replace(/@\w+$/, "") // "/hoy@maxpersonalos_bot" in groups
    .replace(/\s+/g, " ")
    .trim();
  return TRIGGERS.has(t);
}

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type Btn = { text: string; callback_data: string };

export async function todayStatus(admin: SupabaseClient, userId: string, timezone: string): Promise<{ text: string; keyboard: Btn[][] }> {
  const now = localNow(timezone);
  const today = now.date;
  const nowMin = now.minutes;

  const [day, types, taskRes] = await Promise.all([
    dayData(admin, { user_id: userId, timezone }, today),
    getBlockTypes(admin, userId, { includeDeleted: true }),
    admin
      .from("tasks")
      .select("id,title,scheduled_for,occurrence_id,event_id,home_block_type_id,rolled_over_count")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("status", "pending")
      .lte("scheduled_for", today)
      .order("scheduled_for")
      .order("created_at"),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const tasks = (taskRes.data ?? []) as {
    id: string;
    title: string;
    scheduled_for: string;
    occurrence_id: string | null;
    event_id: string | null;
    home_block_type_id: string | null;
    rolled_over_count: number;
  }[];

  // Blocks of today, and where "now" falls
  const blocks = day.items.filter((i) => i.kind === "block");
  const events = day.items.filter((i) => i.kind === "event");
  const current = blocks.find((b) => b.start <= nowMin && nowMin < b.end);
  const currentEvent = events.find((e) => e.start <= nowMin && nowMin < e.end);
  const byOcc = new Map(blocks.map((b) => [b.id, b]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  // Blocks of other days that tasks were placed in ("was in …")
  const otherOccIds = [...new Set(tasks.map((t) => t.occurrence_id).filter((id): id is string => !!id && !byOcc.has(id)))];
  const otherOcc = new Map<string, { block_type_id: string; date: string; start_time: string }>();
  if (otherOccIds.length) {
    const { data } = await admin
      .from("block_occurrences")
      .select("id,block_type_id,date,start_time")
      .eq("user_id", userId)
      .in("id", otherOccIds);
    for (const o of (data ?? []) as { id: string; block_type_id: string; date: string; start_time: string }[]) otherOcc.set(o.id, o);
  }
  const otherEventIds = [...new Set(tasks.map((t) => t.event_id).filter((id): id is string => !!id && !eventById.has(id)))];
  const otherEvents = new Map<string, string>();
  if (otherEventIds.length) {
    const { data } = await admin.from("events").select("id,title").eq("user_id", userId).in("id", otherEventIds);
    for (const e of (data ?? []) as { id: string; title: string }[]) otherEvents.set(e.id, e.title);
  }

  const blockState = (start: number, end: number) => (nowMin >= end ? "ended" : nowMin >= start ? "now" : "later");
  const where = (t: (typeof tasks)[number]) => {
    const home = t.home_block_type_id ? typeName.get(t.home_block_type_id) : null;
    if (t.occurrence_id && byOcc.has(t.occurrence_id)) {
      const b = byOcc.get(t.occurrence_id)!;
      const st = blockState(b.start, b.end);
      const label = `${b.title} ${formatMinutes(b.start % 1440)}`;
      return st === "now" ? `▶ in ${label} (now)` : st === "ended" ? `was in ${label} (ended)` : `in ${label}`;
    }
    if (t.occurrence_id && otherOcc.has(t.occurrence_id)) {
      const o = otherOcc.get(t.occurrence_id)!;
      return `was in ${typeName.get(o.block_type_id) ?? "a block"} ${formatMinutes(timeToMinutes(o.start_time))} on ${shortDate(o.date)}`;
    }
    if (t.event_id) {
      const e = eventById.get(t.event_id);
      if (e) return `in event ${e.title} ${formatMinutes(e.start % 1440)}`;
      return `was in event ${otherEvents.get(t.event_id) ?? "?"}`;
    }
    return home ? `no block yet (home: ${home})` : "no block yet";
  };

  const lines: string[] = [];
  lines.push(`📍 ${formatMinutes(nowMin)} · ${shortDate(today)}${day.freeDay ? " · 🌴 free day" : ""}`);

  // Right now
  if (current) {
    lines.push(`\n▶ Now: ${current.title} (${formatMinutes(current.start % 1440)} – ${formatMinutes(current.end % 1440)}, ${dur(current.end - nowMin)} left)`);
  } else {
    const nextBlock = blocks.find((b) => b.start > nowMin);
    lines.push(`\n▶ Now: free time${nextBlock ? ` · next block ${nextBlock.title} at ${formatMinutes(nextBlock.start % 1440)} (in ${dur(nextBlock.start - nowMin)})` : ""}`);
  }
  if (currentEvent) lines.push(`📌 Event now: ${currentEvent.title} (until ${formatMinutes(currentEvent.end % 1440)})`);

  // Tasks: the ones in the current block first, then by block time, unplaced and overdue last
  const order = (t: (typeof tasks)[number]) => {
    const b = t.occurrence_id ? byOcc.get(t.occurrence_id) : undefined;
    if (b && current && b.id === current.id) return -1;
    if (b) return b.start;
    if (t.event_id && eventById.has(t.event_id)) return eventById.get(t.event_id)!.start;
    return 5000 + (t.scheduled_for < today ? 1 : 0);
  };
  const sorted = [...tasks].sort((a, b) => order(a) - order(b));
  if (sorted.length) {
    lines.push(`\n✅ Pending tasks (${sorted.length})`);
    for (const t of sorted.slice(0, 15)) {
      const extra = [
        t.scheduled_for < today ? `from ${shortDate(t.scheduled_for)}` : null,
        t.rolled_over_count > 0 ? `moved ${t.rolled_over_count}×` : null,
      ].filter(Boolean);
      lines.push(`• ${t.title} — ${where(t)}${extra.length ? ` · ${extra.join(" · ")}` : ""}`);
    }
    if (sorted.length > 15) lines.push(`• +${sorted.length - 15} more`);
  } else {
    lines.push("\n✅ No pending tasks. 🎉");
  }

  // Habits not marked yet, with the state of their block
  const pendingHabits = day.habits.filter((h) => !h.status);
  if (pendingHabits.length) {
    lines.push(`\n🔁 Habits to log (${pendingHabits.length})`);
    for (const h of pendingHabits) {
      const b = byOcc.get(h.occurrenceId);
      const st = b ? blockState(b.start, b.end) : "later";
      const tag = st === "now" ? " (now)" : st === "ended" ? " (block ended)" : "";
      lines.push(`• ${h.title}${tag}`); // "Gym 7:00 AM · Stretch"
    }
  } else if (day.habits.length) {
    lines.push("\n🔁 All habits logged today. 👏");
  }

  // What's left of the day
  const rest = day.items.filter((i) => i.start > nowMin);
  if (rest.length) {
    lines.push(`\n⏭ Still today`);
    for (const i of rest) {
      lines.push(`• ${formatMinutes(i.start % 1440)} – ${formatMinutes(i.end % 1440)} ${i.title}${i.kind === "event" ? " (event)" : ""}`);
    }
  } else {
    lines.push("\n⏭ No more blocks today.");
  }
  if (day.dayNotes.length) lines.push(`\n📌 ${day.dayNotes.join(" · ")}`);

  const keyboard: Btn[][] = [
    ...pendingHabits
      .filter((h) => {
        const b = byOcc.get(h.occurrenceId);
        return !b || nowMin >= b.start; // only habits whose block has started
      })
      .slice(0, 8)
      .map((h) => [
        { text: `✓ ${h.title}`.slice(0, 60), callback_data: `hk:d:${packId(h.habitId)}:${packId(h.occurrenceId)}` },
        { text: "Skip", callback_data: `hk:s:${packId(h.habitId)}:${packId(h.occurrenceId)}` },
      ]),
    // One row per open task: ✓ done · ⏭ next time its block happens · 🗄 archive
    ...sorted.slice(0, 6).map((t) => [
      { text: `✓ ${t.title}`.slice(0, 40), callback_data: `tk:${packId(t.id)}` },
      { text: "⏭ Next", callback_data: `tn:${packId(t.id)}` },
      { text: "🗄", callback_data: `ta:${packId(t.id)}` },
    ]),
  ];
  return { text: lines.join("\n").slice(0, 4000), keyboard };
}
