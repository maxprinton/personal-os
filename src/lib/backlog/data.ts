// Backlog: database access shared by the web actions, the Telegram bot and the cron (server only).
// Works with the signed-in client (RLS) AND the admin client (no RLS): EVERY query filters by user_id.
// The rules are enforced by the database trigger (migration 0061); checkMove here only gives the same answer first,
// so the person sees the plain message and the app can ask for a missing size/spec/reason.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_SETTINGS,
  ITEM_COLUMNS,
  capsFrom,
  countsFor,
  groupByStatus,
  positionFor,
  type BacklogItem,
  type BacklogSettings,
} from "@/lib/backlog/board";
import { SIZES, TYPES, checkCreate, checkMove, cleanTitle, type BacklogSize, type BacklogStatus, type BacklogType } from "@/lib/backlog/rules";

export const MIGRATION_FILE = "MIGRACION-0061-backlog.sql";
export const MISSING = `The Backlog isn't set up yet. In Supabase run ${MIGRATION_FILE}, then try again.`;

type DbError = { code?: string; message?: string } | null | undefined;
export const isMissing = (e: DbError) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /backlog_/.test(e.message ?? "") && /does not exist|schema cache/i.test(e.message ?? ""));
const friendly = (e: DbError) => (isMissing(e) ? MISSING : (e?.message ?? "Something went wrong.").replace(/^ERROR:\s*/i, ""));

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type BacklogEvent = { id: string; from_status: string | null; to_status: string; at: string; by: string; note: string | null };

export async function loadSettings(sb: SupabaseClient, userId: string): Promise<BacklogSettings> {
  const { data } = await sb
    .from("backlog_settings")
    .select("now_cap,next_cap,verifying_cap,verify_days,triage_prompt,monday_summary")
    .eq("user_id", userId)
    .maybeSingle();
  return { ...DEFAULT_SETTINGS, ...((data ?? {}) as Partial<BacklogSettings>) };
}

/** Every live item of the user. `missing` = the migration has not been run. */
export async function listItems(sb: SupabaseClient, userId: string): Promise<{ items: BacklogItem[]; missing: boolean; error?: string }> {
  const { data, error } = await sb.from("backlog_items").select(ITEM_COLUMNS).eq("user_id", userId).is("deleted_at", null).order("position").order("number").limit(2000);
  if (error) return { items: [], missing: isMissing(error), error: friendly(error) };
  return { items: (data ?? []) as unknown as BacklogItem[], missing: false };
}

export async function getItem(sb: SupabaseClient, userId: string, number: number): Promise<BacklogItem | null> {
  const { data } = await sb.from("backlog_items").select(ITEM_COLUMNS).eq("user_id", userId).eq("number", number).is("deleted_at", null).maybeSingle();
  return (data as unknown as BacklogItem | null) ?? null;
}

export async function listEvents(sb: SupabaseClient, userId: string, itemId: string): Promise<BacklogEvent[]> {
  const { data } = await sb.from("backlog_events").select("id,from_status,to_status,at,by,note").eq("user_id", userId).eq("item_id", itemId).order("at");
  return (data ?? []) as BacklogEvent[];
}

/** One sentence into the Inbox (or straight to Later when asked). */
export async function addItem(
  sb: SupabaseClient,
  userId: string,
  input: { title: string; type?: BacklogType; source: "web" | "telegram" | "claude" | "import"; status?: BacklogStatus; area?: string | null }
): Promise<Result<{ item: BacklogItem }>> {
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "Write the idea first." };
  const type = input.type && TYPES.includes(input.type) ? input.type : "feature";
  const status = input.status ?? "inbox";
  const check = checkCreate({ type, status });
  if (!check.ok) return { ok: false, error: check.message };
  const { data, error } = await sb
    .from("backlog_items")
    .insert({ user_id: userId, title, type, status, source: input.source, area: input.area?.trim() || null })
    .select(ITEM_COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: friendly(error) };
  return { ok: true, item: data as unknown as BacklogItem };
}

export type MoveFields = { size?: BacklogSize | null; spec_link?: string | null; parked_reason?: string | null };

/** Moves an item to another status, filling size / spec link / reason when the move needs them. */
export async function moveItem(
  sb: SupabaseClient,
  userId: string,
  number: number,
  to: BacklogStatus,
  fields: MoveFields = {}
): Promise<Result<{ item: BacklogItem; reopened: boolean }>> {
  const { items, missing, error } = await listItems(sb, userId);
  if (missing) return { ok: false, error: MISSING };
  if (error) return { ok: false, error };
  const cur = items.find((i) => i.number === number);
  if (!cur) return { ok: false, error: `BL-${number} was not found.` };
  const merged = {
    ...cur,
    size: fields.size === undefined ? cur.size : fields.size,
    spec_link: fields.spec_link === undefined ? cur.spec_link : fields.spec_link,
    parked_reason: fields.parked_reason === undefined ? cur.parked_reason : fields.parked_reason,
  };
  const settings = await loadSettings(sb, userId);
  const check = checkMove(merged, to, countsFor(items, cur.id), capsFrom(settings));
  if (!check.ok) return { ok: false, error: check.message };

  const patch: Record<string, unknown> = { status: to };
  if (fields.size !== undefined) patch.size = fields.size;
  if (fields.spec_link !== undefined) patch.spec_link = fields.spec_link?.trim() || null;
  if (fields.parked_reason !== undefined) patch.parked_reason = fields.parked_reason?.trim() || null;
  const { data, error: upErr } = await sb.from("backlog_items").update(patch).eq("id", cur.id).eq("user_id", userId).select(ITEM_COLUMNS).single();
  if (upErr || !data) return { ok: false, error: friendly(upErr) };
  return { ok: true, item: data as unknown as BacklogItem, reopened: check.reopen };
}

export type ItemPatch = {
  title?: string;
  type?: BacklogType;
  size?: BacklogSize | null;
  area?: string | null;
  spec_link?: string | null;
  notes?: string | null;
  value?: number | null;
  effort?: number | null;
};

const small = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : undefined;
};
const text = (v: string | null | undefined, max: number): string | null | undefined => (v === undefined ? undefined : (v ?? "").trim().slice(0, max) || null);

/** Edits the fields that do not change the status. */
export async function updateItem(sb: SupabaseClient, userId: string, number: number, p: ItemPatch): Promise<Result<{ item: BacklogItem }>> {
  const patch: Record<string, unknown> = {};
  if (p.title !== undefined) {
    const t = cleanTitle(p.title);
    if (!t) return { ok: false, error: "The title cannot be empty." };
    patch.title = t;
  }
  if (p.type !== undefined) {
    if (!TYPES.includes(p.type)) return { ok: false, error: "Unknown type." };
    patch.type = p.type;
  }
  if (p.size !== undefined) {
    if (p.size !== null && !SIZES.includes(p.size)) return { ok: false, error: "Size must be S, M or L." };
    patch.size = p.size;
  }
  const area = text(p.area, 60);
  if (area !== undefined) patch.area = area;
  const spec = text(p.spec_link, 300);
  if (spec !== undefined) patch.spec_link = spec;
  const notes = text(p.notes, 4000);
  if (notes !== undefined) patch.notes = notes;
  for (const k of ["value", "effort"] as const) {
    if (p[k] === undefined) continue;
    const n = small(p[k]);
    if (n === undefined) return { ok: false, error: `${k === "value" ? "Value" : "Effort"} must be 1, 2 or 3.` };
    patch[k] = n;
  }
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to change." };
  const { data, error } = await sb.from("backlog_items").update(patch).eq("user_id", userId).eq("number", number).is("deleted_at", null).select(ITEM_COLUMNS).maybeSingle();
  if (error) return { ok: false, error: friendly(error) };
  if (!data) return { ok: false, error: `BL-${number} was not found.` };
  return { ok: true, item: data as unknown as BacklogItem };
}

/** Puts an item before/after another one of the same column (manual order). */
export async function placeItem(sb: SupabaseClient, userId: string, number: number, targetNumber: number, where: "before" | "after"): Promise<Result> {
  const { items, error } = await listItems(sb, userId);
  if (error) return { ok: false, error };
  const cur = items.find((i) => i.number === number);
  const target = items.find((i) => i.number === targetNumber);
  if (!cur || !target || cur.status !== target.status) return { ok: false, error: "Both items must be in the same column." };
  const pos = positionFor(groupByStatus(items)[cur.status], cur.id, targetNumber, where);
  if (pos === null) return { ok: true };
  const { error: e } = await sb.from("backlog_items").update({ position: pos }).eq("id", cur.id).eq("user_id", userId);
  return e ? { ok: false, error: friendly(e) } : { ok: true };
}

export async function removeItem(sb: SupabaseClient, userId: string, number: number): Promise<Result> {
  const { error } = await sb.from("backlog_items").update({ deleted_at: new Date().toISOString() }).eq("user_id", userId).eq("number", number).is("deleted_at", null);
  return error ? { ok: false, error: friendly(error) } : { ok: true };
}

/** "Still testing": waits `days` more days before asking again. */
export async function pushVerify(sb: SupabaseClient, userId: string, number: number, days = 3): Promise<Result<{ item: BacklogItem }>> {
  const cur = await getItem(sb, userId, number);
  if (!cur || cur.status !== "verifying" || !cur.verifying_since) return { ok: false, error: `BL-${number} is not in Verifying.` };
  const next = new Date(new Date(cur.verifying_since).getTime() + days * 86_400_000).toISOString();
  const { data, error } = await sb.from("backlog_items").update({ verifying_since: next }).eq("id", cur.id).eq("user_id", userId).select(ITEM_COLUMNS).single();
  if (error || !data) return { ok: false, error: friendly(error) };
  return { ok: true, item: data as unknown as BacklogItem };
}

export type VerifyResult = "worked" | "failed" | "later";
/** The one-week check: worked → Done, did not work → back to Now (same item, reopen +1), still testing → +3 days. */
export async function resolveVerify(sb: SupabaseClient, userId: string, number: number, result: VerifyResult) {
  if (result === "later") return pushVerify(sb, userId, number, 3);
  return moveItem(sb, userId, number, result === "worked" ? "done" : "now");
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export async function saveSettings(sb: SupabaseClient, userId: string, s: Partial<BacklogSettings>): Promise<Result> {
  const cur = await loadSettings(sb, userId);
  const row = {
    user_id: userId,
    now_cap: clamp(s.now_cap ?? cur.now_cap, 1, 10, cur.now_cap),
    next_cap: clamp(s.next_cap ?? cur.next_cap, 1, 50, cur.next_cap),
    verifying_cap: clamp(s.verifying_cap ?? cur.verifying_cap, 1, 20, cur.verifying_cap),
    verify_days: clamp(s.verify_days ?? cur.verify_days, 1, 60, cur.verify_days),
    triage_prompt: s.triage_prompt ?? cur.triage_prompt,
    monday_summary: s.monday_summary ?? cur.monday_summary,
  };
  const { error } = await sb.from("backlog_settings").upsert(row, { onConflict: "user_id" });
  return error ? { ok: false, error: friendly(error) } : { ok: true };
}
