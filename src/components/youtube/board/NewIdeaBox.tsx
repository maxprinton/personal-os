"use client";
// Board: the quick "New idea" box → idea bank (Worker A).
import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/app/actions";
import { createIdea } from "@/app/youtube-actions/ideas";

export default function NewIdeaBox() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createIdea, {});
  const [kind, setKind] = useState<"long" | "short">("long");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-2 rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="idea"
          required
          maxLength={2000}
          placeholder="New video idea… e.g. How I built my own calendar app"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-faint"
          aria-label="New video idea"
        />
        <input type="hidden" name="kind" value={kind} />
        <div className="flex gap-2">
          <div role="radiogroup" aria-label="Kind" className="flex overflow-hidden rounded-md border border-line-strong text-xs">
            {(["long", "short"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`px-2.5 py-1.5 ${kind === k ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle"}`}
              >
                {k === "long" ? "Long" : "Short"}
              </button>
            ))}
          </div>
          <button disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
            {pending ? "Saving…" : "Add to bank"}
          </button>
        </div>
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {state.ok && state.info && <p className="text-xs text-success">{state.info}</p>}
      <p className="text-[11px] text-faint">Also from Telegram (“yt: your idea”) or from any note (“🎬 Turn into video idea”).</p>
    </form>
  );
}
