// Portfolio add-on, Phase 6 — the owner's inbox (rows written by the contact endpoint). RLS lets the owner read, update and delete.
import type { SupabaseClient } from "@supabase/supabase-js";

export type InboxRow = {
  id: string;
  name: string | null;
  email: string | null;
  message: string;
  lang: string | null;
  spam: boolean;
  spam_score: number;
  read_at: string | null;
  handled_at: string | null;
  created_at: string;
};
type Result = { ok: true } | { ok: false; error: string };
const COLS = "id,name,email,message,lang,spam,spam_score,read_at,handled_at,created_at";
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export async function listInbox(sb: SupabaseClient, userId: string, spam: boolean): Promise<InboxRow[]> {
  const { data } = await sb.from("portfolio_inbox").select(COLS).eq("user_id", userId).eq("spam", spam).order("created_at", { ascending: false }).limit(200);
  return (data ?? []) as InboxRow[];
}

/** Unread messages that are not spam (the number on the "Inbox" tab). */
export async function unreadCount(sb: SupabaseClient, userId: string): Promise<number> {
  const { count } = await sb.from("portfolio_inbox").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("spam", false).is("read_at", null);
  return count ?? 0;
}

async function patch(sb: SupabaseClient, userId: string, id: string, values: Record<string, unknown>): Promise<Result> {
  const { error } = await sb.from("portfolio_inbox").update(values).eq("user_id", userId).eq("id", id);
  return error ? fail(error.message) : { ok: true };
}
export const setRead = (sb: SupabaseClient, userId: string, id: string, read: boolean, now = new Date()) => patch(sb, userId, id, { read_at: read ? now.toISOString() : null });
/** "Handled" also counts as read. */
export const setHandled = (sb: SupabaseClient, userId: string, id: string, handled: boolean, now = new Date()) => patch(sb, userId, id, handled ? { handled_at: now.toISOString(), read_at: now.toISOString() } : { handled_at: null });
/** Moves a message between the inbox and the spam tab. A message marked as spam is also marked read. */
export const setSpam = (sb: SupabaseClient, userId: string, id: string, spam: boolean, now = new Date()) => patch(sb, userId, id, spam ? { spam: true, read_at: now.toISOString() } : { spam: false, read_at: null });

export async function markAllRead(sb: SupabaseClient, userId: string, now = new Date()): Promise<Result> {
  const { error } = await sb.from("portfolio_inbox").update({ read_at: now.toISOString() }).eq("user_id", userId).eq("spam", false).is("read_at", null);
  return error ? fail(error.message) : { ok: true };
}
export async function deleteMessage(sb: SupabaseClient, userId: string, id: string): Promise<Result> {
  const { error } = await sb.from("portfolio_inbox").delete().eq("user_id", userId).eq("id", id);
  return error ? fail(error.message) : { ok: true };
}
export async function emptySpam(sb: SupabaseClient, userId: string): Promise<Result> {
  const { error } = await sb.from("portfolio_inbox").delete().eq("user_id", userId).eq("spam", true);
  return error ? fail(error.message) : { ok: true };
}

/** mailto: link that opens the owner's mail app with a reply started. Built only from a validated address. */
export function replyHref(m: Pick<InboxRow, "email" | "message" | "lang" | "created_at">): string | null {
  if (!m.email || !/^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/.test(m.email)) return null;
  const es = m.lang === "es";
  const subject = es ? "Re: tu mensaje en mi sitio" : "Re: your message on my site";
  const quoted = m.message.split("\n").map((l) => `> ${l}`).join("\n");
  const body = `\n\n${es ? "El" : "On"} ${m.created_at.slice(0, 10)}:\n${quoted}`.slice(0, 1500);
  return `mailto:${m.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
