// Needs & Wants list (BL-116): pure helpers shared by the Finance page, the server actions, Telegram and the tests.
// No database access here.

export type PurchaseKind = "need" | "want";
export type PurchaseStatus = "open" | "bought";

export type PurchaseItem = {
  id: string;
  name: string;
  price: number | null;
  kind: PurchaseKind;
  status: PurchaseStatus;
  position: number;
  transaction_id: string | null;
  source: "web" | "telegram";
  bought_at: string | null;
  created_at: string;
  /** For Bought items: the linked transaction as it is now (null = the transaction is gone). */
  txn?: { amount: number; occurred_at: string } | null;
};

export const KIND_LABEL: Record<PurchaseKind, string> = { need: "Needed", want: "Wanted" };
export const MISSING_TABLE = "The Needs & Wants list needs migration 0073. Run MIGRACION-0073-needs-and-wants.sql in Supabase.";
export const CAPTURE_HELP =
  "Write the item after need: or want:, with the price at the end if you know it. Examples: need: sandals 25 · want: headphones 79.99 · need: pants";

/** Trims and collapses inner spaces: "  new   pants " -> "new pants". */
export function normName(name: string): string {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** What makes two names "the same item": case and extra spaces ignored (matches the database index). */
export function dupKey(name: string): string {
  return normName(name).toLowerCase();
}

/** "25", "$25", "25.50", "25,50", "1,234.50" -> number; empty -> null; anything else / <= 0 -> NaN. */
export function parsePrice(v: unknown): number | null {
  let s = String(v ?? "").trim().replace(/^\$/, "").replace(/\s/g, "");
  if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ""); // 1,234.50
  else s = s.replace(",", "."); // 25,50
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Math.round(Number(s) * 100) / 100;
  return n > 0 ? n : NaN;
}

export type Capture = { kind: PurchaseKind; name: string; price: number | null };

/**
 * Telegram: "need: sandals 25", "want: headphones $79.99", "/need pants", "/want@MyBot a new chair".
 * A number at the very end is the price; a name that is only a number is kept as the name (no price).
 * Returns null when the text is not a need/want capture.
 */
export function parseCapture(text: string): Capture | null {
  const t = String(text ?? "").trim();
  const m = /^(need|want)\s*:\s*([\s\S]+)$/i.exec(t) ?? /^\/(need|want)(?:@\w+)?\s+([\s\S]+)$/i.exec(t);
  if (!m) return null;
  const kind: PurchaseKind = m[1].toLowerCase() === "need" ? "need" : "want";
  const body = normName(m[2]);
  if (!body) return null;
  const pm = /^(.*\S)\s+(\$?\d[\d.,]*)$/.exec(body);
  if (pm) {
    const price = parsePrice(pm[2]);
    if (price !== null && !Number.isNaN(price)) return { kind, name: normName(pm[1]), price };
  }
  return { kind, name: body, price: null };
}

/** "/need" or "/want" alone: the person forgot the item. */
export const isCaptureHelp = (text: string) => /^\/(?:need|want)(?:@\w+)?$/i.test(String(text ?? "").trim());

/** Open items of one list, in the user's order (position, then oldest first). */
export function listOf(items: PurchaseItem[], kind: PurchaseKind): PurchaseItem[] {
  return items
    .filter((i) => i.status === "open" && i.kind === kind)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

/** Bought items, newest first. */
export function boughtOf(items: PurchaseItem[]): PurchaseItem[] {
  return items
    .filter((i) => i.status === "bought")
    .sort((a, b) => (b.bought_at ?? "").localeCompare(a.bought_at ?? ""));
}

/** Count, sum of known prices, and how many have no price. */
export function totals(list: PurchaseItem[]): { count: number; sum: number; noPrice: number } {
  let sum = 0;
  let noPrice = 0;
  for (const i of list) {
    if (i.price === null) noPrice++;
    else sum += i.price;
  }
  return { count: list.length, sum: Math.round(sum * 100) / 100, noPrice };
}

/** Next position at the bottom of a list. */
export function nextPosition(items: PurchaseItem[], kind: PurchaseKind): number {
  const l = listOf(items, kind);
  return l.length ? Math.max(...l.map((i) => i.position)) + 1 : 0;
}

/** Ids of a list after moving one item one step up or down (unchanged at the edges). */
export function moveStep(ids: string[], id: string, dir: "up" | "down"): string[] {
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Ids of a list after dragging `id` to the place of `targetId` (drag on desktop). */
export function moveTo(ids: string[], id: string, targetId: string): string[] {
  if (id === targetId) return ids;
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return ids;
  const out = ids.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

/** The open item with the same name (case and spaces ignored), if any; `exceptId` skips the item itself. */
export function findOpenDuplicate(items: PurchaseItem[], name: string, exceptId?: string): PurchaseItem | null {
  const k = dupKey(name);
  return items.find((i) => i.status === "open" && i.id !== exceptId && dupKey(i.name) === k) ?? null;
}

export function duplicateMessage(dup: Pick<PurchaseItem, "name" | "kind">): string {
  return `“${dup.name}” is already on your ${KIND_LABEL[dup.kind]} list.`;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Telegram reply after saving. */
export function captureReply(item: Pick<PurchaseItem, "name" | "price" | "kind">, countInList: number): string {
  return `🛒 Added to ${KIND_LABEL[item.kind]}: ${item.name}${item.price !== null ? ` · ${usd(item.price)}` : ""} (${countInList} in ${KIND_LABEL[item.kind]}). Mark it Bought in Finance when you buy it.`;
}

/** Supabase error = the table is not there yet (migration 0073 not run). */
export function isMissingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || (/purchase_items/.test(e.message ?? "") && /does not exist|schema cache/i.test(e.message ?? ""));
}

/** Supabase error = the unique "same name in Needed/Wanted" index refused it. */
export const isDuplicateError = (e: { code?: string } | null | undefined) => e?.code === "23505";
