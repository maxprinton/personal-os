"use client";
// Template Manager add-on — trash: restore, delete for good, empty. Kept 30 days, then deleted automatically.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteForeverAction, restoreAction } from "@/app/file-template-actions";
import { TRASH_DAYS } from "@/lib/file-templates/constants";
import { trashDaysLeft } from "@/lib/file-templates/query";
import type { FileTemplate } from "@/lib/file-templates/types";
import { BTN_DANGER, BTN_PLAIN, BTN_SMALL } from "./ui";

export default function TrashList({ items }: { items: FileTemplate[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<"sel" | "all" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = (p: Promise<{ ok: boolean; error?: string; count?: number }>, ok: (n: number) => string) =>
    start(async () => {
      const r = await p;
      setMsg(r.ok ? ok(r.count ?? 0) : (r.error ?? "Something went wrong."));
      setConfirm(null);
      setSel(new Set());
      if (r.ok) router.refresh();
    });

  if (!items.length) return <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">The trash is empty. Deleted templates stay here {TRASH_DAYS} days before they are removed for good.</p>;

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={BTN_PLAIN} disabled={pending || !sel.size} onClick={() => run(restoreAction([...sel]), (n) => `Restored ${n}.`)}>Restore selected</button>
        {confirm === "sel" ? (
          <>
            <button className={BTN_DANGER} disabled={pending} onClick={() => run(deleteForeverAction([...sel]), (n) => `Deleted ${n} for good.`)}>Yes, delete {sel.size} for good</button>
            <button className={BTN_PLAIN} onClick={() => setConfirm(null)}>Cancel</button>
          </>
        ) : (
          <button className={BTN_DANGER} disabled={pending || !sel.size} onClick={() => setConfirm("sel")}>Delete selected for good</button>
        )}
        <span className="flex-1" />
        {confirm === "all" ? (
          <>
            <button className={BTN_DANGER} disabled={pending} onClick={() => run(deleteForeverAction("all"), (n) => `Emptied the trash (${n}).`)}>Yes, empty the trash</button>
            <button className={BTN_PLAIN} onClick={() => setConfirm(null)}>Cancel</button>
          </>
        ) : (
          <button className={BTN_DANGER} disabled={pending} onClick={() => setConfirm("all")}>Empty trash</button>
        )}
      </div>
      {msg && <p role="status" className="rounded-md border border-line bg-subtle px-3 py-2 text-sm">{msg}</p>}
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
        {items.map((t) => (
          <li key={t.id} className="flex items-center gap-3 p-3">
            <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.name}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.code && <span className="mr-1.5 font-mono text-xs text-muted">{t.code}</span>}{t.name}</p>
              <p className="text-xs text-muted">{(t.tm_files ?? []).length} file(s) · deleted {t.deleted_at?.slice(0, 10)} · removed for good in {trashDaysLeft(t.deleted_at!)} days</p>
            </div>
            <button className={BTN_SMALL} disabled={pending} onClick={() => run(restoreAction([t.id]), () => `Restored “${t.name}”.`)}>Restore</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
