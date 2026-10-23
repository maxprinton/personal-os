"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { botToken, tg, webhookSecret } from "@/lib/telegram";
import type { ActionState } from "@/app/actions";
import { liveTagLinks } from "@/lib/tags";

/** One-time code the user sends to the bot: /link CODE (valid 15 minutes). */
export async function createLinkCode() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  await supabase
    .from("user_settings")
    .update({ telegram_link_code: code, telegram_link_expires: new Date(Date.now() + 15 * 60 * 1000).toISOString() })
    .eq("user_id", user.id);
  revalidatePath("/settings");
}

export async function unlinkTelegram() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("user_settings").update({ telegram_chat_id: null }).eq("user_id", user.id);
  revalidatePath("/settings");
}

/** Points the Telegram bot at this app's webhook. */
export async function connectBot(_prev: ActionState): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const token = botToken();
  if (!token) return { error: "TELEGRAM_BOT_TOKEN is not set in Vercel yet." };
  if (!process.env.SUPABASE_SECRET_KEY) return { error: "SUPABASE_SECRET_KEY is not set in Vercel yet." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || host.startsWith("localhost")) return { error: "Connect the bot from the public site, not localhost." };
  const res = await tg("setWebhook", {
    url: `https://${host}/api/telegram/webhook`,
    secret_token: webhookSecret(token),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  if (!res?.ok) return { error: `Telegram said: ${res?.description ?? "no answer"}` };
  revalidatePath("/settings");
  return { ok: true, at: Date.now() };
}

export async function generateInsightsNow() {
  const supabase = await createClient();
  await supabase.rpc("generate_my_insights");
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function markInsightRead(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("system_insights").update({ is_read: true }).eq("id", id);
  revalidatePath("/");
}

export async function deleteTag(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase.from("entity_tags").update({ deleted_at: now }).eq("tag_id", id).is("deleted_at", null);
  await supabase.from("tags").update({ deleted_at: now }).eq("id", id);
  revalidatePath("/settings");
  revalidatePath("/tasks");
  revalidatePath("/notes");
}

/** Removes every tag that is not used by any task, note, event or block. */
export async function deleteUnusedTags() {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { live, orphans } = await liveTagLinks(supabase);
  if (orphans.length) {
    await supabase.from("entity_tags").update({ deleted_at: now }).in("id", orphans.map((o) => o.id));
  }
  const { data: tags } = await supabase.from("tags").select("id").is("deleted_at", null);
  const inUse = new Set(live.map((u) => u.tag_id));
  const unused = ((tags ?? []) as { id: string }[]).map((t) => t.id).filter((id) => !inUse.has(id));
  if (unused.length) {
    await supabase.from("tags").update({ deleted_at: now }).in("id", unused);
  }
  revalidatePath("/settings");
}
