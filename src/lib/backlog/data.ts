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

// ---- Claude's activity feed (migration 0062): what Claude is doing and did, newest first ----
export type ActivityRow = {
  id: string;
  kind: "start" | "update" | "finish" | "blocked" | "note" | "decision";
  text: string;
  at: string;
  work_id: string | null;
  item: { number: number; title: string } | null;
};

export async function listActivity(sb: SupabaseClient, userId: string, opts: { limit?: number; itemId?: string } = {}): Promise<{ rows: ActivityRow[]; working: ActivityRow[] }> {
  let q = sb.from("backlog_activity").select("id,kind,text,at,work_id,item_id").eq("user_id", userId).order("at", { ascending: false }).limit(opts.limit ?? 30);
  if (opts.itemId) q = q.eq("item_id", opts.itemId);
  const { data, error } = await q;
  if (error || !data) return { rows: [], working: [] };
  const ids = Array.from(new Set(data.map((r) => r.item_id).filter((x): x is string => !!x)));
  const byId = new Map<string, { number: number; title: string }>();
  if (ids.length) {
    const { data: items } = await sb.from("backlog_items").select("id,number,title").eq("user_id", userId).in("id", ids);
    for (const i of items ?? []) byId.set(i.id as string, { number: i.number as number, title: i.title as string });
  }
  const rows: ActivityRow[] = data.map((r) => ({ id: r.id, kind: r.kind, text: r.text, at: r.at, work_id: r.work_id, item: r.item_id ? byId.get(r.item_id) ?? null : null }));
  const finished = new Set(rows.filter((r) => r.kind === "finish" && r.work_id).map((r) => r.work_id));
  const working = rows.filter((r) => r.kind === "start" && !finished.has(r.id));
  return { rows, working };
}

// ---- Waiting-on-you queue (migration 0063): steps the user must do outside the app ----
export type StepRow = {
  id: string;
  kind: "migration" | "publish" | "keys" | "other";
  title: string;
  detail: string | null;
  ref: string | null;
  status: "pending" | "done" | "skipped";
  check_result: "unchecked" | "verified" | "mismatch";
  check_note: string | null;
  asked_at: string;
  done_at: string | null;
  item: { number: number; title: string } | null;
};

export async function listSteps(sb: SupabaseClient, userId: string, opts: { status?: "pending" | "done"; limit?: number } = {}): Promise<StepRow[]> {
  let q = sb
    .from("backlog_steps")
    .select("id,kind,title,detail,ref,status,check_result,check_note,asked_at,done_at,item_id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order(opts.status === "done" ? "done_at" : "asked_at", { ascending: false })
    .limit(opts.limit ?? 30);
  if (opts.status === "pending") q = q.eq("status", "pending");
  else if (opts.status === "done") q = q.neq("status", "pending");
  const { data, error } = await q;
  if (error || !data) return [];
  const ids = Array.from(new Set(data.map((r) => r.item_id).filter((x): x is string => !!x)));
  const byId = new Map<string, { number: number; title: string }>();
  if (ids.length) {
    const { data: items } = await sb.from("backlog_items").select("id,number,title").eq("user_id", userId).in("id", ids);
    for (const i of items ?? []) byId.set(i.id as string, { number: i.number as number, title: i.title as string });
  }
  return data.map((r) => ({
    id: r.id as string,
    kind: r.kind as StepRow["kind"],
    title: r.title as string,
    detail: (r.detail as string | null) ?? null,
    ref: (r.ref as string | null) ?? null,
    status: r.status as StepRow["status"],
    check_result: r.check_result as StepRow["check_result"],
    check_note: (r.check_note as string | null) ?? null,
    asked_at: r.asked_at as string,
    done_at: (r.done_at as string | null) ?? null,
    item: r.item_id ? byId.get(r.item_id as string) ?? null : null,
  }));
}

/** The user says a step is done (or skipped). Closed on their word; Claude adds the check result when it verifies. */
export async function closeStep(sb: SupabaseClient, userId: string, id: string, how: "done" | "skipped", by: "user" | "telegram" = "user"): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await sb
    .from("backlog_steps")
    .update({ status: how, done_at: new Date().toISOString(), done_by: by })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "That step is already closed." };
  return { ok: true };
}

// ---- Test missions (migration 0065): manual tests for the user, auto-detected when the feature is used ----
export type TestRow = {
  id: string;
  title: string;
  how_to: string;
  probe: string | null;
  status: "pending" | "detected" | "worked" | "problem" | "skipped";
  detected_at: string | null;
  answered_at: string | null;
  problem_note: string | null;
  bug_number: number | null;
  item: { number: number; title: string } | null;
};

/** Runs the probe of every pending mission; a probe that returns true marks the mission "detected" (the pop-up asks "did it work?"). */
export async function detectTests(sb: SupabaseClient, userId: string): Promise<number> {
  const { data } = await sb.from("backlog_tests").select("id,probe,since").eq("user_id", userId).eq("status", "pending").is("deleted_at", null).not("probe", "is", null);
  let n = 0;
  for (const t of data ?? []) {
    const { data: hit, error } = await sb.rpc("test_run_probe", { p_probe: t.probe, p_user: userId, p_since: t.since });
    if (error || hit !== true) continue;
    const { data: upd } = await sb.from("backlog_tests").update({ status: "detected", detected_at: new Date().toISOString() }).eq("id", t.id).eq("user_id", userId).eq("status", "pending").select("id");
    if (upd?.length) n++;
  }
  return n;
}

export async function listTests(sb: SupabaseClient, userId: string, opts: { open?: boolean; limit?: number } = {}): Promise<TestRow[]> {
  let q = sb.from("backlog_tests").select("id,title,how_to,probe,status,detected_at,answered_at,problem_note,bug_item_id,item_id").eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: true }).limit(opts.limit ?? 50);
  if (opts.open) q = q.in("status", ["pending", "detected"]);
  const { data, error } = await q;
  if (error || !data) return [];
  const ids = Array.from(new Set(data.flatMap((r) => [r.item_id, r.bug_item_id]).filter((x): x is string => !!x)));
  const byId = new Map<string, { number: number; title: string }>();
  if (ids.length) {
    const { data: items } = await sb.from("backlog_items").select("id,number,title").eq("user_id", userId).in("id", ids);
    for (const i of items ?? []) byId.set(i.id as string, { number: i.number as number, title: i.title as string });
  }
  return data.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    how_to: r.how_to as string,
    probe: (r.probe as string | null) ?? null,
    status: r.status as TestRow["status"],
    detected_at: (r.detected_at as string | null) ?? null,
    answered_at: (r.answered_at as string | null) ?? null,
    problem_note: (r.problem_note as string | null) ?? null,
    bug_number: r.bug_item_id ? byId.get(r.bug_item_id as string)?.number ?? null : null,
    item: r.item_id ? byId.get(r.item_id as string) ?? null : null,
  }));
}

/** The "did it work?" answer. A problem creates a Bug in the Inbox (one line from the user) and links it to the mission. */
export async function answerTest(sb: SupabaseClient, userId: string, id: string, result: "worked" | "problem" | "skipped", note = ""): Promise<{ ok: boolean; error?: string; bug?: number }> {
  const { data: t } = await sb.from("backlog_tests").select("id,title,item_id,status").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!t) return { ok: false, error: "That test is gone." };
  if (t.status === "worked" || t.status === "problem" || t.status === "skipped") return { ok: false, error: "Already answered." };
  let bugId: string | null = null;
  let bug: number | undefined;
  if (result === "problem") {
    const r = await addItem(sb, userId, { title: `Problem found testing: ${t.title}`, type: "bug", source: "web" });
    if (!r.ok) return { ok: false, error: r.error };
    bugId = r.item.id;
    bug = r.item.number;
    const text = note.trim().slice(0, 500);
    if (text) await sb.from("backlog_items").update({ notes: `Reported while testing "${t.title}": ${text}` }).eq("id", r.item.id).eq("user_id", userId);
  }
  const { error } = await sb
    .from("backlog_tests")
    .update({ status: result, answered_at: new Date().toISOString(), problem_note: result === "problem" ? note.trim().slice(0, 500) || null : null, bug_item_id: bugId })
    .eq("id", id)
    .eq("user_id", userId);
  return error ? { ok: false, error: error.message } : { ok: true, bug };
}

/** The user says they did it (missions with no automatic trace): the same as "detected", then the question follows. */
export async function markTestDone(sb: SupabaseClient, userId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await sb.from("backlog_tests").update({ status: "detected", detected_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).eq("status", "pending").select("id");
  if (error) return { ok: false, error: error.message };
  return data?.length ? { ok: true } : { ok: false, error: "Already marked." };
}
