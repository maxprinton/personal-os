import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { addDays, formatDateLong, isoWeekday, localNow, utcToLocal, minutesToTime } from "@/lib/time";
import { deltaText, formatDuration, heatLevel, oneDecimal, sleepMinutes, type HeatCell } from "@/lib/daily-facts";
import Section from "@/components/ui/Section";
import CheckinForm from "@/components/insights/CheckinForm";
import { currentUserId, getBlockTypes } from "@/lib/calendar/model";
import { buildRows, findPatterns, UNLOCK_DAYS as UNLOCK } from "@/lib/patterns";
import { ringsToAnswer, type RingRow } from "@/lib/alarm-answers";

export const dynamic = "force-dynamic";

type Fact = {
  date: string;
  is_free_day: boolean;
  blocks_planned: number;
  blocks_done: number;
  habits_due: number;
  habits_done: number;
  tasks_completed: number;
  spent: number;
  notes_created: number;
  ai_calls: number;
  mood: number | null;
  energy: number | null;
  sleep_quality?: number | null;
  bedtime: string | null;
  wake_at: string | null;
  highlight: string | null;
  by_block: Record<string, { n: string; p: number; d: number; mp: number; md: number }> | null;
};

const CELL: Record<HeatCell, string> = {
  none: "bg-subtle-2",
  free: "bg-line",
  low: "bg-danger-solid/50",
  mid: "bg-warning-solid/70",
  good: "bg-success-solid/60",
  great: "bg-success-solid",
};

const UNLOCK_DAYS = UNLOCK;

export default async function InsightsPage() {
  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const weeksBack = 15;
  const monday = addDays(today, -(isoWeekday(today) - 1));
  const gridStart = addDays(monday, -weeksBack * 7);

  // Rebuild the last days from the raw data first, so the page never shows a stale number.
  await supabase.rpc("refresh_my_daily_facts", { p_from: addDays(today, -7), p_to: today });

  const userId = await currentUserId(supabase);
  const [factsRes, scoresRes, weeksRes, runwayRes, occRes, worthRes, rateRes, alarmRes] = await Promise.all([
    supabase.from("daily_facts").select("*").gte("date", gridStart).lte("date", today).order("date"),
    supabase.from("daily_scores").select("date,score,unlogged").gte("date", gridStart).lte("date", today),
    supabase.from("weekly_summary").select("*").order("week", { ascending: false }).limit(2),
    supabase.from("money_runway").select("*").maybeSingle(),
    supabase.from("block_occurrences").select("id,date,block_type_id,status,focus").gte("date", gridStart).lte("date", today).in("status", ["done", "partial"]),
    supabase.from("transactions").select("amount,worth_it").is("deleted_at", null).eq("type", "expense").eq("worth_it", false).gte("occurred_at", `${addDays(today, -27)}T00:00:00Z`),
    supabase.from("work_settings").select("substitute_rate").maybeSingle(),
    // Answers from the phone alarms, last 14 days (empty before migration 0059)
    supabase
      .from("alarm_events")
      .select("chain,kind,answer,seq,block_type_id,at")
      .eq("kind", "answer")
      .gte("at", new Date(Date.now() - 14 * 86_400_000).toISOString()),
  ]);
  const types = userId ? await getBlockTypes(supabase, userId, { includeDeleted: true }) : [];
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const occs = (occRes.data ?? []) as { id: string; date: string; block_type_id: string; focus: number | null }[];
  const blocksByDate: Record<string, { id: string; name: string; focus: number | null }[]> = {};
  for (const o of occs) {
    if (o.date < addDays(today, -6)) continue;
    (blocksByDate[o.date] ??= []).push({ id: o.id, name: typeName.get(o.block_type_id) ?? "Block", focus: o.focus });
  }

  const facts = (factsRes.data ?? []) as Fact[];
  const scores = new Map((scoresRes.data ?? []).map((s) => [s.date as string, s as { score: number | null; unlogged: boolean }]));
  const factOf = new Map(facts.map((f) => [f.date, f]));
  const pat = findPatterns(
    buildRows(
      facts,
      (scoresRes.data ?? []) as { date: string; score: number | null; unlogged: boolean }[],
      occs.filter((o) => o.focus !== null).map((o) => ({ date: o.date, focus: o.focus as number })),
      timezone
    )
  );
  const notWorth = (worthRes.error ? [] : (worthRes.data ?? [])) as { amount: number }[];
  const notWorthSum = notWorth.reduce((s, t) => s + Number(t.amount), 0);
  const rate = Number((rateRes.data as { substitute_rate: number | null } | null)?.substitute_rate ?? 0);
  const weeks = (weeksRes.data ?? []) as Record<string, number | string | null>[];
  const runway = runwayRes.data as { days_left: number | null; burn_per_day: number | null } | null;

  // ---- Check-in form: today and the last 6 days, with what is already saved ----
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, -i);
    return { value: d, label: i === 0 ? "Today" : i === 1 ? "Yesterday" : formatDateLong(d) };
  });
  const clock = (iso: string | null) => (iso ? minutesToTime(utcToLocal(iso, timezone).minutes) : "");
  const initial = Object.fromEntries(
    dates.map(({ value }) => {
      const f = factOf.get(value);
      return [value, { mood: f?.mood ?? null, energy: f?.energy ?? null, bed: clock(f?.bedtime ?? null), wake: clock(f?.wake_at ?? null), highlight: f?.highlight ?? "" }];
    })
  );

  // ---- Consistency map ----
  const cols = Array.from({ length: weeksBack + 1 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(gridStart, w * 7 + d);
      if (date > today) return { date, level: null as HeatCell | null, score: null as number | null };
      const s = scores.get(date);
      const f = factOf.get(date);
      return { date, level: heatLevel(s?.score ?? null, { unlogged: s?.unlogged ?? true, free: f?.is_free_day }), score: s?.score ?? null };
    })
  );
  const loggedDays = [...scores.values()].filter((s) => s.score !== null && !s.unlogged).length;

  // ---- This week vs last ----
  const w = weeks[0];
  const prev = weeks[1];
  const num = (r: Record<string, number | string | null> | undefined, k: string) => (r && r[k] !== null && r[k] !== undefined ? Number(r[k]) : null);

  // ---- Time by block (last 28 days) ----
  const since = addDays(today, -27);
  const byBlock = new Map<string, { planned: number; done: number }>();
  for (const f of facts) {
    if (f.date < since || !f.by_block) continue;
    for (const b of Object.values(f.by_block)) {
      const cur = byBlock.get(b.n) ?? { planned: 0, done: 0 };
      cur.planned += Number(b.mp ?? 0);
      cur.done += Number(b.md ?? 0);
      byBlock.set(b.n, cur);
    }
  }
  const blockRows = [...byBlock.entries()].filter(([, v]) => v.planned > 0).sort((a, b) => b[1].planned - a[1].planned).slice(0, 8);

  // ---- Notes / AI ----
  const last28 = facts.filter((f) => f.date >= since);
  const notes28 = last28.reduce((s, f) => s + Number(f.notes_created ?? 0), 0);
  const ai28 = last28.reduce((s, f) => s + Number(f.ai_calls ?? 0), 0);
  const spendDays = last28.filter((f) => Number(f.spent) > 0).length;

  const tile = (label: string, value: string, hint?: string) => (
    <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
  // ---- Phone alarms: how many rings each block takes, and how the answers went ----
  const alarmRows = (alarmRes.error ? [] : (alarmRes.data ?? [])) as RingRow[];
  const rings = ringsToAnswer(alarmRows);
  const answerTally = new Map<string, { started: number; done: number; partial: number; skipped: number; missed: number }>();
  for (const r of alarmRows) {
    if (!r.block_type_id) continue;
    const t = answerTally.get(r.block_type_id) ?? { started: 0, done: 0, partial: 0, skipped: 0, missed: 0 };
    if (r.answer === "started") t.started++;
    if (r.answer === "done" || r.answer === "already_done") t.done++;
    if (r.answer === "partial") t.partial++;
    if (r.answer === "skip") t.skipped++;
    if (r.answer === "not_done") t.missed++;
    answerTally.set(r.block_type_id, t);
  }
  const alarmBlocks = [...new Set([...rings.keys(), ...answerTally.keys()])]
    .map((id) => ({ id, name: typeName.get(id) ?? "Block", rings: rings.get(id) ?? null, tally: answerTally.get(id) }))
    .sort((a, b) => (b.rings?.chains ?? 0) - (a.rings?.chains ?? 0));
  const tallyText = (t?: { started: number; done: number; partial: number; skipped: number; missed: number }) =>
    t
      ? [
          t.started && `started ${t.started}`,
          t.done && `done ${t.done}`,
          t.partial && `partial ${t.partial}`,
          t.skipped && `skipped ${t.skipped}`,
          t.missed && `not done ${t.missed}`,
        ]
          .filter(Boolean)
          .join(", ")
      : "";

  const todayFact = factOf.get(today);
  const slept = todayFact ? sleepMinutes(todayFact.bedtime, todayFact.wake_at) : null;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted">
          Your days in numbers. Everything here is built from what you already mark; the check-in below is the only thing you type.
          Same inputs as Telegram: /checkin.
        </p>
      </div>

      <Section title="Check-in">
        {todayFact && (
          <p className="text-sm text-muted">
            Today: mood {todayFact.mood ?? "—"} · energy {todayFact.energy ?? "—"} · sleep {slept ? formatDuration(slept) : "—"}
            {todayFact.sleep_quality ? `, quality ${todayFact.sleep_quality}/5` : ""}
          </p>
        )}
        <CheckinForm dates={dates} initial={initial} blocks={blocksByDate} />
      </Section>

      <Section title="Consistency">
        <div className="overflow-x-auto rounded-lg border border-line bg-surface p-4 shadow-card">
          <div className="flex gap-1" role="img" aria-label="Daily score for the last 16 weeks">
            {cols.map((col, i) => (
              <div key={i} className="flex flex-col gap-1">
                {col.map((c) => (
                  <div
                    key={c.date}
                    title={c.level ? `${c.date}${c.score !== null ? ` · score ${Math.round(c.score)}` : ""}` : undefined}
                    className={`h-3.5 w-3.5 rounded-sm ${c.level ? CELL[c.level] : "bg-transparent"}`}
                  />
                ))}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Darker green = better day. Grey = free day, light = nothing marked. Rows are Mon to Sun.
          </p>
        </div>
      </Section>

      <Section title="This week">
        {w ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tile("Score", num(w, "score") === null ? "—" : String(Math.round(num(w, "score") as number)), `${deltaText(num(w, "score"), num(prev, "score") ?? num(w, "prev_score"))} vs last week`)}
              {tile("Days logged", String(num(w, "logged_days") ?? 0), "of 7")}
              {tile("Blocks / tasks done", `${num(w, "blocks_done") ?? 0} / ${num(w, "tasks_done") ?? 0}`)}
              {tile("Avg mood", oneDecimal(num(w, "mood")))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tile("Spent", `$${(num(w, "spent") ?? 0).toFixed(2)}`, `earned $${(num(w, "earned") ?? 0).toFixed(2)}`)}
              {tile("Spent = work hours", oneDecimal(num(w, "hours_of_life")), "at your teaching rate")}
              {tile("Teaching", `${oneDecimal(num(w, "work_hours"))} h`)}
              {tile("Notes", String(num(w, "notes") ?? 0))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">No weeks yet. Mark blocks, habits and tasks and this fills in.</p>
        )}
      </Section>

      <Section title="Time by block" count={blockRows.length}>
        {blockRows.length === 0 ? (
          <p className="text-sm text-muted">No planned blocks in the last 28 days.</p>
        ) : (
          <ul className="space-y-2 rounded-lg border border-line bg-surface p-4 shadow-card">
            {blockRows.map(([name, v]) => (
              <li key={name} className="space-y-1">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="truncate">{name}</span>
                  <span className="shrink-0 tabular-nums text-muted">{formatDuration(v.done)} of {formatDuration(v.planned)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.round((v.done / v.planned) * 100))}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Minutes done vs planned over the last 28 days.</p>
      </Section>

      <Section title="Phone alarms" count={alarmBlocks.length}>
        {alarmBlocks.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing yet. When you answer alarms on the phone (Started, Done, Skip today…), this shows how many rings each block takes you.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
            {alarmBlocks.map((b) => (
              <li key={b.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{b.name}</p>
                  {tallyText(b.tally) && <p className="text-xs text-muted">{tallyText(b.tally)}</p>}
                </div>
                {b.rings && (
                  <p className="shrink-0 text-right">
                    <span className="text-lg font-semibold tabular-nums">{b.rings.average}</span>
                    <span className="text-xs text-muted"> {b.rings.average === 1 ? "ring" : "rings"} to answer</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Last 14 days. 1 = you answered at the first ring; higher means the alarm had to repeat.</p>
      </Section>

      <Section title="Money and notes">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {runway?.days_left !== null && runway?.days_left !== undefined
            ? tile("Runway", `${Math.round(Number(runway.days_left))} days`, `at $${Number(runway.burn_per_day ?? 0).toFixed(2)}/day`)
            : tile("Runway", "—", `needs spending logged on 5 of the last 14 days (${spendDays} in 28 so far)`)}
          {tile("Notes, 28 days", String(notes28))}
          {tile("AI calls, 28 days", String(ai28))}
          {tile(
            "Not worth it, 28 days",
            `$${notWorthSum.toFixed(2)}`,
            notWorth.length ? `${notWorth.length} purchase${notWorth.length === 1 ? "" : "s"}${rate > 0 ? ` ≈ ${oneDecimal(notWorthSum / rate)} h of work` : ""}` : "mark purchases in Telegram or Finance"
          )}
        </div>
      </Section>

      <Section title="Patterns">
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4 shadow-card">
          <div className="h-1.5 overflow-hidden rounded-full bg-subtle-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.round((loggedDays / UNLOCK_DAYS) * 100))}%` }} />
          </div>
          {pat.unlocked ? (
            pat.patterns.length ? (
              <ul className="space-y-2">
                {pat.patterns.map((x) => (
                  <li key={x.id} className="text-sm">
                    {x.text} <span className="text-xs text-faint">({x.days} days)</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No clear pattern yet. A pattern needs at least 8 days on each side and a real difference, so quiet is normal.</p>
            )
          ) : (
            <p className="text-sm text-muted">
              {loggedDays} of {UNLOCK_DAYS} logged days. Patterns (sleep vs mood, late nights vs energy, mood vs spending…) unlock at {UNLOCK_DAYS}, so they compare you with you, not with noise.
            </p>
          )}
        </div>
      </Section>
    </main>
  );
}
