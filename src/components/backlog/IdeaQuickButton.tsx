"use client";

import { useEffect, useRef, useState } from "react";
import { addIdea } from "@/app/backlog-actions";
import Icon from "@/components/ui/Icon";
import { btnPrimary, inputCls } from "@/components/calendar/Modal";

/** Top-bar "+ Idea": one sentence goes to the Backlog Inbox from any screen. */
export default function IdeaQuickButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const r = await addIdea({ title });
    setBusy(false);
    if (r.error) return setMsg({ text: r.error, bad: true });
    setTitle("");
    setMsg({ text: r.message ?? "Saved to the Inbox.", bad: false });
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          setMsg(null);
        }}
        aria-expanded={open}
        title="Save an idea to the Backlog"
        aria-label="Save an idea to the Backlog"
        className="grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-fg"
      >
        <Icon name="spark" size={18} />
      </button>
      {open && (
        <form onSubmit={submit} className="absolute right-0 top-full z-50 mt-2 w-72 space-y-2 rounded-2xl border border-line bg-surface p-3 shadow-pop">
          <label className="text-sm font-medium" htmlFor="idea-quick">
            Idea for the Backlog
          </label>
          <input id="idea-quick" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="One sentence…" className={inputCls} />
          <div className="flex items-center justify-between gap-2">
            <button disabled={busy || !title.trim()} className={btnPrimary}>
              {busy ? "Saving…" : "Save"}
            </button>
            <a href="/backlog" className="text-xs text-muted underline">
              Open Backlog
            </a>
          </div>
          {msg && <p className={`text-xs ${msg.bad ? "text-danger" : "text-success"}`}>{msg.text}</p>}
        </form>
      )}
    </div>
  );
}
