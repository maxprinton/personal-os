// Calendar and payments from Telegram (server only): events, free days, ✓ of a block, block notes,
// scheduled payments (create · pay · skip). Same rules as calendar-actions.ts, with the admin client.
import { addDays, dateRange, formatMinutes, timeToMinutes, zonedToUtc } from "@/lib/time";
import { getBlockTypes, getOccurrence, getOccurrences } from "@/lib/calendar/model";
import { getChecks, getHabits, recomputeOccurrenceStatus, setHabitCheck } from "@/lib/calendar/habits";
import { habitsForOccurrence } from "@/lib/calendar/habitview";
import { applyFreeDays, undoFreeDays } from "@/lib/calendar/freedays";
import { ensurePaymentEvents, getDuePayments, getPaymentTemplates, type DuePayment } from "@/lib/calendar/payments";
import { pickFocus } from "@/lib/calendar/focus";
import { findBlockNote, writeBlockNote } from "@/lib/block-notes";
import type { FreeDayPolicy, Occurrence } from "@/lib/calendar/types";
import { findAccount, stripAccount } from "@/lib/capture";
import { guessCategory } from "@/lib/parse";
import type { Ctx } from "@/lib/bot/core";
import { usd } from "@/lib/bot/core";
import { btn, logAction, pk, undoRow, type Btn, type Kb } from "@/lib/bot/tg";
import { bestMatches, shortDay, wdDay } from "@/lib/bot/text";
import { describeRepeat, type EventCmd, type FreeDayCmd, type PaymentCmd } from "@/lib/bot/intents";

type Reply = { text: string; kb: Kb };
const hm = (t: string) => formatMinutes(timeToMinutes(t));

// ---- Events --------------------------------------------------------------------------------

export async function createEvent(c: Ctx, raw: string, e: EventCmd): Promise<Reply> {
  let start_time: string | null = null;
  let end_time: string | null = null;
  let endDate = e.endDate;
  if (e.start && e.end) {
    start_time = zonedToUtc(e.date, e.start, c.tz).toISOString();
    end_time = zonedToUtc(endDate, e.end, c.tz).toISOString();
    if (e.end === "00:00" && endDate > e.date) endDate = addDays(endDate, -1);
  }
  const { data, error } = await c.admin
    .from("events")
    .insert({ user_id: c.userId, title: e.title, event_date: e.date, end_date: endDate, start_time, end_time })
    .select("id")
    .single();
  if (error || !data) return { text: `Could not save the event (${error?.message ?? "unknown error"}).`, kb: [] };
  const logId = await logAction(c.admin, c.userId, raw, "event", data.id as string);
  const when =
    e.date === e.endDate || (e.start && endDate === e.date)
      ? `${shortDay(e.date)}${e.start ? ` · ${hm(e.start)}–${hm(e.end!)}` : " · all day"}`
      : `${shortDay(e.date)} → ${shortDay(e.endDate)}${e.start ? ` · ${hm(e.start)}–${hm(e.end!)}` : ""}`;
  return { text: `Saved ✓ Event: ${e.title} · ${when}`, kb: undoRow(logId) };
}

// ---- Free days -------------------------------------------------------------------------------

/** Asks what happens to the tasks of those days (the free day is saved after the tap). */
export async function askFreeDay(c: Ctx, raw: string, f: FreeDayCmd): Promise<Reply> {
  if (f.to < c.today) return { text: "Those days are already past.", kb: [] };
  const from = f.from < c.today ? c.today : f.from;
  const { data: bm } = await c.admin
    .from("bot_messages")
    .insert({ user_id: c.userId, raw_text: raw.slice(0, 4000), status: "parsed", parsed: { kind: "freeday_pending", from, to: f.to, note: f.note } })
    .select("id")
    .single();
  if (!bm) return { text: "Sorry, I could not do that.", kb: [] };
  const k = pk(bm.id as string);
  const days = from === f.to ? shortDay(from) : `${shortDay(from)} → ${shortDay(f.to)} (${dateRange(from, f.to).length} days)`;
  return {
    text: `🌴 Free day: ${days}${f.note ? ` · ${f.note}` : ""}\nYour weekly blocks pause and streaks are on hold. What happens to the tasks of ${from === f.to ? "that day" : "those days"}?`,
    kb: [
      [btn("➡ Move them to the next day", `fd:${k}:m`)],
      [btn("🏠 To their home block's next time", `fd:${k}:h`)],
      [btn("📥 Leave them without a block", `fd:${k}:u`)],
      [btn("Cancel", `fd:${k}:x`)],
    ],
  };
}

/** Saves the free day (joined with free days next to it, like the web). */
export async function saveFreeDay(c: Ctx, raw: string, from: string, to: string, note: string | null, policy: FreeDayPolicy): Promise<Reply> {
  const { data: near } = await c.admin
    .from("free_days")
    .select("id,from_date,to_date,note")
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .lte("from_date", addDays(to, 1))
    .gte("to_date", addDays(from, -1));
  const old = (near ?? []) as { id: string; from_date: string; to_date: string; note: string | null }[];
  let start = from;
  let end = to;
  for (const r of old) {
    if (r.from_date < start) start = r.from_date;
    if (r.to_date > end) end = r.to_date;
  }
  const covered = (d: string) => old.some((r) => r.from_date <= d && d <= r.to_date);
  const fresh = dateRange(from, to).filter((d) => !covered(d));
  if (!fresh.length) return { text: "Those days are already free.", kb: [] };
  const { data: row, error } = await c.admin
    .from("free_days")
    .insert({ user_id: c.userId, from_date: start, to_date: end, task_policy: policy, note: note ?? old.find((r) => r.note)?.note ?? null })
    .select("id")
    .single();
  if (error || !row) return { text: `Could not save the free day (${error?.message ?? "unknown error"}).`, kb: [] };
  if (old.length) {
    await c.admin.from("free_days").update({ deleted_at: new Date().toISOString() }).eq("user_id", c.userId).in("id", old.map((r) => r.id));
  }
  let runStart = fresh[0];
  for (let i = 0; i < fresh.length; i++) {
    if (i === fresh.length - 1 || fresh[i + 1] !== addDays(fresh[i], 1)) {
      await applyFreeDays(c.admin, c.userId, runStart, fresh[i], policy, c.today, end);
      if (i < fresh.length - 1) runStart = fresh[i + 1];
    }
  }
  const logId = await logAction(c.admin, c.userId, raw, "free_day", row.id as string, { from: start, to: end });
  const days = start === end ? shortDay(start) : `${shortDay(start)} → ${shortDay(end)}`;
  return { text: `🌴 Saved ✓ Free day: ${days}${old.length ? " (joined with the free days next to it)" : ""}`, kb: undoRow(logId) };
}

/** Undo of a free day: today and later come back (days already past stay free). */
export async function removeFreeDay(c: Ctx, id: string) {
  const { data: f } = await c.admin
    .from("free_days")
    .select("id,from_date,to_date")
    .eq("id", id)
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!f) return "That free day was already removed.";
  const from = f.from_date as string;
  const to = f.to_date as string;
  if (to < c.today) return "Those days are already past, so they stay free.";
  if (from < c.today) await c.admin.from("free_days").update({ to_date: addDays(c.today, -1) }).eq("id", f.id).eq("user_id", c.userId);
  else await c.admin.from("free_days").update({ deleted_at: new Date().toISOString() }).eq("id", f.id).eq("user_id", c.userId);
  await undoFreeDays(c.admin, c.userId, from, to, c.today);
  return "↩ Free day removed: your blocks are back.";
}

// ---- ✓ of a block ------------------------------------------------------------------------------

/** Ticks every habit of the block and marks it done; tapping again reopens it (like the web). */
export async function toggleBlockDone(c: Ctx, occId: string): Promise<{ ok: boolean; text: string; done?: boolean; name?: string }> {
  const occ = await getOccurrence(c.admin, c.userId, occId);
  if (!occ) return { ok: false, text: "That block is no longer on the calendar." };
  if (occ.date > c.today) return { ok: false, text: "You can only tick a block once its day has come." };
  if (occ.date < addDays(c.today, -1)) return { ok: false, text: "That day is closed. Fix it on the computer." };
  if (occ.status === "free_day" || occ.status === "cancelled") return { ok: false, text: "This block is not active that day." };
  const makeDone = occ.status !== "done";
  const [habits, checks, types] = await Promise.all([
    getHabits(c.admin, c.userId, { includeRemoved: true }),
    getChecks(c.admin, c.userId, occ.date, occ.date),
    getBlockTypes(c.admin, c.userId, { includeDeleted: true }),
  ]);
  for (const { habit, state } of habitsForOccurrence(occ, habits, checks, c.today)) {
    if (!makeDone && state === "done") await setHabitCheck(c.admin, c.userId, habit.id, occ, null, "telegram");
    if (makeDone && state !== "done") await setHabitCheck(c.admin, c.userId, habit.id, occ, "done", "telegram");
  }
  const status = makeDone ? "done" : "scheduled";
  const { error } = await c.admin.from("block_occurrences").update({ status, done_manually: makeDone }).eq("id", occ.id).eq("user_id", c.userId);
  if (error) await c.admin.from("block_occurrences").update({ status }).eq("id", occ.id).eq("user_id", c.userId);
  await recomputeOccurrenceStatus(c.admin, c.userId, occ.id, c.today);
  const name = types.find((t) => t.id === occ.block_type_id)?.name ?? "Block";
  return { ok: true, done: makeDone, name, text: makeDone ? `✓ ${name} done (its habits too)` : `↩ ${name} is open again` };
}

export const blockDoneRow = (occId: string, name: string, done: boolean): Btn[] => [
  btn(done ? `↩ Reopen ${name}` : `✓ ${name} done`, `bd:${pk(occId)}`),
];

// ---- Block notes ---------------------------------------------------------------------------

export async function appendBlockNote(c: Ctx, raw: string, blockQuery: string | null, body: string): Promise<Reply> {
  const types = await getBlockTypes(c.admin, c.userId);
  let name: string | null = null;
  if (blockQuery) {
    const found = bestMatches(types, blockQuery, (t) => t.name);
    if (found.length !== 1) {
      return {
        text: found.length > 1
          ? `“${blockQuery}” matches several blocks: ${found.map((t) => t.name).join(", ")}. Write more of the name.`
          : `I don't have a block called “${blockQuery}”. Your blocks: ${types.map((t) => t.name).join(", ") || "none yet"}.`,
        kb: [],
      };
    }
    name = found[0].name;
  } else {
    const occs = await getOccurrences(c.admin, c.userId, c.today, c.today);
    const focus = pickFocus(occs, c.today, c.nowMin);
    if (!focus || focus.mode !== "now") {
      return { text: "You're not in a block right now. Name it: “nb Gym: text”.", kb: [] };
    }
    name = types.find((t) => t.id === focus.occ.block_type_id)?.name ?? null;
    if (!name) return { text: "Could not find the block of right now.", kb: [] };
  }
  const prev = await findBlockNote(c.admin, c.userId, name);
  const content = prev?.content?.trim() ? `${prev.content.trimEnd()}\n${body}` : body;
  try {
    const id = await writeBlockNote(c.admin, c.userId, name, content);
    const logId = await logAction(c.admin, c.userId, raw, "block_note", id, { name, prev: prev ? prev.content : null });
    return { text: `📝 Added to the note of ${name}:\n${body}`, kb: undoRow(logId) };
  } catch (e) {
    return { text: e instanceof Error ? `Could not save the note (${e.message}).` : "Could not save the note.", kb: [] };
  }
}

// ---- Payments ---------------------------------------------------------------------------------

type Account = { id: string; name: string };

async function accountsOf(c: Ctx): Promise<Account[]> {
  const { data } = await c.admin.from("accounts").select("id,name").eq("user_id", c.userId).is("deleted_at", null).order("created_at");
  return (data ?? []) as Account[];
}

export const payRow = (p: Pick<DuePayment, "eventId" | "title" | "date" | "expected" | "template">, today: string): Btn[] => {
  const amt = p.expected ?? p.template?.expected_amount ?? null;
  return [
    btn(`💳 ${p.title}${amt ? ` ${usd(amt)}` : ""}${p.date < today ? " ⚠" : ""}`, `py:${pk(p.eventId)}`),
    btn("Skip", `pk:${pk(p.eventId)}`),
  ];
};

export async function duePayments(c: Ctx) {
  return getDuePayments(c.admin, c.userId, c.today);
}

/** /payments: what is due (with 💳 Pay / Skip) and what is coming in the next 3 weeks. */
export async function paymentsView(c: Ctx): Promise<Reply> {
  const [due, upcomingRes, templates] = await Promise.all([
    getDuePayments(c.admin, c.userId, c.today),
    c.admin
      .from("events")
      .select("id,title,event_date,payment_template_id,payment_expected_amount")
      .eq("user_id", c.userId)
      .is("deleted_at", null)
      .eq("is_payment", true)
      .is("payment_status", null)
      .gt("event_date", c.today)
      .lte("event_date", addDays(c.today, 21))
      .order("event_date"),
    getPaymentTemplates(c.admin, c.userId),
  ]);
  const tAmount = new Map(templates.map((t) => [t.id, t.expected_amount]));
  type Up = { id: string; title: string; event_date: string; payment_template_id: string | null; payment_expected_amount: number | string | null };
  const upcoming = (upcomingRes.data ?? []) as Up[];
  const L: string[] = ["💳 Payments"];
  if (due.length) {
    L.push("", "Due now:");
    for (const p of due) {
      const amt = p.expected ?? p.template?.expected_amount ?? null;
      L.push(`• ${p.title}${amt ? ` ${usd(amt)}` : ""} · ${p.date < c.today ? `overdue since ${shortDay(p.date)}` : "today"}`);
    }
  } else {
    L.push("", "Nothing due now. ✓");
  }
  if (upcoming.length) {
    L.push("", "Next 3 weeks:");
    for (const u of upcoming) {
      const amt = u.payment_expected_amount !== null ? Number(u.payment_expected_amount) : u.payment_template_id ? tAmount.get(u.payment_template_id) ?? null : null;
      L.push(`• ${shortDay(u.event_date)} · ${u.title}${amt ? ` ${usd(amt)}` : ""}`);
    }
  }
  if (!templates.length) L.push("", "No scheduled payments yet. Add one: “payment: internet 32 monthly on the 10th”.");
  return { text: L.join("\n"), kb: due.slice(0, 10).map((p) => payRow(p, c.today)) };
}

async function paymentEvent(c: Ctx, eventId: string) {
  const { data } = await c.admin
    .from("events")
    .select("id,title,event_date,is_payment,payment_status,payment_template_id,payment_expected_amount")
    .eq("id", eventId)
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data || !data.is_payment) return null;
  const templates = data.payment_template_id ? await getPaymentTemplates(c.admin, c.userId) : [];
  const template = templates.find((t) => t.id === data.payment_template_id) ?? null;
  const expected = data.payment_expected_amount !== null ? Number(data.payment_expected_amount) : template?.expected_amount ?? null;
  return {
    id: data.id as string,
    title: data.title as string,
    date: data.event_date as string,
    status: data.payment_status as string | null,
    templateId: data.payment_template_id as string | null,
    template,
    expected,
  };
}

/** The account used the last time this payment was paid, else the payment's own account. */
async function suggestedAccount(c: Ctx, templateId: string | null, templateAccount: string | null) {
  if (!templateId) return null;
  const { data } = await c.admin
    .from("transactions")
    .select("account_id")
    .eq("user_id", c.userId)
    .eq("payment_template_id", templateId)
    .is("deleted_at", null)
    .not("account_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.account_id as string | undefined) ?? templateAccount;
}

/** 💳: the suggested account first (with the expected amount), then the others, another amount, no account. */
export async function payMenu(c: Ctx, eventId: string, again = false): Promise<Reply> {
  const ev = await paymentEvent(c, eventId);
  if (!ev) return { text: "That payment no longer exists.", kb: [] };
  if (ev.date > c.today) return { text: `${ev.title} is due ${shortDay(ev.date)}. You can pay it on its day or later.`, kb: [] };
  const k = pk(ev.id);
  if (ev.status === "paid" && !again) {
    return {
      text: `⚠ ${ev.title} (${shortDay(ev.date)}) is already marked as paid. Record another payment anyway?`,
      kb: [[btn("Yes, record another", `pA:${k}`), btn("No", `px:${k}`)]],
    };
  }
  const accounts = await accountsOf(c);
  const suggested = await suggestedAccount(c, ev.templateId, ev.template?.account_id ?? null);
  const ordered = [...accounts].sort((a, b) => (a.id === suggested ? -1 : b.id === suggested ? 1 : 0));
  const v = again ? "pC" : "pc";
  const rows: Kb = [];
  if (ev.expected) {
    for (let i = 0; i < ordered.length; i += 2) {
      rows.push(ordered.slice(i, i + 2).map((a) => btn(`${a.id === suggested ? "⭐ " : ""}${usd(ev.expected!)} · ${a.name}`, `${v}:${k}:${pk(a.id)}`)));
    }
    rows.push([btn(`${usd(ev.expected)} · no account`, `${v}:${k}:n`)]);
  }
  rows.push([btn("✍️ Another amount", `pO:${k}:${suggested ? pk(suggested) : "n"}`), btn("Skip this one", `pk:${k}`)]);
  rows.push([btn("✕ Close", `px:${k}`)]);
  const head = `💳 ${ev.title} · ${ev.date < c.today ? `due since ${shortDay(ev.date)}` : "due today"}${ev.expected ? ` · expected ${usd(ev.expected)}` : ""}`;
  const hint = ev.expected
    ? suggested
      ? "⭐ = the account you used last time. Tap the account you paid with:"
      : "Tap the account you paid with:"
    : "No expected amount: tap ✍️ and write what you paid (you can add the account: “32.50 pichincha”).";
  return { text: `${head}\n${hint}`, kb: rows };
}

/** Records the real transaction of a payment and marks it paid (like confirmPayment on the web). */
export async function confirmPay(c: Ctx, eventId: string, accountId: string | null, amount: number | null, again: boolean): Promise<Reply & { ok: boolean; txnId?: string }> {
  const ev = await paymentEvent(c, eventId);
  if (!ev) return { ok: false, text: "That payment no longer exists.", kb: [] };
  if (ev.status === "paid" && !again) return { ok: false, text: `${ev.title} is already paid.`, kb: [] };
  if (ev.date > c.today) return { ok: false, text: "You can confirm a payment on its day or later.", kb: [] };
  const value = amount ?? ev.expected;
  if (!value || value <= 0) return { ok: false, text: "Write the real amount (above 0).", kb: [] };
  const accounts = await accountsOf(c);
  const account = accountId ? accounts.find((a) => a.id === accountId) ?? null : null;
  const { data: txn, error } = await c.admin
    .from("transactions")
    .insert({
      user_id: c.userId,
      type: ev.template?.type === "income" ? "income" : "expense",
      amount: value,
      description: ev.title,
      account_id: account?.id ?? null,
      category_id: ev.template?.category_id ?? null,
      occurred_at: ev.date === c.today ? new Date().toISOString() : zonedToUtc(ev.date, "12:00", c.tz).toISOString(),
      event_id: ev.id,
      payment_template_id: ev.templateId,
      source: "telegram_bot",
    })
    .select("id")
    .single();
  if (error || !txn) return { ok: false, text: `Could not save the payment (${error?.message ?? "unknown error"}).`, kb: [] };
  await c.admin.from("events").update({ payment_status: "paid", payment_transaction_id: txn.id }).eq("id", ev.id).eq("user_id", c.userId);
  const logId = await logAction(c.admin, c.userId, "(pay)", "payment_paid", txn.id as string, { eventId: ev.id });
  return {
    ok: true,
    txnId: txn.id as string,
    text: `✓ Paid ${ev.title}: ${usd(value)}${account ? ` · ${account.name}` : " · no account"}`,
    kb: undoRow(logId),
  };
}

export async function skipPay(c: Ctx, eventId: string): Promise<Reply & { ok: boolean }> {
  const ev = await paymentEvent(c, eventId);
  if (!ev) return { ok: false, text: "That payment no longer exists.", kb: [] };
  if (ev.status === "paid") return { ok: false, text: `${ev.title} is already paid.`, kb: [] };
  await c.admin.from("events").update({ payment_status: "skipped" }).eq("id", ev.id).eq("user_id", c.userId).eq("is_payment", true);
  const logId = await logAction(c.admin, c.userId, "(skip payment)", "payment_skip", ev.id);
  return { ok: true, text: `⏭ Skipped ${ev.title} (${shortDay(ev.date)})`, kb: undoRow(logId) };
}

/** "payment: internet 32 monthly on the 10th" → a scheduled payment and its events. */
export async function createPaymentTemplate(c: Ctx, raw: string, p: PaymentCmd): Promise<Reply> {
  const accounts = await accountsOf(c);
  const found = findAccount(p.rest, accounts);
  let name = p.name;
  if (found) {
    name = stripAccount(p.name, found.needle).replace(/\s+(?:con|with|from|desde|de|en|por)$/i, "").trim() || p.name;
  }
  const { data: cats } = await c.admin.from("categories").select("id,name,kind").eq("user_id", c.userId).is("deleted_at", null);
  const ofKind = ((cats ?? []) as { id: string; name: string; kind: string }[]).filter((x) => x.kind === p.type);
  const catName = guessCategory(name, ofKind.map((x) => x.name));
  const category = catName ? ofKind.find((x) => x.name.toLowerCase() === catName.toLowerCase()) ?? null : null;
  const { data: t, error } = await c.admin
    .from("payment_templates")
    .insert({
      user_id: c.userId,
      name,
      type: p.type,
      expected_amount: p.amount,
      account_id: found?.account.id ?? null,
      category_id: category?.id ?? null,
      repeat_unit: p.unit,
      repeat_every: p.every,
      start_date: p.start,
      end_date: null,
    })
    .select("id")
    .single();
  if (error || !t) return { text: `Could not save the payment (${error?.message ?? "unknown error"}).`, kb: [] };
  await ensurePaymentEvents(c.admin, c.userId, c.today, t.id as string, p.start < c.today ? p.start : c.today);
  const logId = await logAction(c.admin, c.userId, raw, "payment_template", t.id as string);
  const parts = [
    `Saved ✓ ${p.type === "income" ? "Scheduled income" : "Scheduled payment"}: ${name}`,
    p.amount ? usd(p.amount) : "no expected amount",
    `${describeRepeat(p.unit, p.every)}${p.unit === "none" ? ` on ${shortDay(p.start)}` : ` from ${shortDay(p.start)}`}`,
    found ? found.account.name : null,
    category ? category.name : null,
  ].filter(Boolean);
  return { text: parts.join(" · "), kb: undoRow(logId) };
}

// ---- Small helpers used by views ------------------------------------------------------------

export function occLabel(o: Pick<Occurrence, "start_time" | "date">, name: string, today: string) {
  return `${name} ${o.date === today ? "" : `${wdDay(o.date)} `}${hm(o.start_time)}`;
}
