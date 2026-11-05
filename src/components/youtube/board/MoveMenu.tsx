"use client";
// Board card: move a video to the previous / next stage or any stage (hard gates checked on the server).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveVideo } from "@/app/youtube-actions/ideas";
import { STAGES } from "@/lib/youtube/constants";
import { nextStage, prevStage } from "@/lib/youtube/scoring";
import type { YtStage } from "@/lib/youtube/types";

export default function MoveMenu({ id, stage, compact = false }: { id: string; stage: YtStage; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "error" | "warn" | "ok"; text: string } | null>(null);
  const prev = prevStage(stage);
  const next = nextStage(stage);
  const go = (to: string) => {
    if (to === stage) return;
    let reason: string | null = null;
    if (to === "archived") {
      reason = window.prompt("Why park it? (optional — it is never deleted)", "") ?? null;
      if (reason === null) return;
    }
    setMsg(null);
    start(async () => {
      const r = await moveVideo(id, to, reason);
      if (r.error) setMsg({ tone: "error", text: r.error });
      else {
        if (r.wipWarning) setMsg({ tone: "warn", text: r.wipWarning });
        else if (r.code && (stage === "bank" || stage === "idea")) setMsg({ tone: "ok", text: `Approved as ${r.code}.` });
        router.refresh();
      }
    });
  };
  const btn = "rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:bg-subtle hover:text-fg disabled:opacity-40";
  return (
    <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        {prev && stage !== "bank" && (
          <button type="button" className={btn} disabled={pending} onClick={() => go(prev)} title={`Back to ${STAGES.find((s) => s.id === prev)?.label}`} aria-label="Move back one stage">
            ←
          </button>
        )}
        {next && stage !== "bank" && stage !== "idea" && (
          <button type="button" className={btn} disabled={pending} onClick={() => go(next)} title={`Move to ${STAGES.find((s) => s.id === next)?.label}`} aria-label="Move forward one stage">
            →
          </button>
        )}
        <select
          aria-label="Move to stage"
          value=""
          disabled={pending}
          onChange={(e) => go(e.target.value)}
          className={`${compact ? "w-20" : "w-24"} rounded border border-line bg-surface px-1 py-0.5 text-[11px] text-muted`}
        >
          <option value="">Move to…</option>
          {STAGES.filter((s) => s.id !== stage).map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === "archived" ? "Park (archive)" : s.label}
            </option>
          ))}
        </select>
        {pending && <span className="text-[11px] text-faint">…</span>}
      </div>
      {msg && <p className={`text-[11px] ${msg.tone === "error" ? "text-danger" : msg.tone === "warn" ? "text-warning" : "text-success"}`}>{msg.text}</p>}
    </div>
  );
}
