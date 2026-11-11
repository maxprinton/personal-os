"use server";
// Telegram page: one practice step (runs the real bot with nothing saved) and the editor for your command words.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanState, runSim, type Clock, type SimInput, type SimResult } from "@/lib/bot/sim/run";
import { baseWords, featureById, isEditable, takenWords } from "@/lib/bot/registry";
import { activeWords, bare, cleanWord, type VocabRow } from "@/lib/bot/vocab";
import { loadVocab } from "@/lib/bot/vocab-server";
import type { Kb } from "@/lib/bot/sim/store";

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

const emptyResult = (error: string): SimResult => ({ events: [], state: cleanState(null), error });

function cleanKb(kb: unknown): Kb {
  if (!Array.isArray(kb)) return [];
  return kb.slice(0, 20).map((row) =>
    (Array.isArray(row) ? row : []).slice(0, 8).map((b) => ({ text: String(b?.text ?? "").slice(0, 80), callback_data: String(b?.callback_data ?? "").slice(0, 64) })),
  );
}

/** One step of the practice chat. Reads your real data, saves nothing. */
export async function simulateStep(input: SimInput, rawState: unknown, clock: Clock = null): Promise<SimResult> {
  const userId = await signedIn();
  if (!userId) return emptyResult("Sign in again.");
  const admin = createAdminClient();
  if (!admin) return emptyResult("The practice chat needs SUPABASE_SECRET_KEY on the server.");
  const state = cleanState(rawState);
  try {
    if (input?.kind === "text") {
      const text = String(input.text ?? "").trim();
      if (!text) return { events: [], state };
      if (/^\/(?:link|start)\s+\S/i.test(text)) {
        return { events: [{ t: "send", id: state.nextId + 1, text: "Linking only works in the real Telegram chat.", kb: null }], state: { ...state, nextId: state.nextId + 1 } };
      }
      return await runSim(admin, userId, { kind: "text", text, replyTo: Number.isFinite(input.replyTo) ? input.replyTo : undefined }, state, clock);
    }
    if (input?.kind === "voice") {
      const text = String(input.text ?? "").trim();
      return text ? await runSim(admin, userId, { kind: "voice", text }, state, clock) : { events: [], state };
    }
    if (input?.kind === "photo") {
      const amount = Number(input.amount);
      if (!(amount > 0) || amount > 1_000_000) return { events: [], state, error: "Type the total of the receipt." };
      return await runSim(admin, userId, { kind: "photo", merchant: String(input.merchant ?? "").slice(0, 60), amount }, state, clock);
    }
    if (input?.kind === "tap" && input.message && typeof input.message.id === "number") {
      return await runSim(admin, userId, { kind: "tap", data: String(input.data ?? ""), message: { id: input.message.id, text: String(input.message.text ?? "").slice(0, 4000), kb: cleanKb(input.message.kb) } }, state, clock);
    }
    return { events: [], state };
  } catch (e) {
    return { events: [], state, error: e instanceof Error ? e.message : "Practice failed." };
  }
}

// ---- Your command words ----------------------------------------------------------------------

export type WordsResult = { ok: boolean; error?: string; vocab: VocabRow[] };

/** Start-of-message words the bot reads for saving things: a command word like these would steal normal messages. */
const RESERVED = new Set([
  "t", "task", "tarea", "note", "nota", "nb", "event", "evento", "cita", "pago", "payment", "income", "cobro", "habit", "habito", "done", "hecho", "skip", "listo",
  "libre", "free", "spent", "gaste", "received", "cobre", "transfer", "transferi", "yt", "youtube", "video", "os", "ask", "link", "start", "ok", "hola", "gracias",
]);
const MAX_PER_FEATURE = 8;

async function context() {
  const userId = await signedIn();
  const admin = createAdminClient();
  if (!userId || !admin) return null;
  return { userId, admin };
}

const done = async (c: { userId: string; admin: NonNullable<ReturnType<typeof createAdminClient>> }, ok = true, error?: string): Promise<WordsResult> => {
  if (ok) revalidatePath("/telegram");
  return { ok, error, vocab: await loadVocab(c.admin, c.userId) };
};

export async function addWord(featureId: string, raw: string): Promise<WordsResult> {
  const c = await context();
  if (!c) return { ok: false, error: "Sign in again.", vocab: [] };
  const f = featureById(featureId);
  if (!f || !isEditable(f)) return done(c, false, "That feature has no command words.");
  const word = cleanWord(raw);
  if (!word) return done(c, false, "Use 2–30 letters, numbers or _ (up to 3 words).");
  if (RESERVED.has(word)) return done(c, false, `“${word}” already starts something else in the bot (saving a task, an expense…). Pick another word.`);
  const owner = takenWords().get(word);
  if (owner && owner !== f.id) return done(c, false, `“${word}” already belongs to ${featureById(owner)?.title ?? owner}.`);
  const rows = await loadVocab(c.admin, c.userId);
  if (owner === f.id || rows.some((r) => r.kind === "add" && r.feature_id === f.id && r.word === word)) return done(c, false, `“${word}” is already a word of ${f.title}.`);
  const other = rows.find((r) => r.kind === "add" && r.word === word);
  if (other) return done(c, false, `“${word}” already belongs to ${featureById(other.feature_id)?.title ?? other.feature_id}.`);
  if (rows.filter((r) => r.kind === "add" && r.feature_id === f.id).length >= MAX_PER_FEATURE) return done(c, false, `${MAX_PER_FEATURE} extra words is the most for one feature.`);
  const { error } = await c.admin.from("bot_vocab").insert({ user_id: c.userId, feature_id: f.id, word, kind: "add" });
  return done(c, !error, error ? "Could not save it. Run migration 0055 first." : undefined);
}

export async function removeWord(featureId: string, word: string): Promise<WordsResult> {
  const c = await context();
  if (!c) return { ok: false, error: "Sign in again.", vocab: [] };
  const rows = await loadVocab(c.admin, c.userId);
  const f = featureById(featureId);
  if (f && !f.locked) {
    const left = activeWords({ id: f.id, words: baseWords(f), locked: false }, rows.filter((r) => !(r.kind === "add" && r.word === word && r.feature_id === f.id)));
    if (!left.length) return done(c, false, "Keep at least one word that opens this feature.");
  }
  const { error } = await c.admin.from("bot_vocab").delete().eq("user_id", c.userId).eq("feature_id", featureId).eq("word", word).eq("kind", "add");
  return done(c, !error);
}

/** Turns a built-in word off (never for locked features, and never the last word). */
export async function hideWord(featureId: string, builtIn: string): Promise<WordsResult> {
  const c = await context();
  if (!c) return { ok: false, error: "Sign in again.", vocab: [] };
  const f = featureById(featureId);
  if (!f || !isEditable(f)) return done(c, false, "That feature has no command words.");
  if (f.locked) return done(c, false, "This one touches money or the system, so its original words stay on. You can add more.");
  const word = bare(builtIn);
  if (!baseWords(f).some((w) => bare(w) === word)) return done(c, false, "That is not a built-in word of this feature.");
  const rows = await loadVocab(c.admin, c.userId);
  const left = activeWords({ id: f.id, words: baseWords(f), locked: false }, [...rows, { feature_id: f.id, word, kind: "hide" }]);
  if (!left.length) return done(c, false, "Keep at least one word that opens this feature.");
  const { error } = await c.admin.from("bot_vocab").upsert({ user_id: c.userId, feature_id: f.id, word, kind: "hide" }, { onConflict: "user_id,feature_id,kind,word", ignoreDuplicates: true });
  return done(c, !error);
}

export async function showWord(featureId: string, builtIn: string): Promise<WordsResult> {
  const c = await context();
  if (!c) return { ok: false, error: "Sign in again.", vocab: [] };
  const { error } = await c.admin.from("bot_vocab").delete().eq("user_id", c.userId).eq("feature_id", featureId).eq("word", bare(builtIn)).eq("kind", "hide");
  return done(c, !error);
}

/** Rename: the new word is added and every built-in word is turned off (not for locked features: they only get the new word). */
export async function renameCommand(featureId: string, raw: string): Promise<WordsResult> {
  const first = await addWord(featureId, raw);
  const f = featureById(featureId);
  if (!first.ok || !f || f.locked) return first;
  let last = first;
  const seen = new Set<string>();
  for (const w of baseWords(f)) {
    const b = bare(w);
    if (seen.has(b)) continue;
    seen.add(b);
    last = await hideWord(featureId, w);
    if (!last.ok) break;
  }
  return last.ok ? last : { ...last, ok: true, error: undefined };
}
