"use server";

// The writing checker's words: your glossary ("Add to dictionary", migration 0023) and the names of
// your notes, blocks and tags, which are never marked as spelling mistakes.
import { createClient } from "@/lib/supabase/server";

type Fail = { ok?: false; error: string };
const WORDS = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return { sb, userId: user?.id ?? null };
}

/** Every word the checker should accept, lower case. */
export async function loadWritingWords(): Promise<{ ok: true; words: string[]; glossary: string[] } | Fail> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const [g, n, b, t] = await Promise.all([
    sb.from("writing_glossary").select("word").eq("user_id", userId),
    sb.from("notes").select("title,block_name").eq("user_id", userId).is("deleted_at", null).limit(5000),
    sb.from("block_types").select("name").eq("user_id", userId).is("deleted_at", null),
    sb.from("tags").select("name").eq("user_id", userId).is("deleted_at", null),
  ]);
  const glossary = ((g.data ?? []) as { word: string }[]).map((r) => r.word); // empty when migration 0023 isn't run
  const names = [
    ...((n.data ?? []) as { title: string | null; block_name: string | null }[]).flatMap((r) => [r.title ?? "", r.block_name ?? ""]),
    ...((b.data ?? []) as { name: string }[]).map((r) => r.name),
    ...((t.data ?? []) as { name: string }[]).map((r) => r.name),
  ];
  const words = new Set<string>();
  for (const w of glossary) words.add(w.toLocaleLowerCase());
  for (const s of names) for (const m of s.matchAll(WORDS)) if (m[0].length > 1) words.add(m[0].toLocaleLowerCase());
  return { ok: true, words: [...words].slice(0, 20_000), glossary };
}

/** "Add to dictionary": never marked again, on any device. */
export async function addGlossaryWord(word: string): Promise<{ ok: true } | Fail> {
  const w = String(word ?? "").trim().slice(0, 100);
  if (!w) return { error: "Nothing to add." };
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("writing_glossary").insert({ user_id: userId, word: w });
  if (error && error.code !== "23505") {
    return { error: /writing_glossary/.test(error.message) ? "Run MIGRACION-0023-corrector-glosario.sql in Supabase first." : error.message };
  }
  return { ok: true };
}

export async function removeGlossaryWord(word: string): Promise<{ ok: true } | Fail> {
  const { sb, userId } = await ctx();
  if (!userId) return { error: "Sign in again." };
  const { error } = await sb.from("writing_glossary").delete().eq("user_id", userId).ilike("word", String(word ?? "").trim());
  if (error) return { error: error.message };
  return { ok: true };
}
