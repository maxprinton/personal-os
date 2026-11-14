"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishStep } from "@/app/backlog-actions";
import type { StepRow } from "@/lib/backlog/data";

const KIND: Record<StepRow["kind"], string> = { migration: "Migration", publish: "Upload", keys: "Keys", other: "Step" };

function ago(iso: string, nowMs: number): string {
  const m = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "Waiting on you": steps Claude asked for outside the app (run a migration, upload changes, add keys). One tap closes one. */
export default function StepsPanel({ pending, recent, nowIso, compact = false }: { pending: StepRow[]; recent: StepRow[]; nowIso: string; compact?: boolean }) {
  const nowMs = new Date(nowIso).getTime();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  if (!pending.length && !recent.length && !compact) return null;

  function act(id: string, how: "done" | "skipped") {
    setError("");
    start(async () => {
      const r = await finishStep(id, how);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <section className={compact ? "card p-3" : "mb-5 rounded-2xl border border-line bg-surface p-4"}>
      <h2 className="text-sm font-semibold">Waiting on you{pending.length ? ` (${pending.length})` : ""}</h2>
      {pending.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Nothing is waiting on you.</p>
      ) : (
        <ul className={`mt-2 ${compact ? "max-h-64 space-y-1.5 overflow-y-auto" : "space-y-2"}`}>
          {pending.map((s) => (
            <li key={s.id} className="rounded-xl bg-accent-soft px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="rounded-full border border-line px-2 py-0.5 text-xs">{KIND[s.kind]}</span>
                <span className="font-medium">{s.title}</span>
                {s.item && (
                  <Link href={`/backlog/${s.item.number}`} className="underline">
                    BL-{s.item.number}
                  </Link>
                )}
                <span className="text-muted">asked {ago(s.asked_at, nowMs)}</span>
              </div>
              {s.detail && <p className="mt-1 break-words text-muted">{s.detail}</p>}
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => act(s.id, "done")} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  Done
                </button>
                <button type="button" disabled={busy} onClick={() => act(s.id, "skipped")} className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50">
                  Skip
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {recent.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted">Recent steps ({recent.length})</summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {recent.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-2">
                <span>{s.status === "skipped" ? "↷" : s.check_result === "mismatch" ? "⚠" : "✓"}</span>
                <span className="text-muted">{KIND[s.kind]}</span>
                <span>{s.title}</span>
                {s.item && (
                  <Link href={`/backlog/${s.item.number}`} className="underline">
                    BL-{s.item.number}
                  </Link>
                )}
                {s.check_result === "mismatch" && <span className="text-red-600">flagged: {s.check_note ?? "did not match"}</span>}
                {s.check_result === "verified" && <span className="text-muted">verified</span>}
                {s.done_at && <span className="text-muted">· {ago(s.done_at, nowMs)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
