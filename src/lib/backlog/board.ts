// Backlog: item type and the pure helpers the screens, the bot and the tests share (no database here).
import { DEFAULT_CAPS, STATUSES, type BacklogSize, type BacklogStatus, type BacklogType, type Caps, type Counts } from "@/lib/backlog/rules";

export type BacklogItem = {
  id: string;
  number: number;
  title: string;
  type: BacklogType;
  status: BacklogStatus;
  size: BacklogSize | null;
  area: string | null;
  spec_link: string | null;
  notes: string | null;
  parked_reason: string | null;
  value: number | null;
  effort: number | null;
  position: number;
  source: string;
  reopened_count: number;
  created_at: string;
  status_changed_at: string;
  verifying_since: string | null;
  done_at: string | null;
};

export const ITEM_COLUMNS =
  "id,number,title,type,status,size,area,spec_link,notes,parked_reason,value,effort,position,source,reopened_count,created_at,status_changed_at,verifying_since,done_at";

export type BacklogSettings = {
  now_cap: number;
  next_cap: number;
  verifying_cap: number;
  verify_days: number;
  triage_prompt: boolean;
  monday_summary: boolean;
};
export const DEFAULT_SETTINGS: BacklogSettings = {
  now_cap: DEFAULT_CAPS.now,
  next_cap: DEFAULT_CAPS.next,
  verifying_cap: DEFAULT_CAPS.verifying,
  verify_days: 7,
  triage_prompt: true,
  monday_summary: true,
};

export const capsFrom = (s: BacklogSettings): Caps => ({ now: s.now_cap, next: s.next_cap, verifying: s.verifying_cap });

/** Column order on screen: what is being worked on first. */
export const STATUS_ORDER: BacklogStatus[] = ["now", "verifying", "next", "later", "inbox", "parked", "done"];
/** Board order: left to right along the flow. */
export const BOARD_ORDER: BacklogStatus[] = ["inbox", "later", "next", "now", "verifying", "done", "parked"];
export const STATUS_LABEL: Record<BacklogStatus, string> = {
  inbox: "Inbox",
  later: "Later",
  next: "Next",
  now: "Now",
  verifying: "Verifying",
  done: "Done",
  parked: "Parked",
};
export const STATUS_HINT: Record<BacklogStatus, string> = {
  inbox: "Captured, not decided",
  later: "Maybe, not soon",
  next: "Up next (needs a size)",
  now: "Building now",
  verifying: "Built, proving itself in real use",
  done: "Worked in real use",
  parked: "Not doing it, with the reason",
};
export const TYPE_LABEL: Record<BacklogType, string> = { feature: "Feature", improvement: "Improvement", bug: "Bug", big_idea: "Big idea" };
export const TYPE_EMOJI: Record<BacklogType, string> = { feature: "✨", improvement: "🔧", bug: "🐞", big_idea: "🌱" };

const byPosition = (a: BacklogItem, b: BacklogItem) => a.position - b.position || a.number - b.number;

export function groupByStatus(items: BacklogItem[]): Record<BacklogStatus, BacklogItem[]> {
  const out = Object.fromEntries(STATUSES.map((s) => [s, [] as BacklogItem[]])) as Record<BacklogStatus, BacklogItem[]>;
  for (const it of items) out[it.status].push(it);
  for (const s of STATUSES) out[s].sort(s === "done" ? (a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "") : byPosition);
  return out;
}

/** How many OTHER items sit in each capped column (bugs are not counted for Now). */
export function countsFor(items: BacklogItem[], excludeId?: string): Required<Counts> {
  let now = 0;
  let next = 0;
  let verifying = 0;
  for (const it of items) {
    if (it.id === excludeId) continue;
    if (it.status === "now" && it.type !== "bug") now++;
    else if (it.status === "next") next++;
    else if (it.status === "verifying") verifying++;
  }
  return { now, next, verifying };
}

export function daysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export type Filters = { q?: string; type?: BacklogType | ""; area?: string; size?: BacklogSize | "" };
export function filterItems(items: BacklogItem[], f: Filters): BacklogItem[] {
  const q = (f.q ?? "").trim().toLowerCase();
  const code = q.replace(/^bl[-\s]?/, "");
  return items.filter((it) => {
    if (f.type && it.type !== f.type) return false;
    if (f.size && it.size !== f.size) return false;
    if (f.area && (it.area ?? "") !== f.area) return false;
    if (!q) return true;
    return (
      it.title.toLowerCase().includes(q) ||
      (it.notes ?? "").toLowerCase().includes(q) ||
      (it.area ?? "").toLowerCase().includes(q) ||
      (/^\d+$/.test(code) && String(it.number) === code)
    );
  });
}

export function areasOf(items: BacklogItem[]): string[] {
  return [...new Set(items.map((i) => (i.area ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Value divided by effort (both 1-3). null when either is missing. */
export function rankScore(it: Pick<BacklogItem, "value" | "effort">): number | null {
  if (!it.value || !it.effort) return null;
  return Math.round((it.value / it.effort) * 100) / 100;
}
/** Scored items first (best ratio, then higher value), unscored keep their order after them. */
export function sortByScore<T extends Pick<BacklogItem, "value" | "effort" | "position" | "number">>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const sa = rankScore(a);
    const sb = rankScore(b);
    if (sa !== null && sb !== null) return sb - sa || (b.value ?? 0) - (a.value ?? 0) || a.position - b.position;
    if (sa !== null) return -1;
    if (sb !== null) return 1;
    return a.position - b.position || a.number - b.number;
  });
}

/** A position between two neighbours (either may be missing: top or bottom of the column). */
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1;
  if (prev === null) return (next as number) - 1;
  if (next === null) return prev + 1;
  return (prev + next) / 2;
}

/**
 * The position that puts `movingId` right before/after the item numbered `targetNumber` in a column
 * (`column` is that column in order). null = it is already there.
 */
export function positionFor(column: BacklogItem[], movingId: string, targetNumber: number, where: "before" | "after"): number | null {
  const rest = column.filter((i) => i.id !== movingId);
  const idx = rest.findIndex((i) => i.number === targetNumber);
  if (idx < 0) return null;
  const before = where === "before" ? (idx > 0 ? rest[idx - 1].position : null) : rest[idx].position;
  const after = where === "before" ? rest[idx].position : idx + 1 < rest.length ? rest[idx + 1].position : null;
  const pos = positionBetween(before, after);
  const me = column.find((i) => i.id === movingId);
  return me && me.position === pos ? null : pos;
}

export type Brief = Pick<BacklogItem, "number" | "title" | "type" | "size">;
const brief = (i: BacklogItem): Brief => ({ number: i.number, title: i.title, type: i.type, size: i.size });

export type Triage = {
  now: Brief[];
  nowCount: number;
  nowCap: number;
  next: Brief[];
  nextCount: number;
  inbox: number;
  verifying: number;
};
/** The 30-second prompt: what is in Now, the top of Next, how much waits in the Inbox. */
export function triageSnapshot(items: BacklogItem[], settings: BacklogSettings): Triage {
  const g = groupByStatus(items);
  return {
    now: g.now.map(brief),
    nowCount: g.now.filter((i) => i.type !== "bug").length,
    nowCap: settings.now_cap,
    next: g.next.slice(0, 3).map(brief),
    nextCount: g.next.length,
    inbox: g.inbox.length,
    verifying: g.verifying.length,
  };
}

/** Items waiting for the "did it work in real use?" answer. */
export function verifyDueItems(items: BacklogItem[], now: Date, days: number): BacklogItem[] {
  return items.filter((i) => i.status === "verifying" && i.verifying_since && now.getTime() - new Date(i.verifying_since).getTime() >= days * 86_400_000);
}

/** Next items that have been sitting for `days` days or more. */
export function staleNext(items: BacklogItem[], now: Date, days = 30): BacklogItem[] {
  return items.filter((i) => i.status === "next" && daysSince(i.status_changed_at, now) >= days);
}

export function doneSince(items: BacklogItem[], now: Date, days = 7): BacklogItem[] {
  return items.filter((i) => i.status === "done" && i.done_at && now.getTime() - new Date(i.done_at).getTime() <= days * 86_400_000);
}

/** Fill of a stage's cap meter on the dashboard: 0-100 and whether the stage is at its cap. No cap (null) means no meter. */
export function capMeter(count: number, cap: number | null): { pct: number; full: boolean } | null {
  if (cap === null || cap <= 0) return null;
  return { pct: Math.min(100, Math.round((count / cap) * 100)), full: count >= cap };
}

/** The first `limit` items and how many are hidden (the dashboard panels and tabs show a few and offer the rest). */
export function peek<T>(list: T[], limit: number): { shown: T[]; hidden: number } {
  return { shown: list.slice(0, limit), hidden: Math.max(0, list.length - limit) };
}
