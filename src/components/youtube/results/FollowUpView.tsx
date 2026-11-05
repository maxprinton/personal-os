"use client";
// /youtube/v/[id]/follow-up UI (Worker C): check-ins, views over time, A/B, retention by section, comments
// to answer (→ ideas), ✨ post-mortem (→ note "Post-mortem"), follow-up idea.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BASELINE_MIN_VIDEOS, videoHref } from "@/lib/youtube/constants";
import { VERDICT_LABEL, checkinLabel, metricsLine, ratioText, type Baseline, type SectionRetention, type StatPoint } from "@/lib/youtube/baseline";
import { formatDuration } from "@/lib/youtube/outliers";
import type { CheckinKind, CheckinVerdict, VideoMetrics } from "@/lib/youtube/types";
import {
  aiPostmortem, checkNow, commentToIdea, followUpIdea, loadCommentsNow, refreshStatsNow, savePostmortem, setCommentAnswered,
} from "@/app/youtube-actions/results";
import AbPanel, { type PairRow, type TestRow } from "@/components/youtube/results/AbPanel";
import { BOX, BTN, BTN_SM, INPUT, PRIMARY, VERDICT_CLASS, fmtDate, fmtDateTime } from "@/components/youtube/results/ui";

type CheckinRow = { id: string; kind: CheckinKind; due_at: string; done_at: string | null; metrics: VideoMetrics; baseline: VideoMetrics & { n?: number }; verdict: CheckinVerdict | null; notes: string | null };
type CommentRow = { id: string; comment_id: string | null; text: string; author: string | null; like_count: number | null; published_at: string | null; answered: boolean; idea_video_id: string | null };
type Props = {
  video: { id: string; kind: "long" | "short"; code: string | null; idea_name: string; published_at: string | null; ytId: string | null };
  checkins: CheckinRow[];
  viewGoal: number | null;
  tests: TestRow[];
  pairs: PairRow[];
  testRunning: boolean;
  swapOpen: boolean;
  advice: { suggest: boolean; reason: string; blocked?: string } | null;
  retention: SectionRetention[];
  retentionFrom: CheckinKind | null;
  sectionsEstimated: boolean;
  durationS: number | null;
  history: StatPoint[];
  comments: CommentRow[];
  postmortem: { id: string; text: string; note_id: string | null } | null;
  connected: boolean;
  apiKey: boolean;
  ai: boolean;
};

const baseOf = (b: CheckinRow["baseline"], goal: number | null): Baseline => {
  const views = typeof b?.views === "number" ? b.views : null;
  return { views, n: b?.n ?? 0, source: views ? "history" : goal ? "goal" : "none", goal };
};
const pct = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)} %`);

function ViewsChart({ hist, publishedAt }: { hist: StatPoint[]; publishedAt: string | null }) {
  const pts = [...(publishedAt ? [{ at: publishedAt, views: 0 }] : []), ...hist].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (pts.length < 2) return <p className="text-xs text-faint">The views chart fills in as the app reads the numbers (every ~6 hours with the API key).</p>;
  const W = 600;
  const H = 120;
  const t0 = Date.parse(pts[0].at);
  const t1 = Date.parse(pts[pts.length - 1].at) || t0 + 1;
  const vMax = Math.max(1, ...pts.map((p) => p.views));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(((Date.parse(p.at) - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(H - (p.views / vMax) * (H - 6)).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full text-accent" preserveAspectRatio="none" role="img" aria-label="Views over time">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="flex justify-between text-xs text-faint">
        <span>{fmtDate(pts[0].at)}</span>
        <span>{pts[pts.length - 1].views.toLocaleString("en-US")} views</span>
        <span>{fmtDate(pts[pts.length - 1].at)}</span>
      </p>
    </div>
  );
}

export default function FollowUpView(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error?: string; info?: string } | null>(null);
  const [draft, setDraft] = useState<string>(p.postmortem?.text ?? "");
  const [draftIsNew, setDraftIsNew] = useState(false);
  const [toNote, setToNote] = useState(true);
  const [idea, setIdea] = useState("");
  const [showAnswered, setShowAnswered] = useState(false);
  const now = Date.now();

  function run<T extends { error?: string; info?: string }>(key: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(key);
    setMsg(null);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (r.error) setMsg({ error: r.error });
      else {
        if (r.info) setMsg({ info: r.info });
        after?.(r);
      }
      router.refresh();
    });
  }

  const open = p.comments.filter((c) => !c.answered);
  const answered = p.comments.filter((c) => c.answered);

  return (
    <div className="space-y-5">
      {!p.apiKey && !p.connected && (
        <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
          Add <b>YOUTUBE_API_KEY</b> in Vercel (see ACTIVAR-YOUTUBE-API.md) so the app can read views. Connect Google in Settings for CTR, impressions and retention.
        </p>
      )}
      {msg && <p className={`rounded-md p-2 text-sm ${msg.error ? "bg-danger-soft text-danger" : "bg-success-soft text-fg"}`}>{msg.error ?? msg.info}</p>}

      {/* Check-ins */}
      <section className={BOX}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">Check-ins</h3>
          <span className="text-xs text-muted">
            Published {fmtDateTime(p.video.published_at)} · compared with the median of your last {p.video.kind === "short" ? "Shorts" : "long videos"} at the same point
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {p.checkins.map((c) => {
            const base = baseOf(c.baseline, p.viewGoal);
            const due = Date.parse(c.due_at) <= now;
            return (
              <div key={c.id} className="space-y-1.5 rounded-md border border-line p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{checkinLabel(c.kind)}</span>
                  {c.verdict && <span className={`rounded px-1.5 py-0.5 text-xs ${VERDICT_CLASS[c.verdict]}`}>{VERDICT_LABEL[c.verdict]}</span>}
                </div>
                {c.done_at ? (
                  <>
                    <p className="text-2xl font-semibold">{c.metrics.views?.toLocaleString("en-US") ?? "—"}</p>
                    <p className="text-xs text-muted">{metricsLine({ ...c.metrics, views: undefined })}</p>
                    <p className="text-xs">{ratioText(c.metrics.views, base) ?? (base.source === "none" ? `Not enough videos yet (${base.n}/${BASELINE_MIN_VIDEOS}). Set a view goal in Settings to compare.` : "")}</p>
                    {c.notes && <p className="text-xs text-faint">{c.notes}</p>}
                    <p className="text-xs text-faint">Read {fmtDateTime(c.done_at)}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted">{due ? "Due now — the app reads it within minutes." : `Due ${fmtDateTime(c.due_at)}`}</p>
                )}
                {(due || c.done_at) && (
                  <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(`ck${c.id}`, () => checkNow(c.id))}>
                    {busy === `ck${c.id}` ? "Reading…" : c.done_at ? "Refresh numbers" : "Check now"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-faint">
          Views, likes and comments are public (API key). CTR, impressions, retention and subscribers need Google connected and arrive 1–3 days late, so they start at the 7-day check-in.
        </p>
        <ViewsChart hist={p.history} publishedAt={p.video.published_at} />
        <button type="button" className={BTN_SM} disabled={pending} onClick={() => run("stats", () => refreshStatsNow(p.video.id))}>
          {busy === "stats" ? "Updating…" : "Update views now"}
        </button>
      </section>

      <AbPanel videoId={p.video.id} isShort={p.video.kind === "short"} pairs={p.pairs} tests={p.tests} testRunning={p.testRunning} swapOpen={p.swapOpen} advice={p.advice} connected={p.connected} />

      {/* Retention by section */}
      {p.video.kind === "long" && (
        <section className={BOX}>
          <h3 className="font-semibold">Where people leave (retention by section)</h3>
          {!p.connected ? (
            <p className="text-sm text-muted">Connect Google (Settings) to see the retention curve. It appears from the 7-day check-in.</p>
          ) : !p.retention.length ? (
            <p className="text-sm text-muted">No retention data yet{p.durationS ? "" : " (the video length is unknown — link the video in Publish)"}. It appears after the 7-day check-in.</p>
          ) : (
            <>
              {p.sectionsEstimated && <p className="text-xs text-warning">Section start times are estimated from the words of each section. Save the real start times in the Edit tab for exact results.</p>}
              <div className="space-y-1.5">
                {p.retention.map((r) => (
                  <div key={r.id} className={`grid grid-cols-[4.5rem_1fr_7rem] items-center gap-2 text-sm ${r.worst ? "font-medium text-danger" : ""}`}>
                    <span className="text-xs text-muted">{formatDuration(r.startS)}</span>
                    <span className="truncate">
                      {r.code ? `${r.code} · ` : ""}
                      {r.title}
                      {r.worst ? " — biggest drop" : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 flex-1 rounded bg-subtle">
                        <span className="block h-2 rounded bg-accent" style={{ width: `${Math.min(100, Math.round((r.endPct ?? 0) * 100))}%` }} />
                      </span>
                      <span className="text-xs">{pct(r.startPct)}→{pct(r.endPct)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-faint">From the {p.retentionFrom} check-in. 100 % = everyone who started is still watching.</p>
            </>
          )}
        </section>
      )}

      {/* Comments */}
      <section className={BOX}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Comments to answer {open.length ? `(${open.length})` : ""}</h3>
          <div className="flex gap-2">
            {p.video.ytId && (
              <a className={BTN_SM} href={`https://studio.youtube.com/video/${p.video.ytId}/comments`} target="_blank" rel="noreferrer">
                Reply in Studio ↗
              </a>
            )}
            <button type="button" className={BTN} disabled={pending || !p.video.ytId} onClick={() => run("cm", () => loadCommentsNow(p.video.id))}>
              {busy === "cm" ? "Loading…" : "Load new comments"}
            </button>
          </div>
        </div>
        {!open.length && <p className="text-sm text-muted">Nothing waiting. Load the comments to see the ones without a reply.</p>}
        <ul className="space-y-2">
          {(showAnswered ? [...open, ...answered] : open).slice(0, 60).map((c) => (
            <li key={c.id} className={`rounded-md border border-line p-2 text-sm ${c.answered ? "opacity-60" : ""}`}>
              <p className="whitespace-pre-wrap">{c.text}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{c.author ?? "Viewer"}</span>
                {c.like_count ? <span>👍 {c.like_count}</span> : null}
                <span>{fmtDate(c.published_at)}</span>
                <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(`a${c.id}`, () => setCommentAnswered(c.id, !c.answered))}>
                  {c.answered ? "Mark unanswered" : "✓ Answered"}
                </button>
                {c.idea_video_id ? (
                  <Link className="text-accent underline" href={videoHref(c.idea_video_id)}>
                    Idea →
                  </Link>
                ) : (
                  <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(`i${c.id}`, () => commentToIdea(c.id))}>
                    → New idea
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
        {answered.length > 0 && (
          <button type="button" className={BTN_SM} onClick={() => setShowAnswered(!showAnswered)}>
            {showAnswered ? "Hide answered" : `Show answered (${answered.length})`}
          </button>
        )}
      </section>

      {/* Post-mortem */}
      <section className={BOX}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Post-mortem</h3>
          <button
            type="button"
            className={BTN}
            disabled={pending || !p.ai}
            title={p.ai ? "" : "GROQ_API_KEY is missing"}
            onClick={() =>
              run("pm", () => aiPostmortem(p.video.id), (r) => {
                if ("text" in r && r.text) {
                  setDraft(r.text);
                  setDraftIsNew(true);
                }
              })
            }
          >
            {busy === "pm" ? "Writing…" : "✨ Draft with AI"}
          </button>
        </div>
        <p className="text-xs text-muted">What worked, what didn’t, 3 things to try next — from the numbers, the package, the sections and the A/B tests.</p>
        {draftIsNew && <p className="text-xs text-warning">AI draft — read it, edit it, then save or discard.</p>}
        <textarea className={`${INPUT} min-h-40 font-mono text-xs`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write your own notes, or press ✨ Draft with AI." />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={toNote} onChange={(e) => setToNote(e.target.checked)} /> Save as a note (Type: Post-mortem, linked to this video)
          </label>
          <button type="button" className={PRIMARY} disabled={pending || !draft.trim()} onClick={() => run("pms", () => savePostmortem(p.video.id, draft, toNote), () => setDraftIsNew(false))}>
            Save
          </button>
          {draftIsNew && (
            <button type="button" className={BTN_SM} onClick={() => { setDraft(p.postmortem?.text ?? ""); setDraftIsNew(false); }}>
              Discard draft
            </button>
          )}
          {p.postmortem?.note_id && (
            <Link className="text-sm text-accent underline" href={`/notes/${p.postmortem.note_id}`}>
              Open note →
            </Link>
          )}
        </div>
      </section>

      {/* Follow-up idea */}
      <section className={BOX}>
        <h3 className="font-semibold">Next video idea from this one</h3>
        <div className="flex gap-2">
          <input className={INPUT} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A follow-up, part 2, a question viewers asked…" />
          <button type="button" className={BTN} disabled={pending || !idea.trim()} onClick={() => run("idea", () => followUpIdea(p.video.id, idea), () => setIdea(""))}>
            Add to bank
          </button>
        </div>
      </section>
    </div>
  );
}
