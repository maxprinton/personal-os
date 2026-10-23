import type { SupabaseClient } from "@supabase/supabase-js";
import { aiParse, describe, ruleParse, type Parsed } from "@/lib/parse";
import { localNow, zonedToUtc } from "@/lib/time";

// Works with both the signed-in user's client (RLS) and the admin client (Telegram).
// It always writes user_id explicitly, so with RLS it must match the signed-in user.

type Source = "web" | "mobile" | "telegram_bot";

export async function userContext(supabase: SupabaseClient, userId: string) {
  const [{ data: settings }, { data: cats }] = await Promise.all([
    supabase.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle(),
    supabase.from("categories").select("id,name,kind").eq("user_id", userId).is("deleted_at", null),
  ]);
  const timezone = (settings?.timezone as string | undefined) ?? "America/Guayaquil";
  return {
    timezone,
    today: localNow(timezone).date,
    categories: (cats ?? []) as { id: string; name: string; kind: "income" | "expense" }[],
  };
}

export async function parseMessage(text: string, today: string, categoryNames: string[]): Promise<{ parsed: Parsed; by: "ai" | "rules" }> {
  const ai = await aiParse(text, today, categoryNames);
  if (ai) return { parsed: ai, by: "ai" };
  return { parsed: ruleParse(text, today, categoryNames), by: "rules" };
}

export type Saved = { entityType: "task" | "note" | "transaction"; id: string; summary: string };

export async function saveParsed(
  supabase: SupabaseClient,
  userId: string,
  parsed: Parsed,
  source: Source,
  ctx: Awaited<ReturnType<typeof userContext>>
): Promise<Saved> {
  if (parsed.kind === "task") {
    const { data, error } = await supabase
      .from("tasks")
      .insert({ user_id: userId, title: parsed.title, scheduled_for: parsed.date ?? ctx.today, source })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not save task");
    return { entityType: "task", id: data.id, summary: describe(parsed) };
  }
  if (parsed.kind === "note") {
    const { data, error } = await supabase
      .from("notes")
      .insert({ user_id: userId, title: parsed.title, content: parsed.content, source })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Could not save note");
    return { entityType: "note", id: data.id, summary: describe(parsed) };
  }
  const category = parsed.category
    ? ctx.categories.find((c) => c.kind === parsed.txnType && c.name.toLowerCase() === parsed.category!.toLowerCase())
    : undefined;
  const occurred_at =
    !parsed.date || parsed.date === ctx.today
      ? new Date().toISOString()
      : zonedToUtc(parsed.date, "12:00", ctx.timezone).toISOString();
  const { data, error } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      type: parsed.txnType,
      amount: parsed.amount,
      description: parsed.description || null,
      category_id: category?.id ?? null,
      occurred_at,
      source,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save transaction");
  return { entityType: "transaction", id: data.id, summary: describe({ ...parsed, category: category?.name ?? null }) };
}

const TABLE: Record<string, string> = { task: "tasks", note: "notes", transaction: "transactions" };

/** Soft-deletes what a capture created. */
export async function undoSaved(supabase: SupabaseClient, userId: string, entityType: string, id: string) {
  const table = TABLE[entityType];
  if (!table) return false;
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  return !error;
}
