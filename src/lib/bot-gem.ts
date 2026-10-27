import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, ISO_DAY_SHORT, localNow, utcToLocal } from "@/lib/time";
import { accountBalance, type Snapshot, type Transfer, type Txn } from "@/lib/money";
import { getBlockTypes, getOccurrences, getSlots } from "@/lib/calendar/model";
import { getEvents } from "@/lib/calendar/events";
import { getHabits } from "@/lib/calendar/habits";
import { getPaymentTemplates } from "@/lib/calendar/payments";
import { habitRate, habitStreak } from "@/lib/calendar/streaks";
import { gemini } from "@/lib/gemini";

// Server-only: "@gem <question>" / "/gem <question>" / "gem: <question>" in Telegram. Gemini reads a
// snapshot of the whole system (calendar, tasks, habits, finances, notes; all history) and answers.
// READ ONLY: nothing here changes data. Runs with the admin client, so EVERY query filters by user_id.

/** The question, or null when the message is not for @gem. */
export function gemQuestion(text: string): string | null {
  // Also "@gemini …", and "gem, …" / "Gemini, …" (how a voice note usually comes out)
  const m = /^(?:@gem(?:ini)?\b|\/gem(?:ini)?(?:@\w+)?\b|gem(?:ini)?\s*[:,])\s*([\s\S]*)$/i.exec(text.trim());
  return m ? m[1].trim() : null;
}

const MAX_CONTEXT = 300_000; // characters (~80k tokens); older history is trimmed first beyond this
const TG_MAX = 4000;

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Builds the data snapshot Gemini reads (plain text, one line per record, oldest first). */
async function snapshot(admin: SupabaseClient, userId: string, tz: string) {
  const today = localNow(tz).date;
  const ahead = addDays(today, 60);
  const [
    accounts, categories, budgets, snaps, txns, transfers, templates,
    tasks, notes, types, slots, occHistory, occAhead, events, habits, checks, freeDays,
  ] = await Promise.all([
    fetchAll<{ id: string; name: string; kind: string }>((a, b) => admin.from("accounts").select("id,name,kind").eq("user_id", userId).is("deleted_at", null).order("created_at").range(a, b)),
    fetchAll<{ id: string; name: string; kind: string }>((a, b) => admin.from("categories").select("id,name,kind").eq("user_id", userId).is("deleted_at", null).range(a, b)),
    fetchAll<{ category_id: string; limit_amount: number; period: string }>((a, b) => admin.from("budgets").select("category_id,limit_amount,period").eq("user_id", userId).is("deleted_at", null).range(a, b)),
    fetchAll<{ id: string; account_id: string; amount: number; recorded_at: string }>((a, b) => admin.from("balance_snapshots").select("id,account_id,amount,recorded_at").eq("user_id", userId).is("deleted_at", null).order("recorded_at").range(a, b)),
    fetchAll<{ id: string; account_id: string | null; category_id: string | null; type: "income" | "expense"; amount: number; description: string | null; occurred_at: string }>((a, b) =>
      admin.from("transactions").select("id,account_id,category_id,type,amount,description,occurred_at").eq("user_id", userId).is("deleted_at", null).order("occurred_at").order("id").range(a, b)),
    fetchAll<{ id: string; from_account_id: string; to_account_id: string; amount: number; occurred_at: string }>((a, b) =>
      admin.from("transfers").select("id,from_account_id,to_account_id,amount,occurred_at").eq("user_id", userId).is("deleted_at", null).order("occurred_at").order("id").range(a, b)),
    getPaymentTemplates(admin, userId),
    fetchAll<{ title: string; status: string; scheduled_for: string | null; completed_at: string | null; rolled_over_count: number; rollover_policy: string; home_block_type_id: string | null; created_at: string }>((a, b) =>
      admin.from("tasks").select("title,status,scheduled_for,completed_at,rolled_over_count,rollover_policy,home_block_type_id,created_at").eq("user_id", userId).is("deleted_at", null).order("created_at").range(a, b)),
    fetchAll<{ title: string; content: string; created_at: string }>((a, b) => admin.from("notes").select("title,content,created_at").eq("user_id", userId).is("deleted_at", null).order("created_at").range(a, b)),
    getBlockTypes(admin, userId, { includeDeleted: true }),
    getSlots(admin, userId, today),
    fetchAll<{ block_type_id: string; date: string; start_time: string; end_time: string; status: string }>((a, b) =>
      admin.from("block_occurrences").select("block_type_id,date,start_time,end_time,status").eq("user_id", userId).lt("date", today).neq("status", "cancelled").order("date").order("start_time").range(a, b)),
    getOccurrences(admin, userId, today, addDays(today, 13)),
    getEvents(admin, userId, "2000-01-01", ahead, tz),
    getHabits(admin, userId, { includeRemoved: false }),
    fetchAll<{ habit_id: string; date: string; state: "done" | "skipped" | "missed" }>((a, b) => admin.from("habit_checks").select("habit_id,date,state").eq("user_id", userId).order("date").range(a, b)),
    fetchAll<{ from_date: string; to_date: string; note: string | null }>((a, b) => admin.from("free_days").select("from_date,to_date,note").eq("user_id", userId).is("deleted_at", null).order("from_date").range(a, b)),
  ]);

  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const typ = new Map(types.map((t) => [t.id, t.name]));
  const isFree = (d: string) => freeDays.some((f) => f.from_date <= d && d <= f.to_date);

  // Money
  const S: Snapshot[] = snaps.map((s) => ({ ...s, amount: Number(s.amount) }));
  const T: Txn[] = txns.map((t) => ({ ...t, amount: Number(t.amount), localDate: "" }) as Txn);
  const TR: Transfer[] = transfers.map((t) => ({ ...t, amount: Number(t.amount), note: null, localDate: "" }) as Transfer);
  const balances = accounts.map((a) => `${a.name} (${a.kind}): ${money(accountBalance(a.id, S, T, TR).balance)}`);
  const txLines = txns.map(
    (t) => `${utcToLocal(t.occurred_at, tz).date} | ${t.type} | ${money(Number(t.amount))} | ${t.description ?? ""} | ${t.category_id ? cat.get(t.category_id) ?? "" : "no category"} | ${t.account_id ? acc.get(t.account_id) ?? "" : "no account"}`
  );
  const trLines = transfers.map((t) => `${utcToLocal(t.occurred_at, tz).date} | ${money(Number(t.amount))} | ${acc.get(t.from_account_id) ?? "?"} -> ${acc.get(t.to_account_id) ?? "?"}`);

  // Habits: marks + streaks computed with the app's own rules
  const habitLines = habits.map((h) => {
    const marks = checks.filter((c) => c.habit_id === h.id).map((c) => ({ date: c.date, start: "00:00", state: c.state, freeDay: isFree(c.date) }));
    const s = habitStreak(marks, today);
    const rate = habitRate(marks, today);
    return `${h.name} (in block ${h.block_type_id ? typ.get(h.block_type_id) ?? "?" : "none"}): streak ${s.current}, best ${s.best}, done rate last 30 ${rate ?? "-"}%`;
  });
  const habitName = new Map(habits.map((h) => [h.id, h.name]));
  const checkLines = checks.filter((c) => habitName.has(c.habit_id)).map((c) => `${c.date} | ${habitName.get(c.habit_id)} | ${c.state}`);

  const header = [
    `TODAY: ${today} (${ISO_DAY_SHORT[(new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7]}), timezone ${tz}. Money in USD.`,
    "",
    "== ACCOUNTS (current balance) ==",
    ...balances,
    "",
    "== BUDGETS ==",
    ...budgets.map((b) => `${cat.get(b.category_id) ?? "?"}: ${money(Number(b.limit_amount))} per ${b.period}`),
    "",
    "== SCHEDULED PAYMENTS (series) ==",
    ...templates.map((t) => `${t.name} | ${t.type} | expected ${t.expected_amount ?? "-"} | repeats ${t.repeat_unit === "none" ? "once" : `every ${t.repeat_every} ${t.repeat_unit}`} from ${t.start_date}${t.end_date ? ` to ${t.end_date}` : ""}`),
    "",
    "== WEEKLY BLOCK PATTERN (current) ==",
    ...slots.map((s) => `${ISO_DAY_SHORT[s.weekday - 1]} ${hm(s.start_time)}-${hm(s.end_time)} ${typ.get(s.block_type_id) ?? "?"}`),
    "",
    "== FREE DAYS (weekly blocks paused) ==",
    ...freeDays.map((f) => `${f.from_date} to ${f.to_date}${f.note ? ` | ${f.note}` : ""}`),
    "",
    "== HABITS (current) ==",
    ...habitLines,
    "",
    "== TASKS (date | status | title | times moved | home block | policy) ==",
    ...tasks.map((t) => `${t.scheduled_for ?? "no date"} | ${t.status}${t.completed_at ? ` ${utcToLocal(t.completed_at, tz).date}` : ""} | ${t.title} | moved ${t.rolled_over_count} | ${t.home_block_type_id ? typ.get(t.home_block_type_id) ?? "" : "-"} | ${t.rollover_policy}`),
    "",
    "== BLOCKS NEXT 14 DAYS (date | time | block | status) ==",
    ...occAhead.filter((o) => o.date >= today && o.status !== "cancelled").map((o) => `${o.date} | ${hm(o.start_time)}-${hm(o.end_time)} | ${typ.get(o.block_type_id) ?? "?"} | ${o.status}`),
    "",
    "== EVENTS (start date | end | time | title | payment) ==",
    ...events.map((e) => `${e.date}${e.end_date !== e.date ? ` to ${e.end_date}` : ""} | ${e.start === null ? "all day" : `${Math.floor(e.start / 60)}:${String(e.start % 60).padStart(2, "0")}`} | ${e.title}${e.is_payment ? ` | payment ${e.payment_status ?? "unpaid"}${e.payment_expected_amount ? ` ${e.payment_expected_amount}` : ""}` : ""}`),
    "",
    "== NOTES ==",
    ...notes.map((n) => `[${utcToLocal(n.created_at, tz).date}] ${n.title}: ${n.content.replace(/\s+/g, " ").slice(0, 1500)}`),
  ];

  // History (can be long): oldest lines are dropped first if everything doesn't fit
  const history: [string, string[]][] = [
    ["TRANSACTIONS (date | type | amount | description | category | account)", txLines],
    ["TRANSFERS (date | amount | from -> to)", trLines],
    ["HABIT MARKS (date | habit | state)", checkLines],
    ["PAST BLOCKS (date | time | block | status: done/partial/scheduled=not ticked/free_day)", occHistory.map((o) => `${o.date} | ${hm(o.start_time)}-${hm(o.end_time)} | ${typ.get(o.block_type_id) ?? "?"} | ${o.status}`)],
  ];
  // Each history section gets a share of the room left, by size; the newest lines are kept
  let text = header.join("\n");
  const room = Math.max(0, MAX_CONTEXT - text.length);
  const total = history.reduce((n, [, lines]) => n + lines.reduce((m, l) => m + l.length + 1, 0), 0);
  let trimmed = false;
  for (const [title, lines] of history) {
    const size = lines.reduce((m, l) => m + l.length + 1, 0);
    const share = total <= room ? size : Math.floor((room * size) / Math.max(1, total));
    const keep: string[] = [];
    let used = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (used + lines[i].length + 1 > share) {
        trimmed = true;
        break;
      }
      keep.unshift(lines[i]);
      used += lines[i].length + 1;
    }
    text += `\n\n== ${title} ==${keep.length < lines.length ? ` (only the latest ${keep.length} of ${lines.length})` : ""}\n${keep.join("\n")}`;
  }
  return { text, today, trimmed };
}

/** Answers a question about the user's own data. Never changes anything. */
export async function gemAnswer(admin: SupabaseClient, userId: string, tz: string, question: string): Promise<string[]> {
  if (!question) {
    return [
      "✨ Ask me anything about your system, e.g.:\n• @gem ¿en qué gasté más este mes?\n• @gem ¿qué tareas llevo moviendo más veces?\n• @gem ¿cómo van mis hábitos esta semana?\n• @gem ¿cuánto me queda del presupuesto de comida?\n• @gem resume mis notas sobre la app del gimnasio",
    ];
  }
  const snap = await snapshot(admin, userId, tz);
  const system = [
    "You are the assistant inside the user's Personal OS (their own app for time blocks, tasks, habits, finances and notes).",
    "Answer the user's question using ONLY the data below. Be specific: names, dates, amounts. Do the math carefully (sum, compare, count).",
    "If the data doesn't have the answer, say so plainly. Never invent records.",
    "You can only read: if they ask you to change something, explain how to do it in the app or the bot (e.g. 'task: …', 'spent 12 …').",
    "Reply in the user's language (Spanish or English), short and clear for a phone chat: plain text, short lines, simple bullets with •, no tables, no markdown headings or asterisks.",
    "Dates relative to TODAY. 'This month' = calendar month of TODAY. Weeks start on Monday.",
  ].join("\n");
  const out = await gemini(system, [{ text: `DATA\n${snap.text}` }, { text: `QUESTION: ${question.slice(0, 1500)}` }], { timeoutMs: 25000 });
  if (!out) return ["✨ Gemini didn't answer this time (busy or out of free quota). Try again in a minute, or check /ai."];
  const answer = `✨ ${out.replace(/\*\*/g, "").trim()}${snap.trimmed ? "\n\n(Very old history was left out to fit.)" : ""}`;
  const parts: string[] = [];
  for (let i = 0; i < answer.length; i += TG_MAX) parts.push(answer.slice(i, i + TG_MAX));
  return parts;
}
