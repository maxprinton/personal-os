"use server";

// Backlog: server actions for the web screens (list, board, item page, quick add, settings).
// The rules are enforced by the database trigger; src/lib/backlog/data.ts also checks them first for a plain message.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  addItem,
  listItems,
  loadSettings,
  moveItem,
  placeItem,
  removeItem,
  resolveVerify,
  saveSettings,
  updateItem,
  type ItemPatch,
  type VerifyResult,
} from "@/lib/backlog/data";
import { triageSnapshot, type BacklogItem, type Triage } from "@/lib/backlog/board";
import { SIZES, TYPES, type BacklogSize, type BacklogStatus, type BacklogType } from "@/lib/backlog/rules";
import type { ActionState } from "@/app/actions";

export type BacklogActionResult = { ok?: boolean; error?: string; message?: string; triage?: Triage; item?: BacklogItem };

function refresh() {
  revalidatePath("/backlog");
  revalidatePath("/");
}

async function bctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { supabase, userId: user.id };
}
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** One sentence into the Inbox: the quick-add boxes (the /backlog page and the top bar). */
export async function addIdea(input: { title: string; type?: BacklogType }): Promise<BacklogActionResult> {
  try {
    const c = await bctx();
    const r = await addItem(c.supabase, c.userId, { title: input.title, type: input.type, source: "web" });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: `BL-${r.item.number} saved to the Inbox.`, item: r.item };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Form version of the quick-add (useActionState). */
export async function quickAdd(_prev: ActionState, form: FormData): Promise<ActionState> {
  const type = String(form.get("type") ?? "feature") as BacklogType;
  const r = await addIdea({ title: String(form.get("title") ?? ""), type: TYPES.includes(type) ? type : "feature" });
  return r.error ? { error: r.error } : { ok: true, at: Date.now(), info: r.message };
}

/** Moves an item; after Verifying or Done it also returns the 30-second prompt data. */
export async function moveItemAction(input: {
  number: number;
  to: BacklogStatus;
  size?: BacklogSize | null;
  spec_link?: string | null;
  parked_reason?: string | null;
}): Promise<BacklogActionResult> {
  try {
    const c = await bctx();
    const r = await moveItem(c.supabase, c.userId, input.number, input.to, {
      size: input.size,
      spec_link: input.spec_link,
      parked_reason: input.parked_reason,
    });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, item: r.item, message: r.reopened ? `BL-${input.number} is back in Now (reopened).` : undefined, triage: await maybeTriage(c, input.to) };
  } catch (e) {
    return { error: msg(e) };
  }
}

async function maybeTriage(c: Awaited<ReturnType<typeof bctx>>, to: BacklogStatus): Promise<Triage | undefined> {
  if (to !== "verifying" && to !== "done") return undefined;
  const settings = await loadSettings(c.supabase, c.userId);
  if (!settings.triage_prompt) return undefined;
  const { items } = await listItems(c.supabase, c.userId);
  return triageSnapshot(items, settings);
}

/** The one-week check from the web: it worked / it did not / still testing. */
export async function resolveVerifyAction(input: { number: number; result: VerifyResult }): Promise<BacklogActionResult> {
  try {
    const c = await bctx();
    const r = await resolveVerify(c.supabase, c.userId, input.number, input.result);
    if (!r.ok) return { error: r.error };
    refresh();
    const message = input.result === "worked" ? `BL-${input.number} is Done.` : input.result === "failed" ? `BL-${input.number} is back in Now (reopened).` : "Okay, I'll ask again in 3 days.";
    return { ok: true, message, triage: input.result === "worked" ? await maybeTriage(c, "done") : undefined };
  } catch (e) {
    return { error: msg(e) };
  }
}

const num = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return Number(v);
};

export async function saveItem(input: {
  number: number;
  title?: string;
  type?: BacklogType;
  size?: BacklogSize | "" | null;
  area?: string | null;
  spec_link?: string | null;
  notes?: string | null;
  value?: number | string | null;
  effort?: number | string | null;
}): Promise<BacklogActionResult> {
  try {
    const c = await bctx();
    const size = input.size === "" ? null : input.size;
    if (size !== undefined && size !== null && !SIZES.includes(size)) return { error: "Size must be S, M or L." };
    const patch: ItemPatch = {
      title: input.title,
      type: input.type,
      size,
      area: input.area,
      spec_link: input.spec_link,
      notes: input.notes,
      value: num(input.value),
      effort: num(input.effort),
    };
    const r = await updateItem(c.supabase, c.userId, input.number, patch);
    if (!r.ok) return { error: r.error };
    refresh();
    revalidatePath(`/backlog/${input.number}`);
    return { ok: true, item: r.item, message: "Saved." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Manual order inside a column (drag on the board / the ↑ ↓ buttons). */
export async function placeItemAction(input: { number: number; target: number; where: "before" | "after" }): Promise<BacklogActionResult> {
  try {
    const c = await bctx();
    const r = await placeItem(c.supabase, c.userId, input.number, input.target, input.where);
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function deleteItemAction(input: { number: number }): Promise<BacklogActionResult> {
  try {
    const c = await bctx();
    const r = await removeItem(c.supabase, c.userId, input.number);
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, message: `BL-${input.number} deleted.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function saveBacklogSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const c = await bctx();
    const r = await saveSettings(c.supabase, c.userId, {
      now_cap: Number(form.get("now_cap")),
      next_cap: Number(form.get("next_cap")),
      verifying_cap: Number(form.get("verifying_cap")),
      verify_days: Number(form.get("verify_days")),
      triage_prompt: form.get("triage_prompt") === "on",
      monday_summary: form.get("monday_summary") === "on",
    });
    if (!r.ok) return { error: r.error };
    refresh();
    return { ok: true, at: Date.now() };
  } catch (e) {
    return { error: msg(e) };
  }
}
