"use server";
// Portfolio add-on, Phase 6 — server actions for the Inbox screen. Every action checks the signed-in user.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/actions";
import { BASE } from "@/lib/portfolio/constants";
import { deleteMessage, emptySpam, markAllRead, setHandled, setRead, setSpam } from "@/lib/portfolio/inbox";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
async function who() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}
async function run(fn: (c: { sb: Awaited<ReturnType<typeof who>>["sb"]; userId: string }) => Promise<{ ok: true } | { ok: false; error: string }>): Promise<ActionState> {
  try {
    const r = await fn(await who());
    if (!r.ok) return { error: r.error };
    revalidatePath(`${BASE}/inbox`);
    revalidatePath(BASE, "layout");
    return { ok: true, at: Date.now() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

export const readAction = async (_p: ActionState, f: FormData) => run(({ sb, userId }) => setRead(sb, userId, s(f, "id"), s(f, "value") === "1"));
export const handledAction = async (_p: ActionState, f: FormData) => run(({ sb, userId }) => setHandled(sb, userId, s(f, "id"), s(f, "value") === "1"));
export const spamAction = async (_p: ActionState, f: FormData) => run(({ sb, userId }) => setSpam(sb, userId, s(f, "id"), s(f, "value") === "1"));
export const deleteAction = async (_p: ActionState, f: FormData) => run(({ sb, userId }) => deleteMessage(sb, userId, s(f, "id")));
export const readAllAction = async (_p: ActionState, _f: FormData) => run(({ sb, userId }) => markAllRead(sb, userId));
export const emptySpamAction = async (_p: ActionState, _f: FormData) => run(({ sb, userId }) => emptySpam(sb, userId));
