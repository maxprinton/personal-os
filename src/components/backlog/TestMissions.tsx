"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerMission, markMissionDone } from "@/app/backlog-actions";
import type { TestRow } from "@/lib/backlog/data";

/** Test missions: what to try (with steps), the automatic "you did it" detection and the "did it work?" pop-up. */
export default function TestMissions({ tests, full = false }: { tests: TestRow[]; full?: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [problemFor, setProblemFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);

  const detected = tests.filter((t) => t.status === "detected" && !hidden.includes(t.id));
  const pending = tests.filter((t) => t.status === "pending");
  const answered = tests.filter((t) => t.status === "worked" || t.status === "problem" || t.status === "skipped");
  const shownPending = full ? pending : pending.slice(0, Math.max(0, 3 - detected.length));
  if (!detected.length && !shownPending.length && !(full && answered.length)) return null;
  const popup = detected[0];

  function answer(id: string, result: "worked" | "problem" | "skipped") {
    setError("");
    start(async () => {
      const r = await answerMission(id, result, result === "problem" ? note : undefined);
      if (r.error) setError(r.error);
      else {
        setProblemFor(null);
        setNote("");
        router.refresh();
      }
    });
  }
  function did(id: string) {
    setError("");
    start(async () => {
      const r = await markMissionDone(id);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <>
      {popup && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-xl">
            <p className="text-xs font-medium text-muted">Mission complete</p>
            <h3 className="mt-1 text-base font-semibold">{popup.title}</h3>
            <p className="mt-1 text-sm text-muted">I saw you use it. Did it work?</p>
            {problemFor === popup.id ? (
              <div className="mt-3 space-y-2">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="One line: what went wrong?" className="w-full rounded-lg border border-line bg-bg p-2 text-sm" />
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => answer(popup.id, "problem")} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                    Send problem
                  </button>
                  <button type="button" disabled={busy} onClick={() => setProblemFor(null)} className="rounded-lg border border-line px-3 py-2 text-sm">
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => answer(popup.id, "worked")} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                  ✅ Worked
                </button>
                <button type="button" disabled={busy} onClick={() => setProblemFor(popup.id)} className="rounded-lg border border-line px-3 py-2 text-sm">
                  ⚠ Had a problem
                </button>
                <button type="button" onClick={() => setHidden((h) => [...h, popup.id])} className="rounded-lg px-3 py-2 text-sm text-muted">
                  Later
                </button>
              </div>
            )}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}

      <section className="mb-5 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Test missions{pending.length + detected.length ? ` (${pending.length + detected.length} open)` : ""}</h2>
        <ul className="mt-2 space-y-2">
          {detected.map((t) => (
            <li key={t.id} className="rounded-xl bg-accent-soft px-3 py-2 text-sm">
              <span className="font-medium">{t.title}</span> <span className="text-muted">· used, waiting for your answer</span>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => answer(t.id, "worked")} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  ✅ Worked
                </button>
                <button type="button" disabled={busy} onClick={() => { setHidden((h) => h.filter((x) => x !== t.id)); setProblemFor(t.id); }} className="rounded-lg border border-line px-3 py-1.5 text-sm">
                  ⚠ Problem
                </button>
              </div>
            </li>
          ))}
          {shownPending.map((t) => (
            <li key={t.id} className="rounded-xl border border-line px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{t.title}</span>
                {t.item && (
                  <Link href={`/backlog/${t.item.number}`} className="underline">
                    BL-{t.item.number}
                  </Link>
                )}
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-muted">How to test</summary>
                <p className="mt-1 whitespace-pre-line text-muted">{t.how_to}</p>
              </details>
              {!t.probe && (
                <button type="button" disabled={busy} onClick={() => did(t.id)} className="mt-2 rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50">
                  I did it
                </button>
              )}
              {t.probe && <p className="mt-1 text-xs text-muted">Marked automatically when you do it.</p>}
            </li>
          ))}
        </ul>
        {!full && pending.length > shownPending.length && (
          <p className="mt-2 text-sm">
            <Link href="/backlog" className="underline">
              All missions
            </Link>
          </p>
        )}
        {error && !popup && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {full && answered.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted">Answered ({answered.length})</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {answered.map((t) => (
                <li key={t.id} className="flex flex-wrap gap-x-2">
                  <span>{t.status === "worked" ? "✅" : t.status === "problem" ? "⚠" : "↷"}</span>
                  <span>{t.title}</span>
                  {t.bug_number && (
                    <Link href={`/backlog/${t.bug_number}`} className="underline">
                      BL-{t.bug_number}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
