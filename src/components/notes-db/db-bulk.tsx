"use client";
// Runs changes that touch many notes at once (drag-fill, Ctrl+D, bulk edit, trash, duplicate):
// asks first when it is big (more than 10 notes, or a relation), applies on screen right away, saves in
// one batch, and shows a toast with ↩ Undo. Provider sits inside <Database>; the table and the selection
// bar call useBulk().
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { duplicateNotes, restoreNotes, trashNotes } from "@/app/notes-bulk-actions";
import { setNoteValues } from "@/app/notes-db-actions";
import { useDb } from "@/components/notes-db/db-shared";
import { errorText } from "@/components/notes-db/prop-ui";
import { CONFIRM_ABOVE, currentValue, knownItems, needsConfirm, planChanges, withValue, type Change, type Known, type MultiMode } from "@/lib/notes-db/fill";
import type { DbNote, NoteProperty } from "@/lib/notes-db/types";

type Outcome = { message: string; undo?: () => Promise<string | null> } | { error: string };
type Op = { confirm?: { message: string; button: string }; run: () => Promise<Outcome> };
type Msg = { text: string; error?: boolean; undo?: () => Promise<string | null> };

export type BulkApi = {
  /** Copies the value of `sourceId` into `targetIds` for one property (drag-fill / Ctrl+D). Multi-values replace. */
  fill: (prop: NoteProperty, sourceId: string, targetIds: string[]) => void;
  /** Sets (or clears, with null) one property on many notes. Multi-values use `mode`. */
  setValue: (prop: NoteProperty, noteIds: string[], incoming: unknown, mode: MultiMode, extra?: Known) => void;
  trash: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
};

const Ctx = createContext<BulkApi | null>(null);
export function useBulk(): BulkApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBulk must be inside <BulkProvider>.");
  return v;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function BulkProvider({ notes, tags, children }: { notes: DbNote[]; tags: { name: string; color: string | null }[]; children: ReactNode }) {
  const env = useDb();
  const router = useRouter();
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const envRef = useRef(env);
  envRef.current = env;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;

  const [ask, setAsk] = useState<Op | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  // The toast goes away by itself (longer when it has an Undo)
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.error ? 6000 : msg.undo ? 12000 : 3500);
    return () => clearTimeout(t);
  }, [msg]);

  const exec = useCallback(async (op: Op) => {
    setBusy(true);
    try {
      const r = await op.run();
      setMsg("error" in r ? { text: r.error, error: true } : { text: r.message, undo: r.undo });
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  }, []);
  const run = useCallback(
    (op: Op) => {
      if (op.confirm) setAsk(op);
      else void exec(op);
    },
    [exec],
  );

  /** Shows the new values at once, saves them in one batch, puts back what failed. Returns an error text or null. */
  const apply = useCallback(
    async (prop: NoteProperty, changes: Change[], known: Known): Promise<string | null> => {
      const orig = new Map(notesRef.current.map((n) => [n.id, n]));
      const touched = changes.map((c) => c.noteId).filter((id) => orig.has(id));
      for (const c of changes) {
        const n = orig.get(c.noteId);
        if (n) envRef.current.onNote(withValue(n, prop, c.value, known));
      }
      const back = (ids: string[]) => {
        for (const id of ids) {
          const n = orig.get(id);
          if (n) envRef.current.onNote(n);
        }
      };
      let r;
      try {
        r = await setNoteValues(prop.id, changes);
      } catch (e) {
        back(touched);
        return errorText(e);
      }
      if (!r.ok) {
        back(touched);
        return errorText(r);
      }
      if (r.failed.length) {
        back(r.failed.map((f) => f.noteId));
        return `${plural(r.failed.length, "note")} couldn't be saved: ${r.failed[0].error}`;
      }
      if (r.templateApplied) router.refresh();
      return null;
    },
    [router],
  );

  /** One change set → confirm if big → apply → toast with Undo. */
  const change = useCallback(
    (prop: NoteProperty, targets: DbNote[], incoming: unknown, mode: MultiMode, known: Known, text: (n: number) => string, confirmText?: (n: number) => string) => {
      const { changes, before } = planChanges(prop, targets, incoming, mode);
      if (!changes.length) {
        setMsg({ text: "Nothing to change: they already match." });
        return;
      }
      const n = changes.length;
      const confirm = needsConfirm(prop, n) ? { message: confirmText ? confirmText(n) : `Apply to ${plural(n, "note")}?`, button: "Apply" } : undefined;
      run({
        confirm,
        run: async () => {
          const err = await apply(prop, changes, known);
          if (err) return { error: err };
          return {
            message: text(n),
            undo: async () => apply(prop, before, known),
          };
        },
      });
    },
    [apply, run],
  );

  const api = useMemo<BulkApi>(() => {
    const find = (ids: string[]) => {
      const byId = new Map(notesRef.current.map((n) => [n.id, n]));
      return ids.map((id) => byId.get(id)).filter((n): n is DbNote => !!n);
    };
    return {
      fill(prop, sourceId, targetIds) {
        const src = find([sourceId])[0];
        const targets = find(targetIds.filter((id) => id !== sourceId));
        if (!src || !targets.length) return;
        const known: Known = { items: knownItems([src, ...targets], prop), tags: tagsRef.current };
        change(
          prop,
          targets,
          currentValue(src, prop),
          "replace",
          known,
          (n) => `Filled “${prop.name}” on ${plural(n, "note")} ✓`,
          (n) => `Fill “${prop.name}” into ${plural(n, "note")}?${prop.type === "relation" ? " This creates links." : ""}`,
        );
      },
      setValue(prop, noteIds, incoming, mode, extra) {
        const targets = find(noteIds);
        if (!targets.length) return;
        const known: Known = { items: [...knownItems(targets, prop), ...(extra?.items ?? [])], tags: [...(extra?.tags ?? []), ...tagsRef.current] };
        const verb = mode === "add" ? "Added to" : mode === "remove" ? "Removed from" : "Updated";
        change(
          prop,
          targets,
          incoming,
          mode,
          known,
          (n) => `${verb} “${prop.name}” on ${plural(n, "note")} ✓`,
          (n) => `${mode === "add" ? "Add to" : mode === "remove" ? "Remove from" : "Change"} “${prop.name}” on ${plural(n, "note")}?${prop.type === "relation" ? " This changes links." : ""}`,
        );
      },
      trash(ids) {
        if (!ids.length) return;
        run({
          confirm: ids.length > CONFIRM_ABOVE ? { message: `Move ${plural(ids.length, "note")} to the trash?`, button: "Move to trash" } : undefined,
          run: async () => {
            const r = await trashNotes(ids);
            if (!r.ok) return { error: errorText(r) };
            envRef.current.refresh();
            const gone = ids.length - r.skipped;
            return {
              message: `Moved ${plural(gone, "note")} to the trash${r.skipped ? ` (${r.skipped} block ${r.skipped === 1 ? "note or template" : "notes or templates"} left alone)` : ""}`,
              undo: async () => {
                const u = await restoreNotes(r.ids, r.at);
                envRef.current.refresh();
                return u.ok ? null : errorText(u);
              },
            };
          },
        });
      },
      duplicate(ids) {
        if (!ids.length) return;
        run({
          confirm: ids.length > CONFIRM_ABOVE ? { message: `Duplicate ${plural(ids.length, "note")}?`, button: "Duplicate" } : undefined,
          run: async () => {
            const r = await duplicateNotes(ids);
            if (!r.ok) return { error: errorText(r) };
            envRef.current.refresh();
            return {
              message: `Duplicated ${plural(r.ids.length, "note")} ✓${r.failed ? ` (${r.failed} failed)` : ""}`,
              undo: async () => {
                const u = await trashNotes(r.ids);
                envRef.current.refresh();
                return u.ok ? null : errorText(u);
              },
            };
          },
        });
      },
    };
  }, [change, run]);

  // Esc cancels the question
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAsk(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask]);

  const undoNow = async () => {
    const undo = msg?.undo;
    if (!undo || busy) return;
    setBusy(true);
    setMsg({ text: "Undoing…" });
    try {
      const err = await undo();
      setMsg(err ? { text: err, error: true } : { text: "Undone ✓" });
    } catch (e) {
      setMsg({ text: errorText(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {ask?.confirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && setAsk(null)}>
          <div role="alertdialog" aria-label={ask.confirm.message} className="w-full max-w-sm rounded-xl border border-line bg-surface p-4 shadow-card" onMouseDown={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium">{ask.confirm.message}</p>
            <p className="mt-1 text-xs text-muted">You will be able to undo it for a few seconds.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAsk(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-black/5">
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  const op = ask;
                  setAsk(null);
                  void exec(op);
                }}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
              >
                {ask.confirm.button}
              </button>
            </div>
          </div>
        </div>
      )}
      {msg && (
        <div role="status" className="fixed bottom-20 left-1/2 z-[120] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-lg bg-[rgb(47,47,47)] px-4 py-2 text-[13px] text-white shadow-card sm:bottom-6">
          <span>
            {msg.error && <span className="text-[#ff8a80]">⚠ </span>}
            {msg.text}
          </span>
          {msg.undo && (
            <button type="button" disabled={busy} onClick={() => void undoNow()} className="shrink-0 rounded px-1.5 py-0.5 font-medium text-[#8ab4ff] hover:bg-white/10">
              ↩ Undo
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
