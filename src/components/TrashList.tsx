"use client";
// The list on /notes/trash: search, select (one, several, all), Restore, Delete forever, Empty trash.
// Deleting for good and emptying always ask first; restoring does not (nothing is lost).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { deleteTrashed, emptyNotesTrash, restoreTrashed } from "@/app/notes-trash-actions";
import type { TrashItem } from "@/lib/notes-trash";

type Item = TrashItem & { deletedLabel: string };
type Ask = { kind: "delete"; ids: string[] } | { kind: "empty" };
type Done = { ok: true; count: number } | { ok?: false; error: string };

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function TrashList({ initial, days }: { initial: Item[]; days: number }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initial);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean; link?: boolean } | null>(null);
  const allRef = useRef<HTMLInputElement>(null);

  // After router.refresh() the server sends the list again
  useEffect(() => setItems(initial), [initial]);

  const shown = useMemo(() => {
    const term = plain(q.trim());
    return term ? items.filter((i) => plain(i.title).includes(term) || plain(i.preview).includes(term)) : items;
  }, [items, q]);
  const picked = shown.filter((i) => sel.has(i.id));
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = picked.length > 0 && picked.length < shown.length;
  }, [picked.length, shown.length]);

  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const drop = (ids: string[]) => {
    const gone = new Set(ids);
    setItems((l) => l.filter((i) => !gone.has(i.id)));
    setSel((s) => new Set([...s].filter((id) => !gone.has(id))));
  };

  const restore = async (ids: string[]) => {
    if (busy || !ids.length) return;
    setBusy(true);
    setMsg(null);
    const r = await restoreTrashed(ids).catch((): Done => ({ error: "Couldn't restore. Try again." }));
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error, error: true });
    drop(ids);
    setMsg({ text: `Restored ${plural(r.count, "note")} ✓ (sub-pages, tags and links came back too)`, link: true });
    router.refresh();
  };

  const confirmed = async () => {
    const a = ask;
    if (!a || busy) return;
    setAsk(null);
    setBusy(true);
    setMsg(null);
    const r = await (a.kind === "empty" ? emptyNotesTrash() : deleteTrashed(a.ids)).catch((): Done => ({ error: "Couldn't delete. Try again." }));
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error, error: true });
    if (a.kind === "empty") {
      setItems([]);
      setSel(new Set());
    } else drop(a.ids);
    setMsg({ text: `Deleted ${plural(r.count, "note")} for good.` });
    router.refresh();
  };

  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAsk(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask]);

  const totalNotes = items.length;
  const btn = "rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:bg-subtle disabled:opacity-40";

  return (
    <div className="space-y-3">
      {msg && (
        <p role="status" className={`rounded-md px-3 py-2 text-sm ${msg.error ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent"}`}>
          {msg.text}
          {msg.link && (
            <>
              {" "}
              · <Link href="/notes" className="underline">Go to Notes</Link>
            </>
          )}
        </p>
      )}

      {totalNotes === 0 ? (
        <div className="rounded-xl border border-line px-4 py-10 text-center">
          <p className="text-2xl">🗑</p>
          <p className="mt-2 text-sm font-medium">The trash is empty</p>
          <p className="mt-1 text-xs text-muted">Notes you delete wait here for {days} days before they are deleted for good.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the trash…" aria-label="Search the trash" className="flex-1 rounded-md border border-line-strong px-3 py-2 text-sm" />
            <button type="button" disabled={busy} onClick={() => setAsk({ kind: "empty" })} className={`${btn} text-danger`}>
              Empty trash
            </button>
          </div>

          <div className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-card backdrop-blur">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                ref={allRef}
                type="checkbox"
                checked={shown.length > 0 && picked.length === shown.length}
                onChange={(e) => setSel(e.target.checked ? new Set(shown.map((i) => i.id)) : new Set())}
                aria-label="Select all"
                className="h-4 w-4 cursor-pointer accent-accent"
              />
              {picked.length ? <span className="font-medium">{picked.length} selected</span> : <span className="text-muted">Select all ({shown.length})</span>}
            </label>
            {picked.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <button type="button" disabled={busy} onClick={() => void restore(picked.map((i) => i.id))} className={btn}>
                  ↩ Restore
                </button>
                <button type="button" disabled={busy} onClick={() => setAsk({ kind: "delete", ids: picked.map((i) => i.id) })} className={`${btn} text-danger`}>
                  Delete forever
                </button>
              </div>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted">Nothing in the trash matches “{q}”.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {shown.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                  <input type="checkbox" checked={sel.has(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} aria-label={`Select “${i.title}”`} className="h-4 w-4 shrink-0 cursor-pointer accent-accent" />
                  <span className="w-5 shrink-0 text-center text-base">{i.icon || "📄"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.title}</p>
                    {i.preview && <p className="truncate text-xs text-muted">{i.preview}</p>}
                    <p className="text-xs text-faint">
                      Deleted {i.deletedLabel}
                      {i.subPages > 0 && ` · with ${plural(i.subPages, "sub-page")}`} · {i.daysLeft === 0 ? "deleted for good tonight" : `deleted for good in ${plural(i.daysLeft, "day")}`}
                    </p>
                  </div>
                  <button type="button" disabled={busy} onClick={() => void restore([i.id])} className={`${btn} shrink-0`}>
                    ↩ Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {ask && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && setAsk(null)}>
          <div role="alertdialog" aria-label="Confirm" className="w-full max-w-sm rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="text-sm font-medium">
              {ask.kind === "empty" ? `Empty the trash? ${plural(totalNotes, "note")} (and their sub-pages) will be deleted for good.` : `Delete ${plural(ask.ids.length, "note")} for good?`}
            </p>
            <p className="mt-1 text-xs text-muted">This can’t be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAsk(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-black/5">
                Cancel
              </button>
              <button type="button" autoFocus onClick={() => void confirmed()} className="rounded-lg bg-[#c4352b] px-3 py-1.5 text-sm font-medium text-white">
                {ask.kind === "empty" ? "Empty trash" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
