// Look things up from Telegram without the AI (server only): /search, /notes, /habits, /insights,
// /metrics (+ "sleep 7.5"), /settings.
import { addDays } from "@/lib/time";
import { getHabitSummaries } from "@/lib/calendar/habits";
import { noteAsPlainText } from "@/lib/block-notes";
import { dayData } from "@/lib/reminders";
import type { Ctx } from "@/lib/bot/core";
import { usd } from "@/lib/bot/core";
import { btn, logAction, pk, split, undoRow, type Kb } from "@/lib/bot/tg";
import { shortDay, simplify } from "@/lib/bot/text";
import { taskRow } from "@/lib/bot/tasks";
import { habitRow } from "@/lib/bot/habits";

type Reply = { text: string; kb: Kb };

// ---- Search ------------------------------------------------------------------------------

/** Safe for PostgREST filters: no commas, parentheses or wildcards from the user. */
const term = (q: string) => q.replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export async function searchView(c: Ctx, query: string): Promise<Reply> {
  const q = term(query);
  if (q.length < 2) return { text: "Write what to look for: “/search dentist”.", kb: [] };
  const like = `%${q}%`;
  const [tasks, notes, events, txns] = await Promise.all([
    c.admin.from("tasks").select("id,title,status,scheduled_for").eq("user_id", c.userId).is("deleted_at", null).ilike("title", like).order("scheduled_for", { ascending: false }).limit(8),
    c.admin.from("notes").select("id,title,block_name,updated_at").eq("user_id", c.userId).is("deleted_at", null).or(`title.ilike.${like},content.ilike.${like}`).order("updated_at", { ascending: false }).limit(6),
    c.admin.from("events").select("id,title,event_date").eq("user_id", c.userId).is("deleted_at", null).ilike("title", like).order("event_date", { ascending: false }).limit(5),
    c.admin.from("transactions").select("id,type,amount,description,occurred_at").eq("user_id", c.userId).is("deleted_at", null).ilike("description", like).order("occurred_at", { ascending: false }).limit(5),
  ]);
  type T = { id: string; title: string; status: string; scheduled_for: string | null };
  type N = { id: string; title: string; block_name: string | null };
  type E = { id: string; title: string; event_date: string };
  type X = { id: string; type: string; amount: number; description: string | null; occurred_at: string };
  const L: string[] = [`🔎 “${q}”`];
  const kb: Kb = [];
  const t = (tasks.data ?? []) as T[];
  const n = (notes.data ?? []) as N[];
  const e = (events.data ?? []) as E[];
  const x = (txns.data ?? []) as X[];
  if (!t.length && !n.length && !e.length && !x.length) return { text: `🔎 Nothing found for “${q}”.`, kb: [] };
  if (t.length) {
    L.push("", "✅ Tasks");
    for (const it of t) {
      const state = it.status === "completed" ? "done" : it.status === "archived" ? "archived" : it.scheduled_for ? shortDay(it.scheduled_for) : "open";
      L.push(`• ${it.title} · ${state}`);
      if (it.status === "pending" || it.status === "backlog") kb.push(taskRow(it));
    }
  }
  if (n.length) {
    L.push("", "📝 Notes");
    for (const it of n) {
      L.push(`• ${it.block_name ? `Block note: ${it.block_name}` : it.title || "Untitled"}`);
      kb.push([btn(`📄 ${it.block_name ? `Block: ${it.block_name}` : it.title || "Untitled"}`, `no:${pk(it.id)}`)]);
    }
  }
  if (e.length) {
    L.push("", "🗓 Events");
    for (const it of e) L.push(`• ${it.title} · ${shortDay(it.event_date)}`);
  }
  if (x.length) {
    L.push("", "💵 Money");
    for (const it of x) L.push(`• ${it.type === "income" ? "+" : "−"}${usd(Number(it.amount))} ${it.description ?? ""} · ${shortDay(it.occurred_at.slice(0, 10))}`);
  }
  return { text: L.join("\n"), kb: kb.slice(0, 20) };
}

// ---- Notes ---------------------------------------------------------------------------------

export async function notesView(c: Ctx): Promise<Reply> {
  const { data } = await c.admin
    .from("notes")
    .select("id,title,updated_at")
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .is("block_name", null)
    .order("updated_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as { id: string; title: string; updated_at: string }[];
  if (!rows.length) return { text: "📝 No notes yet. Write “note: Title” and the text below.", kb: [] };
  return {
    text: `📝 Latest notes (${rows.length})\nTap one to read it. “/search word” finds older ones.`,
    kb: rows.map((n) => [btn(`📄 ${n.title || "Untitled"} · ${shortDay(n.updated_at.slice(0, 10))}`, `no:${pk(n.id)}`)]),
  };
}

export async function noteView(c: Ctx, id: string): Promise<{ parts: string[]; kb: Kb }> {
  const { data } = await c.admin
    .from("notes")
    .select("id,title,content,block_name,deleted_at")
    .eq("id", id)
    .eq("user_id", c.userId)
    .maybeSingle();
  if (!data || data.deleted_at) return { parts: ["That note no longer exists."], kb: [] };
  const body = noteAsPlainText((data.content as string) ?? "") || "(empty)";
  const head = data.block_name ? `📝 Block note: ${data.block_name}` : `📄 ${data.title || "Untitled"}`;
  const k = pk(data.id as string);
  return {
    parts: split(`${head}\n\n${body}`),
    kb: [[btn("✏️ Add text", `nA:${k}`), ...(data.block_name ? [] : [btn("🗑 Delete", `nd:${k}`)])]],
  };
}

export async function appendToNote(c: Ctx, id: string, text: string): Promise<Reply> {
  const { data } = await c.admin.from("notes").select("id,title,content,block_name").eq("id", id).eq("user_id", c.userId).is("deleted_at", null).maybeSingle();
  if (!data) return { text: "That note no longer exists.", kb: [] };
  const add = text
    .split("\n")
    .map((l) => l.replace(/^\s*\[\s?\]\s*/, "- [ ] "))
    .join("\n")
    .trim();
  const prev = (data.content as string) ?? "";
  const content = prev.trim() ? `${prev.trimEnd()}\n${add}` : add;
  await c.admin.from("notes").update({ content }).eq("id", data.id).eq("user_id", c.userId);
  return { text: `📝 Added to “${data.block_name ?? data.title ?? "note"}”.`, kb: [] };
}

// ---- Habits ------------------------------------------------------------------------------

const MARK: Record<string, string> = { done: "✓", skipped: "·", missed: "✗" };

export async function habitsView(c: Ctx): Promise<Reply> {
  const [list, day] = await Promise.all([
    getHabitSummaries(c.admin, c.userId, c.today),
    dayData(c.admin, { user_id: c.userId, timezone: c.tz }, c.today),
  ]);
  if (!list.length) return { text: "🔁 No habits yet. Create one: “habit: Stretch in Gym”.", kb: [] };
  const lines = list
    .sort((a, b) => b.current - a.current)
    .map((h) => {
      const recent = h.recent.slice(-7).map((r) => (r.state ? MARK[r.state] : "○")).join("");
      return `${h.current > 0 ? "🔥" : "▫️"} ${h.habit.name}${h.blockName ? ` (${h.blockName})` : " (no block)"}\n   streak ${h.current} · best ${h.best}${h.rate !== null ? ` · ${h.rate}%` : ""} · ${h.skipsLeft} skip${h.skipsLeft === 1 ? "" : "s"} left · ${recent || "—"}`;
    });
  const startedIds = new Set(
    day.items.filter((i) => i.kind === "block" && i.start <= c.nowMin).map((i) => i.id)
  );
  const kb: Kb = day.habits.filter((h) => !h.status && startedIds.has(h.occurrenceId)).slice(0, 8).map(habitRow);
  return { text: ["🔁 Habits", "✓ done · · skipped · ✗ missed · ○ to log", "", ...lines].join("\n"), kb };
}

// ---- Insights ------------------------------------------------------------------------------

export async function insightsView(c: Ctx): Promise<Reply> {
  const { data } = await c.admin
    .from("system_insights")
    .select("id,message,generated_at")
    .eq("user_id", c.userId)
    .eq("is_read", false)
    .is("deleted_at", null)
    .order("generated_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as { id: string; message: string }[];
  const kb: Kb = rows.map((r, i) => [btn(`✓ Read #${i + 1}`, `ir:${pk(r.id)}`)]);
  kb.push([btn("🔄 Generate now", "ig")]);
  if (!rows.length) return { text: "🧭 No unread insights.", kb };
  return { text: ["🧭 Insights", "", ...rows.map((r, i) => `${i + 1}. ${r.message}`)].join("\n"), kb };
}

export async function generateInsights(c: Ctx) {
  const { error } = await c.admin.rpc("generate_insights", { p_user: c.userId, p_force: true });
  return !error;
}

// ---- Metrics -----------------------------------------------------------------------------

type Def = { id: string; name: string; unit: string; min_value: number | null; max_value: number | null; daily_goal: number | null };

export async function metricDefs(c: Ctx): Promise<Def[]> {
  const { data } = await c.admin
    .from("metric_definitions")
    .select("id,name,unit,min_value,max_value,daily_goal")
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .order("created_at");
  return (data ?? []) as Def[];
}

export async function metricsView(c: Ctx): Promise<Reply> {
  const defs = await metricDefs(c);
  if (!defs.length) return { text: "📈 No metrics yet. Create them in Personal OS → Habits (e.g. Sleep h, Water L, Mood 1-10).", kb: [] };
  const { data } = await c.admin
    .from("daily_metrics")
    .select("metric_id,log_date,value")
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .in("metric_id", defs.map((d) => d.id))
    .gte("log_date", addDays(c.today, -6));
  const rows = (data ?? []) as { metric_id: string; log_date: string; value: number }[];
  const lines = defs.map((d) => {
    const mine = rows.filter((r) => r.metric_id === d.id);
    const today = mine.find((r) => r.log_date === c.today);
    const avg = mine.length ? Math.round((mine.reduce((s, r) => s + Number(r.value), 0) / mine.length) * 10) / 10 : null;
    const goal = d.daily_goal !== null ? ` · goal ${Number(d.daily_goal)}` : "";
    return `• ${d.name}: ${today ? `${Number(today.value)} ${d.unit}` : "— today"}${avg !== null ? ` · 7-day avg ${avg}` : ""}${goal}`;
  });
  const ex = defs[0];
  return { text: ["📈 Metrics", "", ...lines, "", `Log: “${ex.name.toLowerCase()} 7” · add: “${ex.name.toLowerCase()} +1”`].join("\n"), kb: [] };
}

export async function logMetric(c: Ctx, raw: string, cmd: { name: string; value: number; add: boolean }): Promise<Reply> {
  const defs = await metricDefs(c);
  const def = defs.find((d) => simplify(d.name) === simplify(cmd.name));
  if (!def) return { text: `I don't have a metric called “${cmd.name}”.`, kb: [] };
  const { data: existing } = await c.admin
    .from("daily_metrics")
    .select("id,value")
    .eq("user_id", c.userId)
    .eq("metric_id", def.id)
    .eq("log_date", c.today)
    .is("deleted_at", null)
    .maybeSingle();
  let next = cmd.add ? Number(existing?.value ?? 0) + cmd.value : cmd.value;
  if (def.min_value !== null) next = Math.max(Number(def.min_value), next);
  if (def.max_value !== null) next = Math.min(Number(def.max_value), next);
  next = Math.round(next * 100) / 100;
  let id = existing?.id as string | undefined;
  if (id) await c.admin.from("daily_metrics").update({ value: next }).eq("id", id).eq("user_id", c.userId);
  else {
    const { data } = await c.admin.from("daily_metrics").insert({ user_id: c.userId, metric_id: def.id, log_date: c.today, value: next }).select("id").single();
    id = data?.id as string | undefined;
  }
  if (!id) return { text: "Could not save the metric.", kb: [] };
  const logId = await logAction(c.admin, c.userId, raw, "metric", id, { prev: existing ? Number(existing.value) : null });
  const goal = def.daily_goal !== null ? ` (goal ${Number(def.daily_goal)}${next >= Number(def.daily_goal) ? " ✓" : ""})` : "";
  return { text: `📈 ${def.name}: ${next} ${def.unit} today${goal}`, kb: undoRow(logId) };
}

// ---- Settings ------------------------------------------------------------------------------

export type ReminderPrefs = {
  morningOn: boolean;
  morningTime: string;
  eveningOn: boolean;
  eveningTime: string;
  before: number;
  insights: boolean;
  nag: boolean;
  /** null = migration 0019 not run yet (no such setting). */
  blockEnd: boolean | null;
};

export async function readPrefs(c: Ctx): Promise<ReminderPrefs> {
  const { data } = await c.admin
    .from("user_settings")
    .select("reminder_morning_enabled,reminder_morning_time,reminder_evening_enabled,reminder_evening_time,reminder_before_minutes,reminder_insights,reminder_unassigned_nag")
    .eq("user_id", c.userId)
    .maybeSingle();
  const extra = await c.admin.from("user_settings").select("reminder_block_end").eq("user_id", c.userId).maybeSingle();
  return {
    morningOn: Boolean(data?.reminder_morning_enabled),
    morningTime: String(data?.reminder_morning_time ?? "07:00").slice(0, 5),
    eveningOn: Boolean(data?.reminder_evening_enabled),
    eveningTime: String(data?.reminder_evening_time ?? "21:00").slice(0, 5),
    before: Number(data?.reminder_before_minutes ?? 10),
    insights: Boolean(data?.reminder_insights),
    nag: Boolean(data?.reminder_unassigned_nag),
    blockEnd: extra.error ? null : Boolean(extra.data?.reminder_block_end ?? true),
  };
}

const onOff = (b: boolean) => (b ? "ON" : "OFF");

export async function settingsView(c: Ctx): Promise<Reply> {
  const p = await readPrefs(c);
  const kb: Kb = [
    [btn(`☀️ Morning summary: ${onOff(p.morningOn)}`, "st:m"), btn(`🕐 ${p.morningTime}`, "sT:m")],
    [btn(`🌙 Evening check-in: ${onOff(p.eveningOn)}`, "st:e"), btn(`🕐 ${p.eveningTime}`, "sT:e")],
    [btn(`⏰ Before each block: ${p.before ? `${p.before} min` : "OFF"}`, "sb")],
    ...(p.blockEnd === null ? [] : [[btn(`🏁 When a block ends: ${onOff(p.blockEnd)}`, "st:a")]]),
    [btn(`📥 Tasks without a block (11:00, 16:00): ${onOff(p.nag)}`, "st:u")],
    [btn(`🧭 Insights: ${onOff(p.insights)}`, "st:i")],
    [btn("✕ Close", "sx")],
  ];
  return { text: "⚙️ Telegram reminders\nTap to change. Same settings as Personal OS → Settings.", kb };
}

const COLUMN: Record<string, string> = {
  m: "reminder_morning_enabled",
  e: "reminder_evening_enabled",
  a: "reminder_block_end",
  u: "reminder_unassigned_nag",
  i: "reminder_insights",
};

export async function toggleSetting(c: Ctx, key: string) {
  const col = COLUMN[key];
  if (!col) return;
  const p = await readPrefs(c);
  const current = { m: p.morningOn, e: p.eveningOn, a: p.blockEnd ?? true, u: p.nag, i: p.insights }[key as "m"];
  await c.admin.from("user_settings").update({ [col]: !current }).eq("user_id", c.userId);
}

export async function cycleBefore(c: Ctx) {
  const options = [0, 5, 10, 15, 30, 60];
  const p = await readPrefs(c);
  const next = options[(options.indexOf(p.before) + 1) % options.length];
  await c.admin.from("user_settings").update({ reminder_before_minutes: next }).eq("user_id", c.userId);
}

export function timeRows(key: "m" | "e"): Kb {
  const times = key === "m"
    ? ["05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "11:00"]
    : ["18:00", "19:00", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00", "23:30", "17:00", "17:30"];
  const rows: Kb = [];
  const sorted = [...times].sort();
  for (let i = 0; i < sorted.length; i += 4) rows.push(sorted.slice(i, i + 4).map((t) => btn(t, `sv:${key}:${t.replace(":", "")}`)));
  rows.push([btn("◂ Back", "sX")]);
  return rows;
}

export async function setTime(c: Ctx, key: string, hhmm: string) {
  if (!/^\d{4}$/.test(hhmm)) return;
  const col = key === "m" ? "reminder_morning_time" : key === "e" ? "reminder_evening_time" : null;
  if (!col) return;
  await c.admin.from("user_settings").update({ [col]: `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` }).eq("user_id", c.userId);
}
