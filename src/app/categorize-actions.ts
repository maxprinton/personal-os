"use server";
// Buttons of the ✨ auto-categorize panel (web): approve / skip a proposed category, undo a run, confirm the guesses.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { approveProposal, confirmAuto, rejectProposal, undoAuto, type ProposalResult } from "@/lib/category-proposals";

async function who() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user ? { sb, userId: user.id } : null;
}
const refresh = () => {
  revalidatePath("/finance");
  revalidatePath("/");
};

export async function approveCategoryProposal(id: string, name?: string): Promise<ProposalResult> {
  const w = await who();
  if (!w) return { ok: false, error: "Sign in again." };
  const r = await approveProposal(w.sb, w.userId, id, name);
  if (r.ok) refresh();
  return r;
}

export async function rejectCategoryProposal(id: string): Promise<{ ok: boolean; error?: string }> {
  const w = await who();
  if (!w) return { ok: false, error: "Sign in again." };
  const r = await rejectProposal(w.sb, w.userId, id);
  if (r.ok) refresh();
  return r;
}

export async function undoAutoCategorize(applied: { id: string; categoryId: string }[]): Promise<{ ok: boolean; undone?: number; error?: string }> {
  const w = await who();
  if (!w) return { ok: false, error: "Sign in again." };
  const undone = await undoAuto(w.sb, w.userId, applied.slice(0, 5000));
  refresh();
  return { ok: true, undone };
}

export async function confirmAutoCategories(): Promise<{ ok: boolean; confirmed?: number; error?: string }> {
  const w = await who();
  if (!w) return { ok: false, error: "Sign in again." };
  const confirmed = await confirmAuto(w.sb, w.userId);
  refresh();
  return { ok: true, confirmed };
}
