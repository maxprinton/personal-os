// Backlog texts for Telegram (pure: they get the data, so the tests need no database or network).
//  · parse "idea: …" / "bug: …" / "/idea …" / "/bug …"
//  · /backlog (Now, Verifying, Next, Inbox count), /ideas (the Inbox)
//  · the "did it work?" nudge, the 30-second triage, the Monday summary
import {
  STATUS_LABEL,
  TYPE_EMOJI,
  daysSince,
  doneSince,
  groupByStatus,
  staleNext,
  verifyDueItems,
  type BacklogItem,
  type BacklogSettings,
  type Brief,
  type Triage,
} from "@/lib/backlog/board";
import { itemCode } from "@/lib/backlog/rules";

export type Capture = { type: "feature" | "bug"; title: string };

/**
 * "idea: dark mode", "Idea : dark mode", "/idea dark mode", "/idea@MyBot dark mode" → feature;
 * "bug: tasks vanish", "/bug tasks vanish" → bug. "/idea" alone → null (the bot explains how to use it).
 */
export function parseBacklogCapture(text: string): Capture | null {
  const t = text.trim();
  const m = /^(idea|bug)\s*:\s*([\s\S]+)$/i.exec(t) ?? /^\/(idea|bug)(?:@\w+)?\s+([\s\S]+)$/i.exec(t);
  if (!m) return null;
  const title = m[2].replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return null;
  return { type: m[1].toLowerCase() === "bug" ? "bug" : "feature", title };
}
/** "/idea" or "/bug" alone: the person forgot the text. */
export const isCaptureHelp = (text: string) => /^\/(?:idea|bug)(?:@\w+)?$/i.test(text.trim());
/** "/backlog", "backlog". */
export const isBacklogView = (text: string) => /^\/?backlog(?:@\w+)?$/i.test(text.trim());
/** "/ideas", "ideas". */
export const isIdeasView = (text: string) => /^\/?ideas(?:@\w+)?$/i.test(text.trim());

const line = (i: Brief) => `${TYPE_EMOJI[i.type]} ${itemCode(i.number)} ${i.title}${i.size ? ` · ${i.size}` : ""}`;

export function captureReply(item: Pick<BacklogItem, "number" | "type" | "title">): string {
  return `${TYPE_EMOJI[item.type]} ${itemCode(item.number)} saved to the Inbox.`;
}
export const CAPTURE_HELP = "Write it after the command, one sentence. Example: /idea show the week on Today · /bug a task vanished after I moved it";

export function backlogText(items: BacklogItem[], settings: BacklogSettings, now: Date): string {
  const g = groupByStatus(items);
  const due = new Set(verifyDueItems(items, now, settings.verify_days).map((i) => i.number));
  const nonBugNow = g.now.filter((i) => i.type !== "bug").length;
  const out: string[] = ["📋 Backlog"];
  out.push(`\n🔨 Now (${nonBugNow}/${settings.now_cap})`);
  out.push(...(g.now.length ? g.now.map((i) => line(i)) : ["Nothing in Now. Pull one from Next."]));
  if (g.verifying.length) {
    out.push(`\n🔎 Verifying (${g.verifying.length}/${settings.verifying_cap})`);
    out.push(
      ...g.verifying.map((i) => {
        const d = daysSince(i.verifying_since, now);
        return `${line(i)} · ${d} day${d === 1 ? "" : "s"}${due.has(i.number) ? " ⚠️ did it work?" : ""}`;
      })
    );
  }
  out.push(`\n⏭ Next (${g.next.length}/${settings.next_cap})`);
  out.push(...(g.next.length ? g.next.slice(0, 6).map((i) => line(i)) : ["Empty."]));
  if (g.next.length > 6) out.push(`…and ${g.next.length - 6} more`);
  out.push(`\n📥 Inbox: ${g.inbox.length}${g.inbox.length ? " · /ideas" : ""}   🕓 Later: ${g.later.length}`);
  return out.join("\n");
}

export function ideasText(items: BacklogItem[]): string {
  const inbox = groupByStatus(items).inbox;
  if (!inbox.length) return "📥 Inbox is empty. Send idea: … or bug: … and it lands here.";
  const out = [`📥 Inbox (${inbox.length})`, "", ...inbox.slice(0, 15).map((i) => `${TYPE_EMOJI[i.type]} ${itemCode(i.number)} ${i.title}`)];
  if (inbox.length > 15) out.push(`…and ${inbox.length - 15} more`);
  return out.join("\n");
}

/** One item waiting for its real-use answer. */
export function verifyNudgeText(item: BacklogItem, now: Date): string {
  const d = daysSince(item.verifying_since, now);
  return `🔎 ${itemCode(item.number)} ${item.title}\nIt has been in real use for ${d} day${d === 1 ? "" : "s"}. Did it work?`;
}

/** The 30-second triage: Now, the top of Next, the Inbox. */
export function triageText(t: Triage, title?: string): string {
  const out: string[] = [];
  if (title) out.push(title, "");
  out.push(`🔨 Now (${t.nowCount}/${t.nowCap})`);
  out.push(...(t.now.length ? t.now.map(line) : ["Nothing in Now."]));
  out.push("", `⏭ Top of Next${t.nextCount > t.next.length ? ` (${t.nextCount} in all)` : ""}`);
  out.push(...(t.next.length ? t.next.map(line) : ["Next is empty."]));
  out.push("", `📥 Inbox: ${t.inbox}${t.verifying ? `   🔎 Verifying: ${t.verifying}` : ""}`);
  return out.join("\n");
}

/** Monday morning: what happened and what waits. null when there is nothing worth a message. */
export function mondaySummaryText(items: BacklogItem[], settings: BacklogSettings, now: Date): string | null {
  const g = groupByStatus(items);
  const done = doneSince(items, now, 7);
  const due = verifyDueItems(items, now, settings.verify_days);
  const stale = staleNext(items, now, 30);
  if (!done.length && !g.now.length && !due.length && !g.inbox.length && !stale.length) return null;
  const out: string[] = ["📋 Backlog · week summary"];
  if (done.length) out.push("", `✅ Done last week (${done.length})`, ...done.slice(0, 6).map((i) => `${itemCode(i.number)} ${i.title}`));
  out.push("", `🔨 Now (${g.now.filter((i) => i.type !== "bug").length}/${settings.now_cap})`, ...(g.now.length ? g.now.map((i) => line(i)) : ["Nothing. Pull one from Next."]));
  if (due.length) out.push("", `🔎 Waiting for your answer (${due.length})`, ...due.map((i) => `${itemCode(i.number)} ${i.title} · ${daysSince(i.verifying_since, now)} days`));
  if (stale.length) out.push("", `🕸 In Next for 30+ days (${stale.length})`, ...stale.slice(0, 4).map((i) => `${itemCode(i.number)} ${i.title}`), "Still wanted? Move it down or park it.");
  out.push("", `📥 Inbox: ${g.inbox.length}`);
  return out.join("\n");
}

export { STATUS_LABEL };
