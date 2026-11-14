// Backlog rules, pure TypeScript mirror of the database trigger in migration 0061 (public.backlog_guard).
// The DATABASE is the authority (it also protects Claude writing through SQL). This file only gives the app early,
// friendly answers: which moves exist, what is missing before a move, the same error text the trigger would raise.
// scripts/fixtures/backlog-scenarios.json feeds BOTH this file's tests (npm run test:backlog) and the SQL tests
// (scripts/test-backlog-sql.mjs), so the two cannot drift apart without a test failing.

export const STATUSES = ["inbox", "later", "next", "now", "verifying", "done", "parked"] as const;
export type BacklogStatus = (typeof STATUSES)[number];
export const TYPES = ["feature", "improvement", "bug", "big_idea"] as const;
export type BacklogType = (typeof TYPES)[number];
export const SIZES = ["S", "M", "L"] as const;
export type BacklogSize = (typeof SIZES)[number];

export const TRANSITIONS: Record<BacklogStatus, BacklogStatus[]> = {
  inbox: ["later", "next", "now", "parked"],
  later: ["next", "now", "parked", "inbox"],
  next: ["now", "later", "parked"],
  now: ["verifying", "next", "later", "parked"],
  verifying: ["done", "now", "parked"],
  done: ["now", "parked"],
  parked: ["inbox", "later"],
};
/** A new item may start in these statuses only. */
export const CREATE_STATUSES: BacklogStatus[] = ["inbox", "later", "next", "now", "parked"];

export type Caps = { now: number; next: number; verifying: number };
export const DEFAULT_CAPS: Caps = { now: 2, next: 5, verifying: 3 };

/** How many OTHER items (never the one being moved) sit in each column. For `now`, bugs are not counted. */
export type Counts = { now?: number; next?: number; verifying?: number };

export type RuleItem = {
  type: BacklogType;
  status: BacklogStatus;
  size?: BacklogSize | null;
  spec_link?: string | null;
  parked_reason?: string | null;
};

export type MoveCheck = { ok: true; reopen: boolean } | { ok: false; message: string };

const blank = (s: string | null | undefined) => (s ?? "").trim() === "";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Same checks, same order, same text as the trigger. `item.status` is the CURRENT status (ignored on create). */
function checkTarget(
  item: RuleItem,
  to: BacklogStatus,
  counts: Counts,
  caps: Caps,
  reopen: boolean,
): MoveCheck {
  if ((to === "next" || to === "now") && !item.size && !(to === "now" && item.type === "bug")) {
    return { ok: false, message: `Set a size (S, M or L) before moving it to ${cap(to)}.` };
  }
  if (to === "now" && item.type !== "bug" && blank(item.spec_link)) {
    return { ok: false, message: "Add a spec link before moving it to Now." };
  }
  if (to === "now" && item.type !== "bug" && !reopen && (counts.now ?? 0) >= caps.now) {
    return { ok: false, message: `Now already has ${caps.now} items. Finish, verify or move one first.` };
  }
  if (to === "next" && (counts.next ?? 0) >= caps.next) {
    return { ok: false, message: `Next already has ${caps.next} items. Move one first.` };
  }
  if (to === "verifying" && (counts.verifying ?? 0) >= caps.verifying) {
    return { ok: false, message: `Verifying already has ${caps.verifying} items. Mark one done or reopen it first.` };
  }
  if (to === "parked" && blank(item.parked_reason)) {
    return { ok: false, message: "Give a reason before parking it." };
  }
  return { ok: true, reopen };
}

export function checkMove(item: RuleItem, to: BacklogStatus, counts: Counts = {}, caps: Caps = DEFAULT_CAPS): MoveCheck {
  if (item.status === to) return { ok: true, reopen: false };
  if (!TRANSITIONS[item.status].includes(to)) {
    return { ok: false, message: `Cannot move from ${item.status} to ${to}.` };
  }
  const reopen = (item.status === "verifying" || item.status === "done") && to === "now";
  return checkTarget(item, to, counts, caps, reopen);
}

export function checkCreate(item: RuleItem, counts: Counts = {}, caps: Caps = DEFAULT_CAPS): MoveCheck {
  if (!CREATE_STATUSES.includes(item.status)) {
    return { ok: false, message: `New items can start in inbox, later, next, now or parked, not ${item.status}.` };
  }
  return checkTarget(item, item.status, counts, caps, false);
}

/** What a move still needs from the user, so the UI can ask inline instead of failing. */
export type Missing = "size" | "spec_link" | "reason";
export function missingFor(item: RuleItem, to: BacklogStatus): Missing[] {
  const out: Missing[] = [];
  if ((to === "next" || to === "now") && !item.size && !(to === "now" && item.type === "bug")) out.push("size");
  if (to === "now" && item.type !== "bug" && blank(item.spec_link)) out.push("spec_link");
  if (to === "parked" && blank(item.parked_reason)) out.push("reason");
  return out;
}

export type MoveOption = { to: BacklogStatus; ok: boolean; message?: string; missing: Missing[]; reopen: boolean };
/** Every status the item could go to, with whether it would pass right now (caps) and what is missing. */
export function moveOptions(item: RuleItem, counts: Counts = {}, caps: Caps = DEFAULT_CAPS): MoveOption[] {
  return TRANSITIONS[item.status].map((to) => {
    const missing = missingFor(item, to);
    // Judge caps as if the missing fields were filled in; the UI collects them first.
    const filled: RuleItem = {
      ...item,
      size: item.size ?? (missing.includes("size") ? "S" : null),
      spec_link: missing.includes("spec_link") ? "x" : item.spec_link,
      parked_reason: missing.includes("reason") ? "x" : item.parked_reason,
    };
    const res = checkMove(filled, to, counts, caps);
    return {
      to,
      ok: res.ok,
      message: res.ok ? undefined : res.message,
      missing,
      reopen: res.ok ? res.reopen : (item.status === "verifying" || item.status === "done") && to === "now",
    };
  });
}

/** "BL-12" for number 12. */
export function itemCode(n: number): string {
  return `BL-${n}`;
}
/** "BL-12", "bl12", "#12" or "12" -> 12; anything else -> null. */
export function parseCode(text: string): number | null {
  const m = text.trim().match(/^(?:bl[-\s]?|#)?(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
}

/** An item is "due" for the real-use check once it has been Verifying for `days` days or more. */
export function verifyDue(verifyingSince: string | Date | null | undefined, now: Date, days = 7): boolean {
  if (!verifyingSince) return false;
  const since = typeof verifyingSince === "string" ? new Date(verifyingSince) : verifyingSince;
  if (Number.isNaN(since.getTime())) return false;
  return now.getTime() - since.getTime() >= days * 86_400_000;
}

/** Same trimming the trigger applies; the title is one line (max 200 characters). */
export function cleanTitle(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length === 0) return null;
  return t.length > 200 ? t.slice(0, 200).trim() : t;
}
