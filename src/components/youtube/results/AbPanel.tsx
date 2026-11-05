"use client";
// A/B on the Follow-up page (Worker C): 1) Test & compare in Studio — log which pairs and, later, Studio's
// verdict (Winner / Performed the same / Inconclusive); 2) the 48-hour swap vs the channel's usual — by API
// (Google) or by hand in Studio — measured with equal before/after windows and a minimum of impressions.
// Nothing is swapped while a Test & compare is running.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MANUAL_VERDICTS, MIN_IMPRESSIONS, equalWindows } from "@/lib/youtube/abtest";
import { metricsLine } from "@/lib/youtube/baseline";
import type { TestVerdict, VideoMetrics } from "@/lib/youtube/types";
import { deleteTest, logTestCompare, measureSwapNow, startSwap, startTestCompare } from "@/app/youtube-actions/results";
import { BOX, BTN, BTN_SM, INPUT, PRIMARY, fmtDate } from "@/components/youtube/results/ui";

export type PairRow = { id: string; label: string; is_primary: boolean; title: string | null; image: string | null };
export type TestRow = {
  id: string;
  kind: "test_compare" | "swap";
  pair_ids: string[];
  from_pair_id: string | null;
  to_pair_id: string | null;
  winner_pair_id: string | null;
  started_at: string;
  ended_at: string | null;
  verdict: TestVerdict | null;
  metrics_before: VideoMetrics;
  metrics_after: VideoMetrics;
  attrs: Record<string, unknown>;
  notes: string | null;
};
type Props = {
  videoId: string;
  isShort: boolean;
  pairs: PairRow[];
  tests: TestRow[];
  testRunning: boolean;
  swapOpen: boolean;
  advice: { suggest: boolean; reason: string; blocked?: string } | null;
  connected: boolean;
};

const VLABEL: Record<string, string> = { winner: "Winner", same: "Performed the same", inconclusive: "Inconclusive", no_clear_difference: "No clear difference" };

function PairChip({ p, small }: { p: PairRow | undefined; small?: boolean }) {
  if (!p) return <span className="text-faint">?</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {p.image && <img src={p.image} alt="" className={`${small ? "h-6" : "h-10"} aspect-video rounded object-cover`} />}
      <span className="text-sm">
        <b>{p.label}</b> {p.title ? `· ${p.title}` : ""}
      </span>
    </span>
  );
}

export default function AbPanel({ videoId, isShort, pairs, tests, testRunning, swapOpen, advice, connected }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; info?: string; log?: { what: string; ok: boolean; error?: string }[] } | null>(null);
  const [pick, setPick] = useState<string[]>(pairs.slice(0, 3).map((p) => p.id));
  const [verdict, setVerdict] = useState<TestVerdict>("winner");
  const [winner, setWinner] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [swapTo, setSwapTo] = useState<string>(pairs.find((p) => !p.is_primary)?.id ?? "");
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const running = tests.find((t) => t.kind === "test_compare" && !t.ended_at);
  const done = tests.filter((t) => t.ended_at);

  function run<T extends { error?: string; info?: string; log?: { what: string; ok: boolean; error?: string }[] }>(fn: () => Promise<T>) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.error || r.info || r.log ? { error: r.error, info: r.info, log: r.log } : null);
      router.refresh();
    });
  }

  if (isShort) return <section className={BOX}><h3 className="font-semibold">A/B</h3><p className="text-sm text-muted">Shorts don’t use title/thumbnail tests. Compare with your usual Shorts views above.</p></section>;

  return (
    <section className={BOX}>
      <div>
        <h3 className="font-semibold">A/B: title + thumbnail</h3>
        <p className="text-xs text-muted">
          Best: Studio’s <b>Test & compare</b> (shows 2–3 pairs at the same time; needs advanced features, long public videos only). Second: a swap at 48 h,
          compared before vs after in equal windows. Every result goes to the <a className="text-accent underline" href="/youtube/learning">learning library</a>.
        </p>
      </div>

      {/* 1 · Test & compare */}
      <div className="space-y-2 rounded-md border border-line p-3">
        <p className="text-sm font-medium">1 · Test & compare (YouTube decides)</p>
        {running ? (
          <div className="space-y-2">
            <p className="text-sm">
              Running since {fmtDate(running.started_at)} with {running.pair_ids.length} pairs. <b>Don’t change the title or thumbnail</b> — it stops the test. When Studio
              shows the result (1–2 weeks), log it here:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${INPUT} w-auto`} value={verdict} onChange={(e) => setVerdict(e.target.value as TestVerdict)}>
                {MANUAL_VERDICTS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              {verdict === "winner" && (
                <select className={`${INPUT} w-auto`} value={winner} onChange={(e) => setWinner(e.target.value)}>
                  <option value="">Which pair won?</option>
                  {running.pair_ids.map((id) => (
                    <option key={id} value={id}>
                      {byId.get(id)?.label ?? "?"} · {byId.get(id)?.title ?? ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input className={INPUT} placeholder="Notes (optional): watch time share, what you noticed…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" className={PRIMARY} disabled={pending} onClick={() => run(() => logTestCompare(running.id, verdict, verdict === "winner" ? winner || null : null, notes))}>
                Save result
              </button>
              <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => deleteTest(running.id))}>
                I didn’t start it (remove)
              </button>
            </div>
          </div>
        ) : pairs.length < 2 ? (
          <p className="text-sm text-muted">You need 2–3 title + thumbnail pairs (make them in Package).</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted">Started a Test & compare in Studio? Tick the pairs you added and log it — the app then won’t suggest swaps until you log the result.</p>
            <div className="space-y-1">
              {pairs.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={pick.includes(p.id)} onChange={(e) => setPick(e.target.checked ? [...pick, p.id].slice(-3) : pick.filter((x) => x !== p.id))} />
                  <PairChip p={p} small />
                </label>
              ))}
            </div>
            <button type="button" className={BTN} disabled={pending || pick.length < 2 || swapOpen} onClick={() => run(() => startTestCompare(videoId, pick))}>
              Log “Test & compare started”
            </button>
          </div>
        )}
      </div>

      {/* 2 · Swap */}
      <div className="space-y-2 rounded-md border border-line p-3">
        <p className="text-sm font-medium">2 · Swap at 48 h (before vs after)</p>
        {advice && <p className={`rounded-md p-2 text-sm ${advice.suggest ? "bg-warning-soft text-fg" : "bg-subtle text-muted"}`}>{advice.suggest ? "💡 " : ""}{advice.reason}</p>}
        {!advice && <p className="text-sm text-muted">The suggestion appears after the 48-hour check-in.</p>}
        {testRunning ? (
          <p className="text-sm text-warning">Swaps are off while a Test & compare is running.</p>
        ) : swapOpen ? (
          <p className="text-sm text-muted">A swap is being measured (see below).</p>
        ) : pairs.filter((p) => !p.is_primary).length === 0 ? (
          <p className="text-sm text-muted">No other pair to swap to — make one in Package.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Now on YouTube:</span> <PairChip p={pairs.find((p) => p.is_primary)} small />
            </div>
            <select className={`${INPUT} w-auto`} value={swapTo} onChange={(e) => setSwapTo(e.target.value)}>
              {pairs
                .filter((p) => !p.is_primary)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Swap to {p.label} · {p.title ?? "(no title)"}
                  </option>
                ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={PRIMARY} disabled={pending || !swapTo || !connected} onClick={() => run(() => startSwap(videoId, swapTo, "api"))} title={connected ? "" : "Connect Google in Settings"}>
                Swap on YouTube now
              </button>
              <button type="button" className={BTN} disabled={pending || !swapTo} onClick={() => run(() => startSwap(videoId, swapTo, "manual"))}>
                I’ll change it in Studio (record time)
              </button>
            </div>
            <p className="text-xs text-faint">
              The thumbnail is sent as JPG 1280×720 (custom thumbnails need a verified phone on the channel). The result needs ≥ {MIN_IMPRESSIONS.toLocaleString("en-US")} impressions in
              each window (with Google) — otherwise “inconclusive”. Small differences = “no clear difference”.
            </p>
          </div>
        )}
        {tests
          .filter((t) => t.kind === "swap" && !t.ended_at)
          .map((t) => {
            const w = equalWindows(t.started_at, (t.attrs.window_days as number) ?? 2);
            return (
              <div key={t.id} className="space-y-1 rounded-md bg-subtle p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <PairChip p={byId.get(t.from_pair_id ?? "")} small /> → <PairChip p={byId.get(t.to_pair_id ?? "")} small />
                </div>
                <p className="text-xs text-muted">
                  Before {w.before.from} → {w.before.to} vs after {w.after.from} → {w.after.to}
                  {w.sameWeekdays ? " (same weekdays)" : " (2-day windows: weekdays may differ)"}. Judged automatically when the after-window is complete
                  {connected ? " + 2 days (Analytics delay)" : ""}.
                </p>
                <div className="flex gap-2">
                  <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => measureSwapNow(t.id))}>
                    Check now
                  </button>
                  <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => deleteTest(t.id))}>
                    Cancel swap record
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {msg && (
        <div className={`rounded-md p-2 text-sm ${msg.error ? "bg-danger-soft text-danger" : "bg-success-soft text-fg"}`}>
          {msg.error ?? msg.info}
          {msg.log && (
            <ul className="mt-1 text-xs">
              {msg.log.map((l, i) => (
                <li key={i}>
                  {l.ok ? "✓" : "✗"} {l.what}
                  {l.error ? ` — ${l.error}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Results</p>
          {done.map((t) => (
            <div key={t.id} className="rounded-md border border-line p-2 text-sm">
              <p>
                <b>{t.kind === "swap" ? "Swap" : "Test & compare"}</b> · {fmtDate(t.started_at)} → {fmtDate(t.ended_at)} · {VLABEL[t.verdict ?? ""] ?? "—"}
                {t.winner_pair_id && (
                  <>
                    {" "}
                    · winner <PairChip p={byId.get(t.winner_pair_id)} small />
                  </>
                )}
              </p>
              {t.kind === "swap" && (
                <p className="text-xs text-muted">
                  Before: {metricsLine(t.metrics_before) || "—"} · After: {metricsLine(t.metrics_after) || "—"}
                  {typeof t.attrs.reason === "string" ? ` · ${t.attrs.reason}` : ""}
                </p>
              )}
              {t.notes && <p className="text-xs text-muted">{t.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
