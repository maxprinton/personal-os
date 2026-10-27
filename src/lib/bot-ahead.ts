import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, dateRange, formatMinutes, isoWeekday, localNow, timeToMinutes } from "@/lib/time";
import { getBlockTypes, getFreeDays, getOccurrences } from "@/lib/calendar/model";
import { eventSpanOn, spanOn } from "@/lib/calendar/overlap";
import { getEvents } from "@/lib/calendar/events";
import { getPaymentTemplates } from "@/lib/calendar/payments";
import { dayData } from "@/lib/reminders";

// Server-only: /tomorrow, /thisweek and /nextweek for Telegram. Runs with the admin client, so EVERY
// query filters by user_id. Read only: nothing here changes data.

export type AheadKind = "tomorrow" | "thisweek" | "nextweek";

/** Whole message (case, accents, "?" and "@botname" ignored) → which view it asks for. */
const TRIGGERS: Record<string, AheadKind> = {
  "/tomorrow": "tomorrow", "/manana": "tomorrow", tomorrow: "tomorrow", manana: "tomorrow",
  "que tengo manana": "tomorrow", "what's tomorrow": "tomorrow", "whats tomorrow": "tomorrow",
  "/thisweek": "thisweek", "/week": "thisweek", "/semana": "thisweek", "/estasemana": "thisweek",
  "this week": "thisweek", "esta semana": "thisweek", "que tengo esta semana": "thisweek",
  "/nextweek": "nextweek", "/proximasemana": "nextweek", "next week": "nextweek", "proxima semana": "nextweek",
  "la proxima semana": "nextweek", "semana que viene": "nextweek", "la semana que viene": "nextweek",
  "que tengo la proxima semana": "nextweek",
};

export function aheadRequest(text: string): AheadKind | null {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿?!.]/g, "")
    .replace(/@\w+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return TRIGGERS[t] ?? null;
}

const MAX_LEN = 3900; // Telegram allows 4096 characters
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dayName = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** "7am", "9:30pm" (compact, for the week lines) */
const short = (min: number) => formatMinutes(min).replace(":00 ", " ").replace(" AM", "am").replace(" PM", "pm").replace(" ", "");
const list = (items: string[], max: number) =>
  items.slice(0, max).map((x) => `  • ${x}`).concat(items.length > max ? [`  • +${items.length - max} more`] : []);

export async function aheadText(admin: SupabaseClient, userId: string, timezone: string, kind: AheadKind) {
  const today = localNow(timezone).date;
  if (kind === "tomorrow") return tomorrowText(admin, userId, timezone, today);
  const wd = isoWeekday(today); // 1 = Monday … 7 = Sunday
  const from = kind === "thisweek" ? today : addDays(today, 8 - wd);
  const to = kind === "thisweek" ? addDays(today, 7 - wd) : addDays(from, 6);
  return weekText(admin, userId, timezone, today, from, to, kind);
}

/** Like the morning summary, for tomorrow. */
async function tomorrowText(admin: SupabaseClient, userId: string, tz: string, today: string) {
  const date = addDays(today, 1);
  const [d, free, taskRes] = await Promise.all([
    dayData(admin, { user_id: userId, timezone: tz }, date),
    getFreeDays(admin, userId, date, date),
    admin
      .from("tasks")
      .select("title,scheduled_for,rollover_policy")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("status", "pending")
      .lte("scheduled_for", date)
      .order("scheduled_for")
      .order("created_at"),
  ]);
  const tasks = (taskRes.data ?? []) as { title: string; scheduled_for: string; rollover_policy: string }[];
  const forTomorrow = tasks.filter((t) => t.scheduled_for === date);
  const carried = tasks.filter((t) => t.scheduled_for < date && t.rollover_policy === "migrate");

  const L: string[] = [`🌙 Tomorrow · ${dayName(date)}`];
  if (free.length) {
    L.push(`🌴 Free day${free[0].note ? ` (${free[0].note})` : ""}: your weekly blocks are paused, streaks on hold.`);
  }
  if (d.dayNotes.length) L.push(`📌 ${d.dayNotes.join(" · ")}`);
  L.push(
    d.items.length
      ? `\n📅 Schedule\n${d.items.map((i) => `  • ${formatMinutes(i.start % 1440)} ${i.title}${i.kind === "event" ? "" : " (block)"}`).join("\n")}`
      : "\n📅 Nothing scheduled."
  );
  if (forTomorrow.length) L.push(`\n✅ Tasks (${forTomorrow.length})\n${list(forTomorrow.map((t) => t.title), 8).join("\n")}`);
  if (carried.length) {
    L.push(`\n↪ Still open from today or before (they move to tomorrow if not done): ${carried.length}\n${list(carried.map((t) => t.title), 5).join("\n")}`);
  }
  if (!forTomorrow.length && !carried.length) L.push("\n✅ No tasks yet.");
  const pay = d.payments.filter((p) => p.date === date);
  const overdue = d.payments.filter((p) => p.date < date);
  if (pay.length) L.push(`\n💳 Payments\n${list(pay.map((p) => `${p.title}${p.expected ? ` (${usd(p.expected)})` : ""}`), 6).join("\n")}`);
  if (overdue.length) L.push(`💳 Still to pay from before: ${overdue.map((p) => p.title).join(", ")}`);
  if (d.habits.length) L.push(`\n🔁 Habits: ${d.habits.map((h) => h.title).join(", ")}`);
  return clip(L.join("\n"));
}

/** One short block per day: events, payments, tasks, free days and the blocks in one line. */
async function weekText(
  admin: SupabaseClient,
  userId: string,
  tz: string,
  today: string,
  from: string,
  to: string,
  kind: "thisweek" | "nextweek"
) {
  const [types, occs, events, free, templates, taskRes] = await Promise.all([
    getBlockTypes(admin, userId, { includeDeleted: true }),
    getOccurrences(admin, userId, from, to),
    getEvents(admin, userId, from, to, tz),
    getFreeDays(admin, userId, from, to),
    getPaymentTemplates(admin, userId),
    admin
      .from("tasks")
      .select("title,scheduled_for")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("status", "pending")
      .lte("scheduled_for", to)
      .order("scheduled_for")
      .order("created_at"),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const amount = new Map(templates.map((t) => [t.id, t.expected_amount]));
  const tasks = (taskRes.data ?? []) as { title: string; scheduled_for: string }[];

  const L: string[] = [`📆 ${kind === "thisweek" ? "This week" : "Next week"} · ${dayName(from)} – ${dayName(to)}`];
  let anything = false;
  for (const date of dateRange(from, to)) {
    const label = date === today ? `${dayName(date)} (today)` : date === addDays(today, 1) ? `${dayName(date)} (tomorrow)` : dayName(date);
    const lines: string[] = [];
    const fr = free.find((f) => f.from_date <= date && date <= f.to_date);
    if (fr) lines.push(`  🌴 Free day${fr.note ? ` · ${fr.note}` : ""} (weekly blocks paused)`);

    // Events (all day first), payments apart
    const evs = events
      .map((e) => ({ e, span: eventSpanOn(e, date) }))
      .filter((x): x is { e: (typeof events)[number]; span: NonNullable<ReturnType<typeof eventSpanOn>> } => x.span !== null)
      .sort((a, b) => (a.span.allDay ? -1 : a.span.start) - (b.span.allDay ? -1 : b.span.start));
    for (const { e, span } of evs) {
      if (e.is_payment) {
        const amt = e.payment_expected_amount ?? (e.payment_template_id ? amount.get(e.payment_template_id) ?? null : null);
        const state = e.payment_status === "paid" ? " ✓ paid" : e.payment_status === "skipped" ? " (skipped)" : "";
        lines.push(`  💳 ${e.title}${amt ? ` ${usd(amt)}` : ""}${state}`);
      } else {
        lines.push(`  ${span.allDay ? "📌" : `🗓 ${short(span.start)}`} ${e.title}`);
      }
    }

    // Tasks of that day (today also counts what's still open from before)
    const dayTasks = tasks.filter((t) => t.scheduled_for === date).map((t) => t.title);
    const before = date === today ? tasks.filter((t) => t.scheduled_for < today).length : 0;
    if (dayTasks.length) {
      lines.push(`  ✅ ${dayTasks.slice(0, 4).join(" · ")}${dayTasks.length > 4 ? ` · +${dayTasks.length - 4} more` : ""}`);
    }
    if (before) lines.push(`  ↪ ${before} task${before > 1 ? "s" : ""} still open from before`);

    // Blocks in one line, where they start (paused ones don't exist that day)
    const blocks = occs
      .filter((o) => o.status !== "free_day" && o.status !== "cancelled")
      .map((o) => ({ o, span: spanOn(o, date) }))
      .filter((x) => x.span && !x.span.continued)
      .sort((a, b) => timeToMinutes(a.o.start_time) - timeToMinutes(b.o.start_time))
      .map(({ o }) => `${typeName.get(o.block_type_id) ?? "Block"} ${short(timeToMinutes(o.start_time))}`);
    if (blocks.length) lines.push(`  🧱 ${blocks.join(" · ")}`);

    if (lines.length) anything = true;
    L.push(`\n▸ ${label}`);
    L.push(...(lines.length ? lines : ["  Nothing planned."]));
  }
  if (!anything) L.push("\nNothing on the calendar yet.");
  return clip(L.join("\n"));
}

function clip(text: string) {
  return text.length <= MAX_LEN ? text : `${text.slice(0, MAX_LEN - 40)}\n…\n(more in the app)`;
}
