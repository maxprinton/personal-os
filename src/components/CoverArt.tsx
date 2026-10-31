"use client";
// 🖼 AI covers in the Notes bar: makes a cover for every selected note, one after the other, all in the same style.
// Notes with a picture of their own (uploaded or a link) are skipped; colors, gradients and earlier AI covers are replaced.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showAiUsage } from "@/lib/ai-usage-client";

export const COVERS_PER_RUN = 20;
type Res = { ok?: boolean; skipped?: boolean; quota?: boolean; error?: string; usage?: string | null };

export default function CoverArtButton({ getIds, count }: { getIds: () => string[]; count: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "ask" | "run" | "done">("idle");
  const [prog, setProg] = useState({ i: 0, n: 0, made: 0, skipped: 0, failed: 0 });
  const [note, setNote] = useState<string | null>(null);
  const stop = useRef(false);

  const run = async () => {
    const ids = getIds().slice(0, COVERS_PER_RUN);
    stop.current = false;
    setNote(null);
    let made = 0;
    let skipped = 0;
    let failed = 0;
    let last: string | null = null;
    setPhase("run");
    for (let i = 0; i < ids.length; i++) {
      if (stop.current) break;
      setProg({ i: i + 1, n: ids.length, made, skipped, failed });
      let r: Res | null = null;
      try {
        const res = await fetch("/api/cover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ noteId: ids[i], save: true }) });
        r = (await res.json().catch(() => null)) as Res | null;
      } catch {
        r = null;
      }
      if (r?.ok) {
        made++;
        if (r.usage) last = r.usage;
      } else if (r?.skipped) skipped++;
      else {
        failed++;
        setNote(r?.error || "Couldn't reach the server.");
        if (r?.quota) break;
      }
    }
    setProg((p) => ({ ...p, made, skipped, failed }));
    if (last) showAiUsage(last);
    setPhase("done");
    router.refresh();
  };

  if (phase === "run") {
    return (
      <span className="flex items-center gap-2 text-sm text-muted">
        Making covers {prog.i}/{prog.n}…
        <button type="button" onClick={() => (stop.current = true)} className="text-xs underline underline-offset-2 hover:text-fg">
          Stop
        </button>
      </span>
    );
  }
  if (phase === "ask") {
    return (
      <span className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">
          Make covers for {Math.min(count, COVERS_PER_RUN)} note{count === 1 ? "" : "s"}? Notes with their own picture are skipped.
        </span>
        <button type="button" onClick={() => void run()} className="rounded-md border border-edge bg-subtle px-3 py-1.5 transition-colors hover:bg-hover">
          Start
        </button>
        <button type="button" onClick={() => setPhase("idle")} className="text-xs text-muted underline underline-offset-2 hover:text-fg">
          Cancel
        </button>
      </span>
    );
  }
  return (
    <>
      {phase === "done" && (
        <span className="text-sm text-muted" title={note ?? undefined}>
          {prog.made} made{prog.skipped ? ` · ${prog.skipped} skipped` : ""}
          {prog.failed ? ` · ${prog.failed} failed${note ? `: ${note}` : ""}` : ""}
        </span>
      )}
      <button
        type="button"
        disabled={!count}
        onClick={() => setPhase("ask")}
        title={count ? `The AI draws a cover for each selected note (up to ${COVERS_PER_RUN} at a time)` : "Select notes to make their covers"}
        className="rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:bg-subtle disabled:opacity-40"
      >
        🖼 AI covers
      </button>
    </>
  );
}
