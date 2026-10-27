import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, formatMinutes, localNow, timeToMinutes } from "@/lib/time";
import { getBlockTypes, getOccurrences } from "@/lib/calendar/model";
import { getChecks, getHabits } from "@/lib/calendar/habits";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import { pickFocus } from "@/lib/calendar/focus";
import { sameBlockSameDay } from "@/lib/calendar/taskview";
import { blockNotesByKey, noteAsPlainText, noteKey } from "@/lib/block-notes";
import { dayData } from "@/lib/reminders";
import { packId } from "@/lib/telegram";

// Server-only: the "/hoy" status message for Telegram. Runs with the admin client, so EVERY query filters by user_id.

/** Words that ask for today's status (whole message, case and accents ignored, "?" allowed). */
const TRIGGERS = new Set([
  "/hoy", "/today", "/status", "/pendientes",
  "hoy", "today", "status", "estado", "pendientes", "pending",
  "que tengo", "que tengo hoy", "que me falta", "que falta", "whats left", "what's left",
]);

function clean(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?!.]/g, "")
    .replace(/@\w+$/, "") // "/hoy@maxpersonalos_bot" in groups
    .replace(/\s+/g, " ")
    .trim();
}

export function isTodayRequest(text: string) {
  return TRIGGERS.has(clean(text));
}

/** "/now": only the block of right now, with its times, habits, tasks and note. */
const NOW_TRIGGERS = new Set(["/now", "now", "/ahora", "ahora", "que toca ahora", "que toca"]);
export function isNowRequest(text: string) {
  return NOW_TRIGGERS.has(clean(text));
}

const TG_MAX = 3900;

/** Splits long text into Telegram-sized messages (at line breaks when possible). */
export function splitForTelegram(text: string, max = TG_MAX) {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

type Btn = { text: string; callback_data: string };

export async function todayStatus(
  admin: SupabaseClient,
  userId: string,
  timezone: string
): Promise<{ text: string; keyboard: Btn[][]; extra: string[] }> {
  const now = localNow(timezone);
  const today = now.date;
  const nowMin = now.minutes;

  const [day, types, taskRes, notes] = await Promise.all([
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
    blockNotesByKey(admin, userId),
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
  // The full note of every block of today (like LifeOS: the name is the key), in the day's order
  const noteParts: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const k = noteKey(b.title);
    if (seen.has(k)) continue;
    seen.add(k);
    const body = noteAsPlainText(notes.get(k)?.content ?? "");
    if (body) noteParts.push(`📝 ${b.title}\n${body}`);
  }
  const main = lines.join("\n");
  const notesText = noteParts.length ? `\n\n📝 Block notes\n\n${noteParts.join("\n\n")}` : "";
  if (main.length + notesText.length <= TG_MAX) return { text: main + notesText, keyboard, extra: [] };
  // Too long for one message: the notes go in the next message(s)
  return {
    text: main.slice(0, 4000),
    keyboard,
    extra: noteParts.length ? splitForTelegram(`📝 Block notes\n\n${noteParts.join("\n\n")}`) : [],
  };
}

/** "/now": the block of right now (metadata, habits, tasks, full note). Free time says what is next. */
export async function nowStatus(admin: SupabaseClient, userId: string, timezone: string): Promise<{ text: string[]; keyboard: Btn[][] }> {
  const now = localNow(timezone);
  const today = now.date;
  const [occurrences, types, habits, checks, notes] = await Promise.all([
    getOccurrences(admin, userId, today, today),
    getBlockTypes(admin, userId, { includeDeleted: true }),
    getHabits(admin, userId, { includeRemoved: true }),
    getChecks(admin, userId, addDays(today, -1), today),
    blockNotesByKey(admin, userId),
  ]);
  const focus = pickFocus(occurrences, today, now.minutes);
  const name = (id: string) => types.find((t) => t.id === id)?.name ?? "Block";
  if (!focus || focus.mode === "next") {
    const lines = [`📍 ${formatMinutes(now.minutes)} · ▶ Now: free time`];
    if (focus) lines.push(`Next: ${name(focus.occ.block_type_id)} at ${formatMinutes(focus.startAbs)} (in ${dur(focus.startAbs - now.minutes)})`);
    else lines.push("No more blocks today.");
    return { text: [lines.join("\n")], keyboard: [] };
  }
  const { occ } = focus;
  const blockName = name(occ.block_type_id);
  const left = Math.max(0, focus.endAbs - now.minutes);
  const status = occ.status === "done" ? " · ✓ done" : occ.status === "partial" ? " · ◐ partly done" : "";
  const lines = [
    `▶ Now: ${blockName}`,
    `🕐 ${formatMinutes(timeToMinutes(occ.start_time))} – ${formatMinutes(timeToMinutes(occ.end_time))} · ${dur(left)} left${status}`,
  ];

  const hs = habitsForOccurrence(occ, habits, checks, today);
  if (hs.length) {
    lines.push("", "🔁 Habits");
    for (const h of hs) {
      lines.push(`• ${h.habit.name} — ${h.state === "done" ? "✓ done" : h.state === "skipped" ? "⏭ skipped" : h.state === "missed" ? "✗ missed" : "to log"}`);
    }
  }

  const ids = [...sameBlockSameDay(occ, occurrences)];
  const { data: taskData } = await admin
    .from("tasks")
    .select("id,title,status")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("occurrence_id", ids)
    .eq("scheduled_for", occ.date)
    .in("status", ["pending", "completed"])
    .order("created_at");
  const tasks = (taskData ?? []) as { id: string; title: string; status: string }[];
  if (tasks.length) {
    lines.push("", "✅ Tasks");
    for (const t of tasks) lines.push(`• ${t.status === "completed" ? "✓ " : ""}${t.title}`);
  }

  const note = noteAsPlainText(notes.get(noteKey(blockName))?.content ?? "");
  lines.push("", `📝 Note`, note || "(no note yet — write it in the block's window or on Today)");

  const keyboard: Btn[][] = [
    ...hs
      .filter((h) => !h.state)
      .slice(0, 8)
      .map((h) => [
        { text: `✓ ${h.habit.name}`.slice(0, 60), callback_data: `hk:d:${packId(h.habit.id)}:${packId(occ.id)}` },
        { text: "Skip", callback_data: `hk:s:${packId(h.habit.id)}:${packId(occ.id)}` },
      ]),
    ...tasks
      .filter((t) => t.status === "pending")
      .slice(0, 6)
      .map((t) => [{ text: `✓ ${t.title}`.slice(0, 40), callback_data: `tk:${packId(t.id)}` }]),
  ];
  return { text: splitForTelegram(lines.join("\n")), keyboard };
}
