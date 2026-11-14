"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moveItemAction } from "@/app/backlog-actions";
import Modal, { btnPrimary, btnSecondary } from "@/components/calendar/Modal";
import { TYPE_EMOJI, type Triage } from "@/lib/backlog/board";

/** The 30-second prompt after something reaches Verifying or Done. Never blocks anything: Skip closes it. */
export default function TriagePrompt({ triage, title, onClose }: { triage: Triage; title: string; onClose: () => void }) {
  const router = useRouter();
  const [t, setT] = useState(triage);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const roomInNow = t.nowCount < t.nowCap;

  async function pull(number: number) {
    setError("");
    setBusy(number);
    const r = await moveItemAction({ number, to: "now" });
    setBusy(null);
    if (r.error) return setError(r.error);
    router.refresh();
    if (r.triage) setT(r.triage);
    else setT({ ...t, nowCount: t.nowCount + 1, now: [...t.now, ...t.next.filter((i) => i.number === number)], next: t.next.filter((i) => i.number !== number) });
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <section>
          <h3 className="font-medium">
            Now ({t.nowCount}/{t.nowCap})
          </h3>
          {t.now.length ? (
            <ul className="mt-1 space-y-0.5">
              {t.now.map((i) => (
                <li key={i.number}>
                  {TYPE_EMOJI[i.type]} BL-{i.number} {i.title}
                  {i.size ? <span className="text-muted"> · {i.size}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">Nothing in Now.</p>
          )}
        </section>
        <section>
          <h3 className="font-medium">Top of Next{t.nextCount > t.next.length ? ` (${t.nextCount} in all)` : ""}</h3>
          {t.next.length ? (
            <ul className="mt-1 space-y-1">
              {t.next.map((i) => (
                <li key={i.number} className="flex items-center justify-between gap-2">
                  <span>
                    {TYPE_EMOJI[i.type]} BL-{i.number} {i.title}
                  </span>
                  <button type="button" disabled={!roomInNow || busy !== null} onClick={() => pull(i.number)} className="compact shrink-0 rounded-md border border-edge px-2 py-1 text-xs hover:bg-subtle disabled:opacity-50">
                    {busy === i.number ? "…" : "Pull to Now"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted">Next is empty.</p>
          )}
          {!roomInNow && t.next.length > 0 && <p className="mt-1 text-xs text-muted">Now is full. Finish, verify or move one first.</p>}
        </section>
        <p className="text-muted">
          Inbox: {t.inbox} · Verifying: {t.verifying}
        </p>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={btnPrimary}>
            Skip
          </button>
          <button type="button" onClick={() => { onClose(); router.push("/backlog"); }} className={btnSecondary}>
            Open the backlog
          </button>
        </div>
      </div>
    </Modal>
  );
}
