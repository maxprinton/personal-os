// Telegram side of the daily facts: the day at a glance, and the inputs (mood, energy, bedtime, wake-up, highlight).
// Mood and Energy are the metrics (so "mood 7" and the app write the same value); sleep and highlight live on daily_facts.
import type { Ctx } from "@/lib/bot/core";
import { btn, type Kb } from "@/lib/bot/tg";
import { commandArg, isOneOf, simplify } from "@/lib/bot/text";
import { logMetric, metricDefs } from "@/lib/bot/queries";
import { formatDateLong, minutesToTime, zonedToUtc } from "@/lib/time";
import { deltaText, formatDuration, oneDecimal, parseClock, sleepMinutes, sleepSlot } from "@/lib/daily-facts";

type Reply = { text: string; kb: Kb };

export type DayCmd =
  | { kind: "checkin" }
  | { kind: "review" }
  | { kind: "scale"; name: "mood" | "energy"; raw: string }
  | { kind: "bed"; raw: string }
  | { kind: "woke"; raw: string }
  | { kind: "highlight"; raw: string };

export function parseDayCommand(text: string): DayCmd | null {
  if (isOneOf(text, ["/checkin", "checkin", "/chequeo", "chequeo"])) return { kind: "checkin" };
  if (isOneOf(text, ["/review", "/progress", "/semanal"])) return { kind: "review" };
  const pick = (names: string[]) => commandArg(text, names);
  const mood = pick(["/mood", "/animo"]);
  if (mood !== null) return { kind: "scale", name: "mood", raw: mood };
  const energy = pick(["/energy", "/energia"]);
  if (energy !== null) return { kind: "scale", name: "energy", raw: energy };
  const bed = pick(["/bed", "/dormir"]);
  if (bed !== null) return { kind: "bed", raw: bed };
  const woke = pick(["/woke", "/desperte"]);
  if (woke !== null) return { kind: "woke", raw: woke };
  const hl = pick(["/highlight", "/destacado"]);
  if (hl !== null) return { kind: "highlight", raw: hl };
  return null;
}

export async function runDayCommand(c: Ctx, cmd: DayCmd, raw: string): Promise<Reply> {
  switch (cmd.kind) {
    case "checkin":
      return checkinView(c);
    case "review":
      return weekView(c);
    case "scale": {
      const n = Math.round(Number(cmd.raw.replace(",", ".")));
      if (!Number.isFinite(n) || n < 1 || n > 10) return { text: `Send a number from 1 to 10, e.g. “/${cmd.name} 7”.`, kb: [] };
      return withView(c, await setScale(c, cmd.name, n, raw));
    }
    case "bed": {
      const clock = cmd.raw ? parseClock(cmd.raw) : null;
      if (cmd.raw && clock === null) return { text: "I couldn't read that time. Try “/bed 23:30” or just “/bed” for now.", kb: [] };
      return withView(c, await setBed(c, clock));
    }
    case "woke": {
      const clock = cmd.raw ? parseClock(cmd.raw) : null;
      if (cmd.raw && clock === null) return { text: "I couldn't read that time. Try “/woke 7:15” or just “/woke” for now.", kb: [] };
      return withView(c, await setWake(c, clock));
    }
    case "highlight": {
      if (!cmd.raw.trim()) return { text: "Write it after the command: “/highlight shipped the portfolio”.", kb: [] };
      return withView(c, await setHighlight(c, cmd.raw));
    }
  }
}

async function withView(c: Ctx, note: string): Promise<Reply> {
  const v = await checkinView(c);
  return { text: `${note}\n\n${v.text}`, kb: v.kb };
}

// ---- Writing ------------------------------------------------------------------------------------

/** Makes sure the row of `date` exists (rebuilt from raw data for today and the past; empty skeleton for tomorrow). */
async function ensureRow(c: Ctx, date: string) {
  if (date <= c.today) await c.admin.rpc("refresh_daily_facts", { p_user: c.userId, p_from: date, p_to: date, p_capture_eod: false, p_force: true });
  await c.admin.from("daily_facts").upsert({ user_id: c.userId, date }, { onConflict: "user_id,date", ignoreDuplicates: true });
}

async function ensureMetric(c: Ctx, name: "Mood" | "Energy") {
  const defs = await metricDefs(c);
  if (defs.some((d) => simplify(d.name) === simplify(name))) return;
  await c.admin.from("metric_definitions").insert({ user_id: c.userId, name, unit: "1-10", min_value: 1, max_value: 10 });
}

export async function setScale(c: Ctx, name: "mood" | "energy", value: number, raw: string): Promise<string> {
  const label = name === "mood" ? "Mood" : "Energy";
  await ensureMetric(c, label);
  const r = await logMetric(c, raw, { name: label, value, add: false });
  if (!r.text.startsWith("📈")) return r.text;
  // Also write the day's row directly, so it works even before the database trigger (migration 0049) exists.
  await ensureRow(c, c.today);
  await c.admin.from("daily_facts").update({ [name]: value }).eq("user_id", c.userId).eq("date", c.today);
  return `${name === "mood" ? "😊" : "⚡"} ${label} ${value}/10 saved for today.`;
}

function constraintMessage(error: { code?: string } | null): string | null {
  if (!error) return null;
  if (error.code === "23514") return "That order doesn't work: bedtime has to be before the wake-up time.";
  return "Could not save that. Try again.";
}

export async function setBed(c: Ctx, clock: number | null): Promise<string> {
  const slot = sleepSlot({ date: c.today, minutes: c.nowMin }, clock);
  const bed = zonedToUtc(slot.bedDate, minutesToTime(slot.bedMinutes), c.tz);
  await ensureRow(c, slot.rowDate);
  const { error } = await c.admin.from("daily_facts").update({ bedtime: bed.toISOString() }).eq("user_id", c.userId).eq("date", slot.rowDate);
  const bad = constraintMessage(error);
  if (bad) return bad;
  return `🛏 Bedtime ${minutesToTime(slot.bedMinutes)} saved. Tomorrow say /woke when you get up.`;
}

export async function setWake(c: Ctx, clock: number | null): Promise<string> {
  const minutes = clock ?? c.nowMin;
  if (clock !== null && clock > c.nowMin) return "That time is still in the future. Send the time you actually woke up.";
  const wake = zonedToUtc(c.today, minutesToTime(minutes), c.tz);
  await ensureRow(c, c.today);
  const { error } = await c.admin.from("daily_facts").update({ wake_at: wake.toISOString() }).eq("user_id", c.userId).eq("date", c.today);
  const bad = constraintMessage(error);
  if (bad) return bad;
  return `☀️ Woke up ${minutesToTime(minutes)} saved.`;
}

export async function setHighlight(c: Ctx, text: string): Promise<string> {
  await ensureRow(c, c.today);
  await c.admin.from("daily_facts").update({ highlight: text.trim().slice(0, 280) }).eq("user_id", c.userId).eq("date", c.today);
  return "✨ Highlight saved.";
}

// ---- Reading ------------------------------------------------------------------------------------

function scaleRows(prefix: string, icon: string): Kb {
  const row = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => btn(`${n === from && icon ? icon + " " : ""}${n}`, `df:${prefix}:${n}`));
  return [row(1, 5), row(6, 10)];
}

export async function checkinView(c: Ctx, opts: { evening?: boolean } = {}): Promise<Reply> {
  await c.admin.rpc("refresh_daily_facts", { p_user: c.userId, p_from: c.today, p_to: c.today, p_capture_eod: false, p_force: true });
  const [{ data: f }, { data: s }] = await Promise.all([
    c.admin.from("daily_facts").select("*").eq("user_id", c.userId).eq("date", c.today).maybeSingle(),
    c.admin.from("daily_scores").select("score,unlogged").eq("user_id", c.userId).eq("date", c.today).maybeSingle(),
  ]);
  const head = `${opts.evening ? "🌙 Evening check-in" : "🗓 Check-in"} · ${formatDateLong(c.today)}`;
  if (!f) return { text: `${head}\n\nNothing recorded for today yet.`, kb: scaleRows("m", "😊") };
  const num = (k: string) => Number(f[k] ?? 0);
  const score = s?.score === null || s?.score === undefined ? "—" : String(Math.round(Number(s.score)));
  const lines = [head, ""];
  lines.push(`Score ${score}${f.is_free_day ? " · free day" : ""}`);
  if (num("blocks_planned") > 0) lines.push(`• Blocks ${num("blocks_done")}/${num("blocks_planned")}`);
  if (num("habits_due") > 0) lines.push(`• Habits ${num("habits_done")}/${num("habits_due")}`);
  lines.push(`• Tasks done ${num("tasks_completed")}`);
  if (num("spent") > 0) lines.push(`• Spent $${num("spent").toFixed(2)}`);
  if (num("notes_created") > 0) lines.push(`• Notes ${num("notes_created")}`);
  const slept = sleepMinutes(f.bedtime as string | null, f.wake_at as string | null);
  lines.push("");
  lines.push(`😊 Mood ${f.mood ?? "—"} · ⚡ Energy ${f.energy ?? "—"} · 😴 Sleep ${slept ? formatDuration(slept) : "—"}`);
  if (f.highlight) lines.push(`✨ ${f.highlight}`);
  lines.push("");
  lines.push("Tap to log. Highlight: /highlight text · times: /bed 23:30 · /woke 7:15");
  const kb: Kb = [
    ...scaleRows("m", "😊"),
    ...scaleRows("e", "⚡"),
    [btn("🛏 Going to bed now", "df:b"), btn("☀️ Woke up now", "df:w")],
  ];
  return { text: lines.join("\n"), kb };
}

export async function weekView(c: Ctx): Promise<Reply> {
  const { data } = await c.admin
    .from("weekly_summary")
    .select("*")
    .eq("user_id", c.userId)
    .order("week", { ascending: false })
    .limit(2);
  const rows = (data ?? []) as Record<string, number | string | null>[];
  if (!rows.length) return { text: "📊 No weeks to show yet. Mark blocks, habits and tasks and it fills in.", kb: [] };
  const w = rows[0];
  const n = (k: string) => (w[k] === null || w[k] === undefined ? null : Number(w[k]));
  const prev = rows[1] ? Number(rows[1].score ?? NaN) : n("prev_score");
  const score = n("score");
  const lines = [
    `📊 Week of ${formatDateLong(String(w.week))}`,
    "",
    `Score ${score === null ? "—" : Math.round(score)} (${deltaText(score, Number.isFinite(prev as number) ? (prev as number) : null)} vs last week) · ${n("logged_days") ?? 0} days logged`,
    `• Blocks done ${n("blocks_done") ?? 0} · tasks done ${n("tasks_done") ?? 0} · notes ${n("notes") ?? 0}`,
    `• Spent $${(n("spent") ?? 0).toFixed(2)} · earned $${(n("earned") ?? 0).toFixed(2)}`,
  ];
  if (n("work_hours")) lines.push(`• Teaching ${oneDecimal(n("work_hours"))} h`);
  if (n("hours_of_life")) lines.push(`• Spending = ${oneDecimal(n("hours_of_life"))} h of your work time`);
  if (n("mood") !== null) lines.push(`• Average mood ${oneDecimal(n("mood"))}`);
  const { data: rw } = await c.admin.from("money_runway").select("days_left,burn_per_day").eq("user_id", c.userId).maybeSingle();
  if (rw?.days_left !== null && rw?.days_left !== undefined) lines.push(`• Runway about ${Math.round(Number(rw.days_left))} days at $${Number(rw.burn_per_day).toFixed(2)}/day`);
  return { text: lines.join("\n"), kb: [] };
}

// ---- Focus of a block (1 scattered, 2 normal, 3 locked in) ---------------------------------------

const FOCUS = ["", "😵 Scattered", "🙂 Normal", "🎯 Locked in"];

/** The row under a finished block: how focused were you? `chosen` marks the saved answer. */
export function focusRow(packedOcc: string, chosen: number | null = null): Kb[number] {
  return [1, 2, 3].map((n) => btn(`${chosen === n ? "• " : ""}${FOCUS[n]}`, `bf:${n}:${packedOcc}`));
}

export async function setFocus(c: Ctx, occId: string, value: number): Promise<string | null> {
  if (![1, 2, 3].includes(value)) return null;
  const { error } = await c.admin.from("block_occurrences").update({ focus: value }).eq("id", occId).eq("user_id", c.userId);
  return error ? null : FOCUS[value];
}

// ---- "Was it worth it?" for a purchase ------------------------------------------------------------

const FIXED = /rent|arriendo|alquiler|utilit|bill|internet|water|luz|agua|insurance|seguro|loan|prestamo|tax|adjust|transfer|salary|tuition/i;

/** Buttons for a freshly saved expense, or null when it is a fixed cost, income or tiny. */
export async function worthItRow(c: Ctx, txnId: string, packed: string): Promise<Kb[number] | null> {
  const { data } = await c.admin
    .from("transactions")
    .select("type,amount,payment_template_id,description,categories(name)")
    .eq("id", txnId)
    .eq("user_id", c.userId)
    .maybeSingle();
  if (!data || data.type !== "expense" || Number(data.amount) < 3 || data.payment_template_id) return null;
  const cat = (data.categories as unknown as { name?: string } | null)?.name ?? "";
  if (FIXED.test(cat) || FIXED.test(String(data.description ?? ""))) return null;
  return [btn("✓ Worth it", `wi:y:${packed}`), btn("✕ Not worth it", `wi:n:${packed}`)];
}

export async function setWorthIt(c: Ctx, txnId: string, yes: boolean): Promise<boolean> {
  const { error } = await c.admin.from("transactions").update({ worth_it: yes }).eq("id", txnId).eq("user_id", c.userId);
  return !error;
}
