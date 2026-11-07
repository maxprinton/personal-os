// Search engine — server side: keeps the index (search_chunks) in step with the notes and their files,
// and answers searches. Indexing only rewrites notes whose text changed (a hash per note).
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { noteMetaMap } from "@/lib/notes-db/meta";
import { makeSnippet, parseQuery, type Snippet } from "@/lib/search/core";
import { noteToChunks, readableFile, MAX_CHUNK, type Chunk, type FileRef } from "@/lib/search/extract";
import { MAX_FILE_BYTES, fileText } from "@/lib/search/files";

type NoteRow = { id: string; title: string | null; content: string | null; block_name: string | null; seq: number | null; merged_into: string | null };

const hashOf = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex");
const rowsOf = (userId: string, noteId: string, chunks: Chunk[], filePath: string | null = null) =>
  chunks.map((c, i) => ({ user_id: userId, note_id: noteId, kind: c.kind, label: c.label, anchor: c.anchor, file_path: filePath, weight: c.weight, ord: i, body: c.body, extra: c.extra }));

async function insertChunks(sb: SupabaseClient, rows: ReturnType<typeof rowsOf>) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("search_chunks").insert(rows.slice(i, i + 200));
    if (error) throw error;
  }
}

/** Keeps search_files in step with the files a note holds (new ones wait to be read, gone ones are removed). */
async function syncFiles(sb: SupabaseClient, userId: string, noteId: string, files: FileRef[]) {
  const { data } = await sb.from("search_files").select("path").eq("note_id", noteId);
  const have = new Set(((data ?? []) as { path: string }[]).map((r) => r.path));
  const want = new Map(files.map((f) => [f.path, f]));
  const gone = [...have].filter((p) => !want.has(p));
  if (gone.length) {
    await sb.from("search_chunks").delete().eq("note_id", noteId).in("file_path", gone);
    await sb.from("search_files").delete().eq("note_id", noteId).in("path", gone);
  }
  const add = [...want.values()].filter((f) => !have.has(f.path));
  if (add.length)
    await sb.from("search_files").insert(
      add.map((f) => ({ user_id: userId, note_id: noteId, path: f.path, name: f.name, status: readableFile(f.name) ? "pending" : "skipped", detail: readableFile(f.name) ? null : "found by name only" })),
    );
}

/**
 * Brings the index of one user up to date. `only` = just these notes (after a save). Returns how many
 * notes were (re)indexed. Safe to run often: unchanged notes are skipped by their hash.
 */
export async function indexUser(sb: SupabaseClient, userId: string, opts: { only?: string[]; budgetMs?: number } = {}): Promise<number> {
  const t0 = Date.now();
  let q = sb.from("notes").select("id,title,content,block_name,seq,merged_into").eq("user_id", userId);
  if (opts.only?.length) q = q.in("id", opts.only);
  const { data: notes, error } = await q;
  if (error) throw error;
  const meta = await noteMetaMap(sb, userId);
  let st = sb.from("search_state").select("note_id,hash").eq("user_id", userId);
  if (opts.only?.length) st = st.in("note_id", opts.only);
  const { data: states } = await st;
  const known = new Map(((states ?? []) as { note_id: string; hash: string }[]).map((s) => [s.note_id, s.hash]));
  let done = 0;
  for (const n of (notes ?? []) as NoteRow[]) {
    if (opts.budgetMs && Date.now() - t0 > opts.budgetMs) break;
    const { chunks, files } = n.merged_into ? { chunks: [], files: [] } : noteToChunks({ title: n.title ?? "", blockName: n.block_name, seq: n.seq, content: n.content ?? "", props: meta.get(n.id) ?? [] });
    const hash = hashOf([chunks, files]);
    if (known.get(n.id) === hash) continue;
    await sb.from("search_chunks").delete().eq("note_id", n.id).is("file_path", null);
    await insertChunks(sb, rowsOf(userId, n.id, chunks));
    await syncFiles(sb, userId, n.id, n.merged_into ? [] : files);
    await sb.from("search_state").upsert({ note_id: n.id, user_id: userId, hash, indexed_at: new Date().toISOString() });
    done++;
  }
  return done;
}

/** Reads waiting files (every user; admin client). Stops at the time budget. Returns how many were read. */
export async function processFiles(sb: SupabaseClient, opts: { budgetMs: number; max?: number; userId?: string; touched?: Set<string> }): Promise<number> {
  const t0 = Date.now();
  let fq = sb
    .from("search_files")
    .select("note_id,path,user_id,name,attempts,status")
    .in("status", ["pending", "wait"])
    .lt("attempts", 3);
  if (opts.userId) fq = fq.eq("user_id", opts.userId);
  const { data } = await fq.order("updated_at", { ascending: true }).limit(opts.max ?? 25);
  let read = 0;
  let pdfWaiting = false;
  for (const f of (data ?? []) as { note_id: string; path: string; user_id: string; name: string; attempts: number; status: string }[]) {
    if (Date.now() - t0 > opts.budgetMs) break;
    if (pdfWaiting && /\.pdf$/i.test(f.name)) continue;
    const mark = (patch: Record<string, unknown>) => sb.from("search_files").update({ ...patch, updated_at: new Date().toISOString() }).eq("note_id", f.note_id).eq("path", f.path);
    try {
      const dl = await sb.storage.from("note-files").download(f.path);
      if (dl.error || !dl.data) {
        await mark({ status: f.attempts >= 2 ? "failed" : "pending", attempts: f.attempts + 1, detail: "file not found in storage" });
        continue;
      }
      if (dl.data.size > MAX_FILE_BYTES) {
        await mark({ status: "skipped", detail: "bigger than 25 MB: found by name only" });
        continue;
      }
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const r = await fileText(f.name || f.path, buf);
      if (r.status === "wait") {
        pdfWaiting = true;
        await mark({ status: "wait", detail: r.detail });
        continue;
      }
      await sb.from("search_chunks").delete().eq("note_id", f.note_id).eq("file_path", f.path);
      const chunks: Chunk[] = [];
      for (const p of r.parts)
        for (let i = 0; i < p.text.length; i += MAX_CHUNK)
          chunks.push({ kind: "file", weight: "C", label: [f.name, p.label].filter(Boolean).join(" · "), anchor: f.name, body: p.text.slice(i, i + MAX_CHUNK), extra: "" });
      if (chunks.length) await insertChunks(sb, rowsOf(f.user_id, f.note_id, chunks, f.path));
      const chars = r.parts.reduce((s, p) => s + p.text.length, 0);
      await mark({ status: r.status, detail: r.detail ?? null, chars, attempts: r.status === "failed" ? f.attempts + 1 : f.attempts });
      read++;
      opts.touched?.add(f.user_id);
    } catch (e) {
      await mark({ status: f.attempts >= 2 ? "failed" : "pending", attempts: f.attempts + 1, detail: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  }
  return read;
}

/** Cron (every 5 min): every user's notes, then waiting files, inside the time budget. */
export async function runSearchCron(admin: SupabaseClient, opts: { budgetMs: number }): Promise<{ notes: number; files: number }> {
  const t0 = Date.now();
  const { data: users } = await admin.from("user_settings").select("user_id");
  let notes = 0;
  const touched = new Set<string>();
  for (const u of (users ?? []) as { user_id: string }[]) {
    if (Date.now() - t0 > opts.budgetMs * 0.6) break;
    try {
      const n = await indexUser(admin, u.user_id, { budgetMs: opts.budgetMs * 0.6 });
      if (n) touched.add(u.user_id);
      notes += n;
    } catch (e) {
      console.error("search index", e);
    }
  }
  let files = 0;
  try {
    files = await processFiles(admin, { budgetMs: Math.max(2000, opts.budgetMs - (Date.now() - t0) - 1500), touched });
  } catch (e) {
    console.error("search files", e);
  }
  for (const u of touched) await refreshWords(admin, u);
  return { notes, files };
}

// ---- Searching --------------------------------------------------------------------------------

export type SearchHit = { kind: string; label: string | null; anchor: string | null; file: string | null; snippet: Snippet };
export type SearchResult = {
  id: string;
  title: string;
  icon: string | null;
  parentTitle: string | null;
  updatedAt: string;
  trashed: boolean;
  template: boolean;
  blockName: string | null;
  score: number;
  /** How many pieces of the note matched (the hits below are the best 3). */
  pieces: number;
  hits: SearchHit[];
};
export type SearchOptions = { kinds?: ("text" | "code" | "file")[]; trash?: boolean; templates?: boolean; limit?: number; offset?: number };
export type SearchResponse = {
  ok: boolean;
  results: SearchResult[];
  total: number;
  words: string[];
  corrected?: string;
  error?: string;
  /** The index is still being built: results may be incomplete. */
  building?: { notes: number; indexed: number };
};

const KIND_GROUPS: Record<"text" | "code" | "file", string[]> = {
  text: ["title", "heading", "text", "table", "props", "media"],
  code: ["code"],
  file: ["file", "media"],
};

type Row = { note_id: string; score: number; total: number; hits: { pieces: number; top: { kind: string; label: string | null; anchor: string | null; file: string | null; body: string }[] | null } };

async function runQuery(sb: SupabaseClient, userId: string, terms: string[], not: string[], opts: SearchOptions) {
  const kinds = opts.kinds?.length ? [...new Set(opts.kinds.flatMap((k) => KIND_GROUPS[k]))] : null;
  return sb.rpc("search_notes", {
    p_user: userId,
    p_terms: terms,
    p_not: not,
    p_kinds: kinds,
    p_trash: !!opts.trash,
    p_templates: !!opts.templates,
    p_limit: Math.min(100, Math.max(1, opts.limit ?? 20)),
    p_offset: Math.max(0, opts.offset ?? 0),
  });
}

/** Every word somewhere in the note (start of a word, accents ignored), best notes first. */
export async function searchNotes(sb: SupabaseClient, userId: string, input: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const q = parseQuery(input);
  if (!q.terms.length) return { ok: true, results: [], total: 0, words: [] };
  let words = q.words;
  let { data, error } = await runQuery(sb, userId, q.terms, q.not, opts);
  if (error) return { ok: false, results: [], total: 0, words, error: error.message };
  let corrected: string | undefined;
  // Nothing found: try the closest indexed word for each plain word (typos)
  if (!(data as Row[] | null)?.length && q.simple?.length && !opts.offset) {
    const fixed: string[] = [];
    let changed = false;
    for (const w of q.simple) {
      const { data: s } = await sb.rpc("search_suggest", { p_user: userId, p_word: w });
      const best = typeof s === "string" && s ? s : null;
      if (best && best !== w) changed = true;
      fixed.push(best ?? w);
    }
    if (changed) {
      const q2 = parseQuery(fixed.join(" "));
      const r2 = await runQuery(sb, userId, q2.terms, q2.not, opts);
      if (!r2.error && (r2.data as Row[] | null)?.length) {
        data = r2.data;
        words = q2.words;
        corrected = fixed.join(" ");
      }
    }
  }
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { ok: true, results: [], total: 0, words, corrected };
  const ids = rows.map((r) => r.note_id);
  const { data: notes } = await sb.from("notes").select("id,title,block_name,parent_id,page,updated_at,deleted_at,is_template").in("id", ids);
  type N = { id: string; title: string | null; block_name: string | null; parent_id: string | null; page: { icon?: string } | null; updated_at: string; deleted_at: string | null; is_template: boolean | null };
  const byId = new Map(((notes ?? []) as N[]).map((n) => [n.id, n]));
  const parentIds = [...new Set(((notes ?? []) as N[]).map((n) => n.parent_id).filter((x): x is string => !!x))];
  const parents = new Map<string, string>();
  if (parentIds.length) {
    const { data: ps } = await sb.from("notes").select("id,title").in("id", parentIds);
    for (const p of (ps ?? []) as { id: string; title: string | null }[]) parents.set(p.id, p.title || "Untitled");
  }
  const results: SearchResult[] = rows.flatMap((r) => {
    const n = byId.get(r.note_id);
    if (!n) return [];
    const icon = n.page && typeof n.page === "object" && typeof n.page.icon === "string" && n.page.icon.length <= 8 ? n.page.icon : null;
    return [
      {
        id: n.id,
        title: n.block_name || n.title || "Untitled",
        icon,
        parentTitle: n.parent_id ? parents.get(n.parent_id) ?? null : null,
        updatedAt: n.updated_at,
        trashed: !!n.deleted_at,
        template: !!n.is_template,
        blockName: n.block_name,
        score: Number(r.score) || 0,
        pieces: r.hits?.pieces ?? 0,
        hits: (r.hits?.top ?? []).map((h) => ({ kind: h.kind, label: h.label, anchor: h.anchor, file: h.file, snippet: makeSnippet(h.body, words) })),
      },
    ];
  });
  return { ok: true, results, total: Number(rows[0]?.total ?? results.length), words, corrected };
}

/**
 * The list of indexed words (for typo suggestions, migration 0041). Rebuilt after the index changed;
 * before 0041 is run it does nothing and suggestions use the slower way.
 */
export async function refreshWords(sb: SupabaseClient, userId: string): Promise<void> {
  try {
    await sb.rpc("refresh_search_words", { p_user: userId });
  } catch {
    /* 0041 not run yet */
  }
}

/** Notes vs notes in the index (two quick counts). */
export async function indexGap(sb: SupabaseClient, userId: string): Promise<{ notes: number; indexed: number }> {
  const [notes, indexed] = await Promise.all([
    sb.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId),
    sb.from("search_state").select("note_id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return { notes: notes.count ?? 0, indexed: indexed.count ?? 0 };
}

/** The index is missing more than a couple of notes (e.g. right after publishing). */
export const indexIncomplete = (g: { notes: number; indexed: number } | null) => !!g && g.notes > 0 && g.indexed < g.notes - 2;

/** How far the index is (for the search page). */
export async function indexStatus(sb: SupabaseClient, userId: string) {
  const [notes, indexed, files] = await Promise.all([
    sb.from("notes").select("id", { count: "exact", head: true }).eq("user_id", userId),
    sb.from("search_state").select("note_id", { count: "exact", head: true }).eq("user_id", userId),
    sb.from("search_files").select("status").eq("user_id", userId),
  ]);
  const byStatus: Record<string, number> = {};
  for (const f of (files.data ?? []) as { status: string }[]) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
  return { notes: notes.count ?? 0, indexed: indexed.count ?? 0, files: byStatus };
}

/**
 * Right after a note is saved: re-index it (admin client), unless it was indexed in the last few seconds
 * (autosave runs often while typing; the next save or the 5-minute cron catches up).
 */
export async function indexSoon(userId: string | null, noteId: string) {
  if (!userId || !noteId) return;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    if (!admin) return;
    const { data } = await admin.from("search_state").select("indexed_at").eq("note_id", noteId).maybeSingle();
    const at = data ? Date.parse((data as { indexed_at: string }).indexed_at) : 0;
    if (Date.now() - at < 8_000) return;
    await indexUser(admin, userId, { only: [noteId] });
  } catch (e) {
    console.error("search index after save", e);
  }
}
