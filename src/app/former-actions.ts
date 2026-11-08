"use server";

// "Former" notes and their names (Nov 2026). A note remembers the name it had before it became the note of a block or a portfolio page
// (notes.name_memory). From a note's Kind / Block menu:
//  · nameInfoForNote   → what the note remembers (to show the choice "Former · … or its previous name") and where it could be restored
//  · restoreFormerNote → puts a released note back as the note of its block / page, with its original name, as if nothing had happened
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findBlockNote, noteKey } from "@/lib/block-notes";
import { linkNoteToBlock } from "@/app/block-link-actions";
import { linkNote, loadSlotViews } from "@/lib/portfolio/link";
import { KIND_LABEL } from "@/lib/portfolio/slots";
import { LANGS, type Lang } from "@/lib/portfolio/constants";
import { parseMemory, previousName, type NameChoice, type NameScope } from "@/lib/note-name-memory";

export type RestoreTarget = {
  scope: NameScope;
  /** the block's name, or the portfolio page's name */
  label: string;
  lang?: Lang;
  /** the note that is there now (it would be released with the chosen name), if any */
  currentTitle: string | null;
  /** the name that note could get back instead of "Former · …" (null = none saved) */
  currentPrevious: string | null;
  /** only blocks: the current note has text (an empty one is simply removed) */
  currentHasText: boolean;
};
export type FormerInfo = {
  /** a block note: the name it had before it became the block's note (null = none saved) */
  previousName: string | null;
  /** a Former note that can go back where it came from */
  restore: RestoreTarget | null;
  /** why it can't: the block / page it came from is gone */
  restoreProblem: string | null;
};
type Fail = { ok: false; error: string };

async function ctx() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  return { sb, userId: user.id };
}
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const blank = (md: string | null | undefined) => !String(md ?? "").replace(/<[^>]+>/g, "").replace(/[\s\-*#>|`_~[\]]+/g, "");
const isLang = (v: string): v is Lang => (LANGS as readonly string[]).includes(v);
const slotLabel = (s: { kind: keyof typeof KIND_LABEL; key: string }) => (s.kind === s.key ? KIND_LABEL[s.kind] : s.key);

export async function nameInfoForNote(noteId: string): Promise<{ ok: true; info: FormerInfo } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const { data } = await sb.from("notes").select("id,title,block_name,portfolio_slot_id,name_memory").eq("id", noteId).eq("user_id", userId).maybeSingle();
    const note = data as { id: string; title: string; block_name: string | null; portfolio_slot_id: string | null; name_memory?: unknown } | null;
    if (!note) return { ok: false, error: "That note is no longer there." };
    const mem = parseMemory(note.name_memory);
    const info: FormerInfo = { previousName: note.block_name ? previousName("block", note.title, mem) : null, restore: null, restoreProblem: null };
    // only a note that is not a block / page note right now can be restored
    if (mem && !note.block_name && !note.portfolio_slot_id) {
      if (mem.scope === "block" && mem.block) {
        const { data: types } = await sb.from("block_types").select("id,name").eq("user_id", userId).is("deleted_at", null);
        const t = ((types ?? []) as { id: string; name: string }[]).find((x) => noteKey(x.name) === noteKey(mem.block!));
        if (!t) info.restoreProblem = `The block “${mem.block}” no longer exists.`;
        else {
          const cur = await findBlockNote(sb, userId, t.name);
          info.restore = { scope: "block", label: t.name, currentTitle: cur ? cur.title : null, currentPrevious: cur ? previousName("block", cur.title, cur.memory) : null, currentHasText: !!cur && !blank(cur.content) };
        }
      } else if (mem.scope === "portfolio" && mem.slotId && mem.lang && isLang(mem.lang)) {
        const { slots } = await loadSlotViews(sb, userId, { includeArchived: true });
        const slot = slots.find((s) => s.id === mem.slotId);
        if (!slot) info.restoreProblem = "The portfolio page it came from no longer exists.";
        else {
          const cur = slot.pages[mem.lang].note;
          info.restore = { scope: "portfolio", label: slotLabel(slot), lang: mem.lang, currentTitle: cur ? cur.title : null, currentPrevious: cur ? cur.title : null, currentHasText: !!cur };
        }
      }
    }
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: errText(e, "Couldn't read the note's names.") };
  }
}

/** The note that is the block's note right now (for "Start a new empty note"): its name and the name it had before. */
export async function blockNoteNames(blockTypeId: string): Promise<{ ok: true; noteId: string | null; title: string | null; previousName: string | null; hasText: boolean } | Fail> {
  try {
    const { sb, userId } = await ctx();
    const { data: t } = await sb.from("block_types").select("name").eq("id", blockTypeId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
    if (!t) return { ok: false, error: "That block is no longer there." };
    const cur = await findBlockNote(sb, userId, (t as { name: string }).name);
    if (!cur) return { ok: true, noteId: null, title: null, previousName: null, hasText: false };
    return { ok: true, noteId: cur.id, title: cur.title, previousName: previousName("block", cur.title, cur.memory), hasText: !blank(cur.content) };
  } catch (e) {
    return { ok: false, error: errText(e, "Couldn't read the block's note.") };
  }
}

/**
 * Puts a released note back as the note of the block / portfolio page it came from. If something is there now it is released with
 * `nameChoice` ("Former · …" or its own name). The restored note gets its original name back (portfolio) or the block's name (blocks).
 */
export async function restoreFormerNote(noteId: string, nameChoice: NameChoice = "former"): Promise<{ ok: true; notice: string } | Fail> {
  try {
    const r = await nameInfoForNote(noteId);
    if (!r.ok) return r;
    const { sb, userId } = await ctx();
    const { data } = await sb.from("notes").select("name_memory").eq("id", noteId).eq("user_id", userId).maybeSingle();
    const mem = parseMemory((data as { name_memory?: unknown } | null)?.name_memory);
    if (!mem) return { ok: false, error: "This note has nothing to restore." };
    if (!r.info.restore) return { ok: false, error: r.info.restoreProblem ?? "It can't be restored from here." };
    const to = r.info.restore;
    if (to.scope === "portfolio") {
      const res = await linkNote(sb, userId, { slotId: mem.slotId!, lang: to.lang!, noteId, replace: !!to.currentTitle, nameChoice });
      if (!res.ok) return { ok: false, error: res.error };
      revalidatePath("/", "layout");
      return { ok: true, notice: `Restored as the ${to.lang!.toUpperCase()} page of “${to.label}”${res.restoredTitle ? ` with its name “${res.restoredTitle}”` : ""}.` };
    }
    const { data: types } = await sb.from("block_types").select("id,name").eq("user_id", userId).is("deleted_at", null);
    const t = ((types ?? []) as { id: string; name: string }[]).find((x) => noteKey(x.name) === noteKey(to.label));
    if (!t) return { ok: false, error: `The block “${to.label}” no longer exists.` };
    const res = await linkNoteToBlock({ noteId, blockTypeId: t.id, mode: to.currentHasText ? "replace" : undefined, nameChoice });
    if ("needsChoice" in res && res.needsChoice) return { ok: false, error: "The block got a note a moment ago. Try again." };
    if (!res.ok) return { ok: false, error: "error" in res && res.error ? res.error : "Couldn't restore the note." };
    revalidatePath("/", "layout");
    return { ok: true, notice: `Restored as the “${to.label}” note.` };
  } catch (e) {
    return { ok: false, error: errText(e, "Couldn't restore the note.") };
  }
}
