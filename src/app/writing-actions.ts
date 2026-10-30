"use server";

// The writing assistant's server side: your glossary (migration 0023), settings, what the prediction
// learned, unknown words, accepted corrections and your voice profile (migration 0024).
// Everything runs as the signed-in user (row level security).
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { localNow } from "@/lib/time";
import { noteAsPlainText } from "@/lib/block-notes";
import { aiChat, hasAi } from "@/lib/ai";
import { ngramRows, ngramsOf, type ModelRow } from "@/lib/writing/predict";
import { cleanPatch, type WritingSettings } from "@/lib/writing/settings";

type Fail = { ok?: false; error: string };
const WORDS = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;
const NEED_0023 = "Run MIGRACION-0023-corrector-glosario.sql in Supabase first.";
const NEED_0024 = "Run MIGRACION-0024-asistente-escritura.sql in Supabase first.";

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return { sb, userId: user?.id ?? null };
}
type Ctx = Awaited<ReturnType<typeof ctx>>;

async function readSettings(c: Ctx): Promise<WritingSettings> {
  const { data, error } = await c.sb.from("user_settings").select("writing").eq("user_id", c.userId!).maybeSingle();
  if (error) return {};
  return ((data as { writing?: WritingSettings } | null)?.writing ?? {}) as WritingSettings;
}
async function writeSettings(c: Ctx, next: WritingSettings) {
  const { error } = await c.sb.from("user_settings").update({ writing: next }).eq("user_id", c.userId!);
  if (error) throw new Error(/writing/.test(error.message) ? NEED_0024 : error.message);
}

/** Everything the checker needs once per page: settings, accepted words, words you keep writing. */
export async function loadWritingWords(): Promise<{ ok: true; words: string[]; glossary: string[]; frequent: string[]; settings: WritingSettings } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const { sb, userId } = c;
  const [g, n, b, t, u, settings] = await Promise.all([
    sb.from("writing_glossary").select("word").eq("user_id", userId).order("word"),
    sb.from("notes").select("title,block_name").eq("user_id", userId).is("deleted_at", null).limit(5000),
    sb.from("block_types").select("name").eq("user_id", userId).is("deleted_at", null),
    sb.from("tags").select("name").eq("user_id", userId).is("deleted_at", null),
    sb.from("writing_unknown").select("word").eq("user_id", userId).gte("days", 3).limit(500),
    readSettings(c),
  ]);
  const glossary = ((g.data ?? []) as { word: string }[]).map((r) => r.word); // empty when 0023 isn't run
  const names = [
    ...((n.data ?? []) as { title: string | null; block_name: string | null }[]).flatMap((r) => [r.title ?? "", r.block_name ?? ""]),
    ...((b.data ?? []) as { name: string }[]).map((r) => r.name),
    ...((t.data ?? []) as { name: string }[]).map((r) => r.name),
  ];
  const words = new Set<string>();
  for (const w of glossary) words.add(w.toLocaleLowerCase());
  for (const s of names) for (const m of s.matchAll(WORDS)) if (m[0].length > 1) words.add(m[0].toLocaleLowerCase());
  const frequent = ((u.data ?? []) as { word: string }[]).map((r) => r.word).filter((w) => !words.has(w));
  return { ok: true, words: [...words].slice(0, 20_000), glossary, frequent, settings };
}

export async function saveWritingSettings(patch: Record<string, unknown>): Promise<{ ok: true; settings: WritingSettings } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  try {
    const cur = await readSettings(c);
    const p = cleanPatch(patch);
    const next: WritingSettings = { ...cur, ...p, areas: { ...(cur.areas ?? {}), ...(p.areas ?? {}) } };
    await writeSettings(c, next);
    return { ok: true, settings: next };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

// ---------- Glossary ----------

/** "Add to dictionary": never marked again, on any device. */
export async function addGlossaryWord(word: string): Promise<{ ok: true } | Fail> {
  return addGlossaryWords([word]);
}

export async function addGlossaryWords(words: string[]): Promise<{ ok: true; added: number } | Fail> {
  const list = [...new Set((words ?? []).map((w) => String(w ?? "").trim().slice(0, 100)).filter(Boolean))].slice(0, 2000);
  if (!list.length) return { error: "Nothing to add." };
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const { data: have } = await c.sb.from("writing_glossary").select("word").eq("user_id", c.userId);
  const known = new Set(((have ?? []) as { word: string }[]).map((r) => r.word.toLocaleLowerCase()));
  const fresh = list.filter((w) => !known.has(w.toLocaleLowerCase()));
  if (!fresh.length) return { ok: true, added: 0 };
  const { error } = await c.sb.from("writing_glossary").insert(fresh.map((word) => ({ user_id: c.userId, word })));
  if (error && error.code !== "23505") return { error: /writing_glossary/.test(error.message) ? NEED_0023 : error.message };
  return { ok: true, added: fresh.length };
}

export async function removeGlossaryWord(word: string): Promise<{ ok: true } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const { error } = await c.sb.from("writing_glossary").delete().eq("user_id", c.userId).ilike("word", String(word ?? "").trim());
  if (error) return { error: error.message };
  return { ok: true };
}

/** "Review my notes": all your notes as plain text (the browser looks for unknown words in it). */
export async function allNotesText(): Promise<{ ok: true; text: string; notes: number } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const parts: string[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await c.sb.from("notes").select("title,content").eq("user_id", c.userId).is("deleted_at", null).range(from, from + 999);
    if (error) return { error: error.message };
    for (const r of (data ?? []) as { title: string; content: string }[]) parts.push(`${r.title ?? ""}\n${noteAsPlainText(r.content ?? "")}`);
    if (!data || data.length < 1000) break;
  }
  const text = parts.join("\n\n");
  return { ok: true, text: text.slice(0, 3_000_000), notes: parts.length };
}

// ---------- Learning while you write ----------

/** Unknown words seen today: after 3 different days the menu offers to add them. */
export async function noteUnknownWords(words: string[]): Promise<{ ok: true } | Fail> {
  const list = [...new Set((words ?? []).map((w) => String(w).toLocaleLowerCase().slice(0, 100)).filter(Boolean))].slice(0, 200);
  if (!list.length) return { ok: true };
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const { timezone } = await getSettings(c.sb);
  const { error } = await c.sb.rpc("writing_seen", { p_words: list, p_day: localNow(timezone).date });
  return error ? { error: NEED_0024 } : { ok: true };
}

/** A correction you accepted (your most repeated mistakes, in Insights). */
export async function recordMistake(wrong: string, fixed: string): Promise<{ ok: true } | Fail> {
  if (!wrong || !fixed || wrong.toLocaleLowerCase() === fixed.toLocaleLowerCase()) return { ok: true };
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const { timezone } = await getSettings(c.sb);
  const { mondayOf } = await import("@/lib/writing/settings");
  const { error } = await c.sb.rpc("writing_mistake", { p_wrong: wrong, p_fixed: fixed, p_week: mondayOf(localNow(timezone).date) });
  return error ? { error: NEED_0024 } : { ok: true };
}

// ---------- Next-word prediction ----------

/** What the prediction learned (the most used pairs). */
export async function loadPredictModel(): Promise<{ ok: true; rows: ModelRow[]; trained: boolean } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const [{ data, error }, s] = await Promise.all([c.sb.rpc("writing_model", { p_max: 40000 }), readSettings(c)]);
  if (error) return { error: NEED_0024 };
  return { ok: true, rows: (data ?? []) as ModelRow[], trained: !!s.trainedAt };
}

/** New text you wrote: rows = [{c, w, n}] from ngramsOf(). */
export async function learnNgrams(rows: { c: string; w: string; n: number }[]): Promise<{ ok: true } | Fail> {
  const list = (rows ?? []).filter((r) => r && typeof r.w === "string" && r.w && typeof r.c === "string").slice(0, 5000);
  if (!list.length) return { ok: true };
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const { error } = await c.sb.rpc("writing_learn", { p_rows: list });
  return error ? { error: NEED_0024 } : { ok: true };
}

/** "Learn from my notes": reads every note once (also runs by itself the first time). */
export async function trainFromNotes(): Promise<{ ok: true; notes: number; pairs: number } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const all = await allNotesText();
  if (!all.ok) return all;
  const rows = ngramRows(ngramsOf(all.text));
  for (let i = 0; i < rows.length; i += 3000) {
    const { error } = await c.sb.rpc("writing_learn", { p_rows: rows.slice(i, i + 3000) });
    if (error) return { error: NEED_0024 };
  }
  const cur = await readSettings(c);
  await writeSettings(c, { ...cur, trainedAt: new Date().toISOString() }).catch(() => {});
  return { ok: true, notes: all.notes, pairs: rows.length };
}

/** "Forget what it learned". */
export async function forgetPredictions(): Promise<{ ok: true } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const { error } = await c.sb.from("writing_ngrams").delete().eq("user_id", c.userId);
  if (error) return { error: NEED_0024 };
  const cur = await readSettings(c);
  await writeSettings(c, { ...cur, trainedAt: null }).catch(() => {});
  return { ok: true };
}

// ---------- Your voice ----------

/** The AI reads your 8 longest notes of the last months and sums up how you write (a few lines). */
export async function buildVoiceProfile(): Promise<{ ok: true; voice: string } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  if (!hasAi()) return { error: "The AI is not connected (GROQ_API_KEY)." };
  const since = new Date(Date.now() - 180 * 864e5).toISOString();
  const { data, error } = await c.sb
    .from("notes")
    .select("title,content")
    .eq("user_id", c.userId)
    .is("deleted_at", null)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(400);
  if (error) return { error: error.message };
  const notes = ((data ?? []) as { title: string; content: string }[])
    .map((n) => ({ title: n.title, text: noteAsPlainText(n.content ?? "") }))
    .filter((n) => n.text.length > 200)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 8);
  if (notes.length < 2) return { error: "Write a few longer notes first (at least 2 with a couple of paragraphs)." };
  const per = Math.floor(11_000 / notes.length);
  const material = notes.map((n, i) => `### NOTE ${i + 1}: ${n.title}\n${n.text.slice(0, per)}`).join("\n\n");
  const out = await aiChat(
    [
      "You describe how a person writes, from their own notes, so a writing assistant can respect their style.",
      "Write 4 to 6 short lines (plain text, each starting with '- '): languages and how they mix them, tone, formality, sentence length, typical words or expressions, punctuation habits.",
      "Describe, don't judge or correct. Never quote private details (names, money, health, places). English.",
    ].join("\n"),
    [{ text: material }],
    { kind: "write", temperature: 0.2, maxTokens: 400, timeoutMs: 40_000 },
  );
  if (!("text" in out)) return { error: out.error };
  const voice = out.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .slice(0, 6)
    .join("\n")
    .slice(0, 800);
  if (!voice) return { error: "The AI answered with nothing. Try again." };
  const cur = await readSettings(c);
  try {
    await writeSettings(c, { ...cur, voice, voiceAt: new Date().toISOString() });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save." };
  }
  return { ok: true, voice };
}

export async function clearVoiceProfile(): Promise<{ ok: true } | Fail> {
  const c = await ctx();
  if (!c.userId) return { error: "Sign in again." };
  const cur = await readSettings(c);
  try {
    await writeSettings(c, { ...cur, voice: null, voiceAt: null });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save." };
  }
  return { ok: true };
}
