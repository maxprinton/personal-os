"use client";
// Export to Notes: asks whether to update an earlier export or create a new version (v2, v3…).
import Link from "next/link";
import { useState, useTransition } from "react";
import { exportScriptToNotes } from "@/app/youtube-actions/script";
import type { YtScriptExport } from "@/lib/youtube/types";
import { BTN, Modal, Msg, PRIMARY } from "./ui";

export type ExportRow = YtScriptExport & { alive: boolean };

export default function ExportDialog({ videoId, exports, beforeExport, onClose }: { videoId: string; exports: ExportRow[]; beforeExport: () => Promise<boolean>; onClose: () => void }) {
  const alive = exports.filter((e) => e.alive && e.note_id);
  const latest = [...alive].sort((a, b) => b.version - a.version)[0];
  const nextVersion = exports.reduce((m, e) => Math.max(m, e.version), 0) + 1;
  const [mode, setMode] = useState<"new" | "update">(alive.length ? "update" : "new");
  const [noteId, setNoteId] = useState(latest?.note_id ?? "");
  const [sources, setSources] = useState<"omit" | "footnotes">("omit");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ noteId: string; title: string } | null>(null);
  const [pending, start] = useTransition();

  const go = () =>
    start(async () => {
      setErr(null);
      if (!(await beforeExport())) {
        setErr("Some text isn't saved yet. Wait a second and try again.");
        return;
      }
      const r = await exportScriptToNotes(videoId, mode === "update" && noteId ? { mode: "update", noteId } : { mode: "new" }, sources);
      if (r.error || !r.noteId) setErr(r.error ?? "Couldn't export.");
      else setDone({ noteId: r.noteId, title: r.title ?? "Script" });
    });

  return (
    <Modal title="Export to Notes" onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm">
            Done: <b>{done.title}</b>
          </p>
          <div className="flex gap-2">
            <Link href={`/notes/${done.noteId}`} className={PRIMARY}>
              Open note →
            </Link>
            <button type="button" className={BTN} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">A note “Script · name · date” with Type = Script, a link back to this video and one heading per part.</p>
          {alive.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted">You exported this script before. What do you want?</legend>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "update"} onChange={() => setMode("update")} />
                <span className="flex-1 space-y-1">
                  <span className="block">Update an earlier export</span>
                  {mode === "update" && (
                    <select className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm" value={noteId} onChange={(e) => setNoteId(e.target.value)} aria-label="Which export">
                      {alive.map((e) => (
                        <option key={e.id} value={e.note_id ?? ""}>
                          v{e.version} · {e.title ?? "Script"} · {new Date(e.exported_at).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
                Create a new note (v{nextVersion})
              </label>
            </fieldset>
          ) : (
            <p>This creates a new note{nextVersion > 1 ? ` (v${nextVersion})` : ""}.</p>
          )}
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-muted">Research sources</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={sources === "omit"} onChange={() => setSources("omit")} /> Leave them out
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={sources === "footnotes"} onChange={() => setSources("footnotes")} /> Add them as footnotes at the end
            </label>
          </fieldset>
          <div className="flex items-center gap-2">
            <button type="button" className={PRIMARY} disabled={pending || (mode === "update" && !noteId)} onClick={go}>
              {pending ? "Exporting…" : mode === "update" ? "Update note" : "Export"}
            </button>
            <button type="button" className={BTN} onClick={onClose}>
              Cancel
            </button>
          </div>
          <Msg error={err} />
        </div>
      )}
    </Modal>
  );
}
