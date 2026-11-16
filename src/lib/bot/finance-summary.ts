// BL-28 (server only): the monthly finance summary in Telegram. On demand ("summary") and by itself on the 1st
// of each month at 09:30 for the month that just closed (once per month, claimed in reminder_log; quiet if the
// month has no transactions).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/bot/core";
import { loadSummaryData } from "@/lib/finance-summary-data";
import { monthOf, prevMonth, summarizeMonth, summaryText } from "@/lib/finance-summary";
import { localNow } from "@/lib/time";

type Reply = { text: string; kb: [] };

const SUMMARY_AT = 9 * 60 + 30; // 09:30 local
const WINDOW = 60;

/** "summary", "/summary", "resumen", "/resumen", optionally followed by "last month" / "mes pasado" / "YYYY-MM". */
export function parseSummaryCommand(text: string, today: string): { month: string } | null {
  const t = text.trim().toLowerCase().replace(/@\w+$/, "");
  const m = /^\/?(summary|resumen)(?:\s+(.+))?$/.exec(t);
  if (!m) return null;
  const arg = (m[2] ?? "").trim();
  const thisMonth = monthOf(today);
  if (!arg || ["this month", "este mes", "now", "so far"].includes(arg)) return { month: thisMonth };
  if (["last month", "mes pasado", "previous", "anterior"].includes(arg)) return { month: prevMonth(thisMonth) };
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(arg) && arg <= thisMonth) return { month: arg };
  return null;
}

export const isSummaryCommand = (text: string) => /^\/?(summary|resumen)\b/i.test(text.trim());

export async function summaryView(c: Ctx, month?: string): Promise<Reply> {
  try {
    const data = await loadSummaryData(c.admin, c.userId, c.tz);
    return { text: summaryText(summarizeMonth(data, month ?? monthOf(c.today), c.today)), kb: [] };
  } catch {
    return { text: "I could not read your finance data right now. Try again in a moment.", kb: [] };
  }
}

/**
 * Called by the 5-minute cron for each linked chat. On the 1st, 09:30–10:30 local, sends last month's summary once.
 * `claim` and `deliver` are passed in so tests can fake them. Returns how many messages it sent.
 */
export async function runFinanceSummaryCron(
  admin: SupabaseClient,
  s: { user_id: string; telegram_chat_id: number; timezone?: string | null },
  now: { date: string; minutes: number },
  io: { claim: (userId: string, kind: string, ref: string) => Promise<boolean>; deliver: (chatId: number, text: string) => Promise<void> }
): Promise<number> {
  if (!now.date.endsWith("-01")) return 0;
  if (now.minutes < SUMMARY_AT || now.minutes >= SUMMARY_AT + WINDOW) return 0;
  const month = prevMonth(monthOf(now.date));
  const tz = s.timezone || "America/Guayaquil";
  const data = await loadSummaryData(admin, s.user_id, tz);
  const summary = summarizeMonth(data, month, now.date);
  if (summary.totals.count === 0) return 0; // nothing logged: stay quiet
  if (!(await io.claim(s.user_id, "finance_summary", month))) return 0;
  await io.deliver(s.telegram_chat_id, summaryText(summary));
  return 1;
}

export { localNow };
