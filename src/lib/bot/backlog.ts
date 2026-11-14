// Backlog in Telegram (server only):
//  · "idea: …" / "bug: …" / "/idea …" / "/bug …"  → one sentence into the Inbox
//  · "/backlog" → Now, Verifying, Next, Inbox count;  "/ideas" → the Inbox
//  · buttons "bl:<action>:<number>": ✅ it worked / ❌ it did not / ⏳ still testing / ⬆ pull to Now / skip
//  · cron: the daily "did it work in real use?" question and the Monday summary
// The admin client skips RLS: EVERY query filters by user_id (lib/backlog/data.ts does).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/bot/core";
import { btn, type Kb } from "@/lib/bot/tg";
import { isoWeekday } from "@/lib/time";
import { MISSING, addItem, listItems, loadSettings, moveItem, resolveVerify } from "@/lib/backlog/data";
import { triageSnapshot, verifyDueItems, type Triage } from "@/lib/backlog/board";
import { CAPTURE_HELP, backlogText, captureReply, ideasText, mondaySummaryText, triageText, verifyNudgeText, type Capture } from "@/lib/backlog/text";
import { itemCode } from "@/lib/backlog/rules";

type Reply = { text: string; kb: Kb };

export async function handleBacklogCapture(c: Ctx, cap: Capture | "help"): Promise<Reply> {
  if (cap === "help") return { text: CAPTURE_HELP, kb: [] };
  const r = await addItem(c.admin, c.userId, { title: cap.title, type: cap.type, source: "telegram" });
  if (!r.ok) return { text: r.error, kb: [] };
  return { text: captureReply(r.item), kb: [] };
}

export async function backlogView(c: Ctx): Promise<Reply> {
  const { items, missing, error } = await listItems(c.admin, c.userId);
  if (missing) return { text: MISSING, kb: [] };
  if (error) return { text: error, kb: [] };
  const settings = await loadSettings(c.admin, c.userId);
  const text = backlogText(items, settings, new Date());
  const due = verifyDueItems(items, new Date(), settings.verify_days).slice(0, 3);
  return { text, kb: due.map((i) => verifyKb(i.number)[0]) };
}

export async function ideasView(c: Ctx): Promise<Reply> {
  const { items, missing, error } = await listItems(c.admin, c.userId);
  if (missing) return { text: MISSING, kb: [] };
  if (error) return { text: error, kb: [] };
  return { text: ideasText(items), kb: [] };
}

/** ✅ worked · ❌ did not work · ⏳ still testing, for one item. */
export function verifyKb(number: number): Kb {
  return [[btn(`✅ ${itemCode(number)} worked`, `bl:w:${number}`), btn("❌ No", `bl:x:${number}`), btn("⏳ +3 days", `bl:t:${number}`)]];
}

/** The 30-second prompt: pull one of the top of Next into Now, or skip. */
export function triageKb(t: Triage): Kb {
  const rows: Kb = t.nowCount < t.nowCap ? t.next.map((i) => [btn(`⬆ ${itemCode(i.number)} to Now`, `bl:n:${i.number}`)]) : [];
  rows.push([btn("Skip", "bl:s:0")]);
  return rows;
}

export type BlResult = { toast: string; alert?: boolean; text?: string; kb?: Kb; followUp?: Reply };

async function triageReply(c: Ctx, title: string): Promise<Reply | null> {
  const { items, missing } = await listItems(c.admin, c.userId);
  if (missing) return null;
  const settings = await loadSettings(c.admin, c.userId);
  if (!settings.triage_prompt) return null;
  const t = triageSnapshot(items, settings);
  return { text: triageText(t, title), kb: triageKb(t) };
}

/** A tapped "bl:<action>:<number>" button. */
export async function backlogCallback(c: Ctx, action: string, arg: string): Promise<BlResult> {
  const number = Number(arg);
  if (action === "s") return { toast: "Skipped.", text: "👍 Skipped.", kb: [] };
  if (!Number.isInteger(number) || number < 1) return { toast: "This button has expired.", alert: true };
  const code = itemCode(number);

  if (action === "w" || action === "x" || action === "t") {
    const r = await resolveVerify(c.admin, c.userId, number, action === "w" ? "worked" : action === "x" ? "failed" : "later");
    if (!r.ok) return { toast: r.error, alert: true };
    if (action === "t") return { toast: "⏳ Asking again in 3 days", text: `⏳ ${code} ${r.item.title}\nOkay, I'll ask again in 3 days.`, kb: [] };
    if (action === "x") return { toast: "Back in Now", text: `↩ ${code} ${r.item.title}\nBack in Now (reopened). Tell Claude what did not work.`, kb: [] };
    return {
      toast: "Done ✓",
      text: `✅ ${code} ${r.item.title}\nDone. It worked in real use.`,
      kb: [],
      followUp: (await triageReply(c, "What's next?")) ?? undefined,
    };
  }

  if (action === "n") {
    const r = await moveItem(c.admin, c.userId, number, "now");
    if (!r.ok) return { toast: r.error, alert: true };
    const again = await triageReply(c, `🔨 ${code} ${r.item.title} is in Now.`);
    return { toast: "In Now", text: again?.text ?? `🔨 ${code} ${r.item.title} is in Now.`, kb: again?.kb ?? [] };
  }
  return { toast: "This button has expired.", alert: true };
}

// ---- Cron ------------------------------------------------------------------------------------

const VERIFY_AT = 9 * 60 + 30; // 09:30 local: the "did it work?" question
const WEEKLY_AT = 8 * 60 + 30; // Monday 08:30 local: the week summary
const WINDOW = 60;

/**
 * Called by the 5-minute cron for each linked chat. At most one "did it work?" round per day and one summary per
 * Monday (claims in reminder_log). Returns how many messages it sent. `claim` and `deliver` are passed in for tests.
 */
export async function runBacklogCron(
  admin: SupabaseClient,
  s: { user_id: string; telegram_chat_id: number },
  now: { date: string; minutes: number },
  io: { claim: (userId: string, kind: string, ref: string) => Promise<boolean>; deliver: (chatId: number, text: string, kb?: Kb) => Promise<void> },
  at: Date = new Date()
): Promise<number> {
  const verifyWindow = now.minutes >= VERIFY_AT && now.minutes < VERIFY_AT + WINDOW;
  const weeklyWindow = isoWeekday(now.date) === 1 && now.minutes >= WEEKLY_AT && now.minutes < WEEKLY_AT + WINDOW;
  if (!verifyWindow && !weeklyWindow) return 0;
  const { items, missing } = await listItems(admin, s.user_id);
  if (missing || !items.length) return 0;
  const settings = await loadSettings(admin, s.user_id);
  let sent = 0;

  if (weeklyWindow && settings.monday_summary) {
    const text = mondaySummaryText(items, settings, at);
    if (text && (await io.claim(s.user_id, "backlog_weekly", now.date))) {
      await io.deliver(s.telegram_chat_id, text);
      sent++;
    }
  }
  if (verifyWindow) {
    const due = verifyDueItems(items, at, settings.verify_days).slice(0, 3);
    if (due.length && (await io.claim(s.user_id, "backlog_verify", now.date))) {
      for (const i of due) {
        await io.deliver(s.telegram_chat_id, verifyNudgeText(i, at), verifyKb(i.number));
        sent++;
      }
    }
  }
  return sent;
}
