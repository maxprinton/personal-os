// Telegram side of the Portfolio add-on (Phase 8):
//  · "/portfolio" (or "/portafolio") → one line per page with its status, per language
//  · "/inbox" (or "/bandeja") → the latest messages from the site's contact form (read only; does not mark them as read)
//  · weekly nudge → Monday morning: pages changed since they went live (can be turned off in Portfolio → Settings)
// The text builders are pure (they get the data) so they can be tested without a database.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/bot/core";
import type { Kb } from "@/lib/bot/tg";
import { LANGS, type Lang } from "@/lib/portfolio/constants";
import { KIND_LABEL } from "@/lib/portfolio/slots";
import { sortSlots } from "@/lib/portfolio/slots";
import { loadSlotViews } from "@/lib/portfolio/link";
import { listInbox, unreadCount, type InboxRow } from "@/lib/portfolio/inbox";
import { loadSite } from "@/lib/portfolio/site";
import type { PageStatus, SlotView } from "@/lib/portfolio/types";
import { appUrl } from "@/lib/bot/youtube-nudges";

type View = { text: string; kb: Kb };

const ICON: Record<PageStatus, string> = { published: "✅", changed: "🟠", draft: "📝", unpublished: "⏸", no_note: "▫️", trashed: "🗑" };
const WORD: Record<PageStatus, string> = {
  published: "live",
  changed: "changed since published",
  draft: "draft, not published",
  unpublished: "unpublished",
  no_note: "no note",
  trashed: "note in trash",
};

/** True for "/portfolio", "/portafolio", "portfolio" alone. */
export const isPortfolioSummary = (text: string) => /^\/?(?:portfolio|portafolio)(?:@\w+)?$/i.test(text.trim());
/** True for "/inbox", "/bandeja", "inbox" alone. */
export const isInboxRequest = (text: string) => /^\/?(?:inbox|bandeja)(?:@\w+)?$/i.test(text.trim());

const linkTo = (path: string) => {
  const base = appUrl();
  return base ? `\n${base}${path}` : "";
};

function labelOf(slot: SlotView, lang: Lang): string {
  const title = slot.pages[lang].note?.title;
  const name = title && title !== "Untitled" ? title : slot.key;
  return slot.kind === "project" || slot.kind === "article" ? `${KIND_LABEL[slot.kind]}: ${name}` : KIND_LABEL[slot.kind];
}

/** Which languages of a slot have anything to show (a note or a public row). */
const activeLangs = (slot: SlotView) => LANGS.filter((l) => slot.pages[l].status !== "no_note");

export function portfolioText(slots: SlotView[], unread = 0): string {
  const live = sortSlots(slots.filter((s) => !s.archived));
  if (!live.length) return "🌐 Portfolio\nNo pages yet. Create the first one in Portfolio → Pages." + linkTo("/portfolio/pages");
  const counts: Record<PageStatus, number> = { published: 0, changed: 0, draft: 0, unpublished: 0, no_note: 0, trashed: 0 };
  const lines: string[] = [];
  for (const s of live) {
    const langs = activeLangs(s);
    if (!langs.length) {
      lines.push(`${ICON.no_note} ${labelOf(s, "en")} — ${WORD.no_note}`);
      continue;
    }
    // same status in every language → one line
    const sts = langs.map((l) => s.pages[l].status);
    for (const st of sts) counts[st]++;
    if (new Set(sts).size === 1) lines.push(`${ICON[sts[0]]} ${labelOf(s, langs[0])} (${langs.map((l) => l.toUpperCase()).join("+")}) — ${WORD[sts[0]]}`);
    else for (const l of langs) lines.push(`${ICON[s.pages[l].status]} ${labelOf(s, l)} (${l.toUpperCase()}) — ${WORD[s.pages[l].status]}`);
  }
  const head = [`🌐 Portfolio · ${counts.published + counts.changed} live`];
  if (counts.changed) head.push(`🟠 ${counts.changed} changed since published`);
  if (counts.draft) head.push(`📝 ${counts.draft} draft${counts.draft === 1 ? "" : "s"}`);
  if (unread) head.push(`📬 ${unread} unread message${unread === 1 ? "" : "s"} · /inbox`);
  return [head.join("  ·  "), "", ...lines.slice(0, 40), lines.length > 40 ? `…and ${lines.length - 40} more` : "", "Publishing is done on the computer." + linkTo("/portfolio")].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
}

export async function portfolioView(c: Ctx): Promise<View> {
  const { slots, missing } = await loadSlotViews(c.admin, c.userId);
  if (missing) return { text: "🌐 Portfolio isn't set up yet. Turn it on in Add-ons and run its migration.", kb: [] };
  const unread = await unreadCount(c.admin, c.userId).catch(() => 0);
  return { text: portfolioText(slots, unread), kb: [] };
}

// ---- Inbox ------------------------------------------------------------------------------------

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string, now = new Date()): string {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function inboxText(rows: InboxRow[], unread: number, now = new Date()): string {
  if (!rows.length) return "📬 Inbox\nNo messages from the site yet." + linkTo("/portfolio/inbox");
  const L = [`📬 Inbox · ${unread} unread`, ""];
  for (const m of rows.slice(0, 5)) {
    const who = [oneLine(m.name ?? "", 40) || "Anonymous", m.email ? oneLine(m.email, 60) : null, m.lang ? m.lang.toUpperCase() : null].filter(Boolean).join(" · ");
    L.push(`${m.read_at ? "▫️" : "🔵"} ${who} · ${ago(m.created_at, now)}`, `   “${oneLine(m.message, 180)}”`);
  }
  if (rows.length > 5) L.push("", `…and ${rows.length - 5} more`);
  L.push("", "Reply and mark as read on the computer." + linkTo("/portfolio/inbox"));
  return L.join("\n");
}

export async function inboxView(c: Ctx): Promise<View> {
  try {
    const rows = (await listInbox(c.admin, c.userId, false)).slice(0, 6);
    const unread = await unreadCount(c.admin, c.userId);
    return { text: inboxText(rows, unread), kb: [] };
  } catch {
    return { text: "Sorry, I couldn't read the inbox. Try again.", kb: [] };
  }
}

// ---- Weekly nudge -------------------------------------------------------------------------------

/** Monday = 1 … Sunday = 7, for a local date "YYYY-MM-DD". */
export function weekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** "2026-W45": the key that makes the nudge go out once per week. */
export function weekKey(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Thursday of this ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The nudge message, or null when there is nothing to say. */
export function nudgeText(slots: SlotView[]): string | null {
  const changed: string[] = [];
  const trashed: string[] = [];
  for (const s of sortSlots(slots.filter((x) => !x.archived))) {
    for (const l of LANGS) {
      const st = s.pages[l].status;
      if (st === "changed") changed.push(`• ${labelOf(s, l)} (${l.toUpperCase()})`);
      else if (st === "trashed" && s.pages[l].published?.is_live) trashed.push(`• ${labelOf(s, l)} (${l.toUpperCase()})`);
    }
  }
  if (!changed.length && !trashed.length) return null;
  const L = ["🌐 Portfolio · weekly check"];
  if (changed.length) L.push("", `🟠 ${changed.length} page${changed.length === 1 ? "" : "s"} changed since you published ${changed.length === 1 ? "it" : "them"}:`, ...changed.slice(0, 10), changed.length > 10 ? `…and ${changed.length - 10} more` : "");
  if (trashed.length) L.push("", "🗑 Live pages whose note is in the trash (the public page still shows the old version):", ...trashed.slice(0, 5));
  L.push("", "Review and republish on the computer." + linkTo("/portfolio/pages"), "To stop this message: Portfolio → Settings.");
  return L.filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
}

const NUDGE_HOUR = 10 * 60; // Monday 10:00 local time
const NUDGE_WINDOW = 60;

/**
 * Called by the 5-minute cron for each linked chat. Sends at most once per week (claim in reminder_log).
 * Returns how many messages it sent (0 or 1). `claim` and `deliver` are passed in so this stays testable.
 */
export async function runPortfolioNudge(
  admin: SupabaseClient,
  s: { user_id: string; timezone: string; telegram_chat_id: number },
  now: { date: string; minutes: number },
  io: { claim: (userId: string, kind: string, ref: string) => Promise<boolean>; deliver: (chatId: number, text: string) => Promise<void> }
): Promise<number> {
  if (weekday(now.date) !== 1 || now.minutes < NUDGE_HOUR || now.minutes >= NUDGE_HOUR + NUDGE_WINDOW) return 0;
  const { site, missing } = await loadSite(admin, s.user_id);
  if (missing || !site.nudge_weekly) return 0;
  if (!(await io.claim(s.user_id, "portfolio_nudge", weekKey(now.date)))) return 0;
  const { slots } = await loadSlotViews(admin, s.user_id);
  const text = nudgeText(slots);
  if (!text) return 0;
  await io.deliver(s.telegram_chat_id, text);
  return 1;
}
