"use client";
// Shorts of a long video (Worker C): the plan (2 Shorts cut from the long + 1 made on purpose), the Shorts
// already made, "New Short" (Teaser / Standalone / Test, time range of the long), the suggested days and the
// channel's Shorts baseline (kept apart from long videos).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createShort } from "@/app/youtube-actions/shorts";
import { myChannelBaseline } from "@/app/youtube-actions/api";
import { SHORT_ROLES, SHORT_TEST_MULTIPLIER, stageLabel, videoHref, YT_LIMITS } from "@/lib/youtube/constants";
import { parseStamp, shortRangeProblems, shortScheduleSuggestion, stamp, suggestPurposeRole, type ShortRoleId } from "@/lib/youtube/publish-rules";
import { addDays, daysBetween, utcToLocal } from "@/lib/time";
import { BOX, BTN, BTN_SM, Chip, INPUT, Msg, PRIMARY } from "@/components/youtube/script/ui";

export type ShortRow = { id: string; code: string | null; idea_name: string; stage: string; short_role: string | null; source_start_s: number | null; source_end_s: number | null; youtube_video_id: string | null; published_at: string | null };
type Props = {
  parent: { id: string; idea_name: string; published_at: string | null; youtube_video_id: string | null };
  shorts: ShortRow[];
  timezone: string;
  doubtfulIdeas: number;
  apiKey: boolean;
  durationS: number | null;
};

const fmtCount = (n: number | null | undefined) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));
const range = (a: number | null, b: number | null) => (a == null ? "made on purpose" : `${stamp(a)}–${b == null ? "?" : stamp(b)}`);

export default function ShortsPanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const teasers = p.shorts.filter((s) => s.short_role === "teaser");
  const purpose = p.shorts.filter((s) => s.short_role !== "teaser");
  const suggested = suggestPurposeRole(p.doubtfulIdeas);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ShortRoleId>(teasers.length < 2 ? "teaser" : suggested);
  const [name, setName] = useState("");
  const [hook, setHook] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<{ error?: string | null; info?: string | null }>({});
  const [base, setBase] = useState<{ short: number | null; long: number | null; nShort: number; nLong: number } | null>(null);

  const startS = from.trim() ? parseStamp(from) : null;
  const endS = to.trim() ? parseStamp(to) : null;
  const badTime = (from.trim() && startS == null) || (to.trim() && endS == null);
  const problems = badTime ? ["Write times like 1:05 or 65."] : shortRangeProblems(startS, endS, p.durationS);

  const longDate = p.parent.published_at ? utcToLocal(p.parent.published_at, p.timezone).date : null;
  const plan = longDate
    ? [
        { label: "Teaser 1", date: shortScheduleSuggestion({ longDate, role: "teaser", teaserIndex: 1, addDays, daysBetween }) },
        { label: "Teaser 2", date: shortScheduleSuggestion({ longDate, role: "teaser", teaserIndex: 2, addDays, daysBetween }) },
        { label: suggested === "test" ? "Test Short" : "Standalone Short", date: shortScheduleSuggestion({ longDate, role: suggested, teaserIndex: 0, addDays, daysBetween }) },
      ]
    : null;

  const create = () =>
    start(async () => {
      setMsg({});
      const r = await createShort(p.parent.id, { role, name, hook, start_s: startS, end_s: endS });
      if (r.error || !r.id) return setMsg({ error: r.error ?? "Could not create it." });
      setOpen(false);
      setName("");
      setHook("");
      setFrom("");
      setTo("");
      setMsg({ info: `Short ${r.code ?? ""} created.` });
      router.push(videoHref(r.id, "publish"));
    });
  const loadBase = () =>
    start(async () => {
      setMsg({});
      const r = await myChannelBaseline();
      if (r.error || !r.baseline) return setMsg({ error: r.error ?? "No baseline." });
      setBase({ short: r.baseline.medianShort, long: r.baseline.medianLong, nShort: r.baseline.nShort, nLong: r.baseline.nLong });
    });

  return (
    <section id="shorts" className={`${BOX} scroll-mt-20`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Shorts from this video</h3>
        <span className="text-xs text-muted">
          Plan: 2 cut from the long ({Math.min(teasers.length, 2)}/2) + 1 made on purpose ({Math.min(purpose.length, 1)}/1) · ~half a day
        </span>
      </div>
      {p.shorts.length > 0 ? (
        <ul className="divide-y divide-line text-sm">
          {p.shorts.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="rounded bg-subtle px-1.5 font-mono text-xs text-muted">{s.code ?? "Idea"}</span>
              <Link href={videoHref(s.id)} className="min-w-0 flex-1 truncate hover:text-accent">
                {s.idea_name}
              </Link>
              <span className="rounded-full border border-line px-2 text-xs text-muted">{SHORT_ROLES.find((r) => r.id === s.short_role)?.label ?? "Short"}</span>
              <span className="text-xs text-faint">{range(s.source_start_s, s.source_end_s)}</span>
              <span className="text-xs text-muted">{stageLabel(s.stage)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No Shorts yet.</p>
      )}
      {plan && (
        <p className="text-xs text-muted">
          Suggested days: {plan.map((x) => `${x.label} ${x.date}`).join(" · ")}
        </p>
      )}
      {!open ? (
        <button type="button" className={BTN} onClick={() => setOpen(true)}>
          + New Short
        </button>
      ) : (
        <div className="space-y-2 rounded-md border border-line p-3">
          <div className="flex flex-wrap gap-1.5">
            {SHORT_ROLES.map((r) => (
              <Chip key={r.id} on={role === r.id} onClick={() => setRole(r.id)} title={r.hint}>
                {r.label}
                {r.id === suggested && r.id !== "teaser" ? " (suggested)" : ""}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-muted">{SHORT_ROLES.find((r) => r.id === role)?.hint}</p>
          {role === "test" && <p className="text-xs text-muted">If it gets ≥ {SHORT_TEST_MULTIPLIER}× your usual Shorts views, it goes back to the idea bank with a bonus.</p>}
          {suggested === "test" && role !== "test" && p.doubtfulIdeas > 0 && <p className="text-xs text-muted">You have {p.doubtfulIdeas} doubtful ideas in the bank — a Test Short can check one cheaply.</p>}
          <input className={INPUT} placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          <input className={INPUT} placeholder="Hook: on-screen text of the first 1–2 seconds" value={hook} onChange={(e) => setHook(e.target.value)} maxLength={300} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Clip of the long video:</span>
            <input className={`${INPUT} w-24`} placeholder="from 1:05" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Clip start" />
            <span>–</span>
            <input className={`${INPUT} w-24`} placeholder="to 1:50" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Clip end" />
            {startS != null && endS != null && endS > startS && <span className="text-xs text-faint">{endS - startS} s (max {YT_LIMITS.shortMaxSeconds})</span>}
          </div>
          <p className="text-xs text-muted">
            {role === "teaser" ? "Teasers are cut from the long video: give the time range (best moment, end on an open loop)." : "Leave the range empty for a Short made on purpose (it gets a short script: Hook · Body · Payoff/Loop)."}
            {" "}Vertical: crop 9:16 for a centered talking head; re-record wide screen recordings vertically.
          </p>
          {problems.map((x) => <p key={x} className="text-xs text-danger">✗ {x}</p>)}
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} disabled={pending || problems.length > 0 || (role === "teaser" && startS == null)} onClick={create}>
              {pending ? "Creating…" : "Create Short"}
            </button>
            <button type="button" className={BTN_SM} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Shorts are measured against your usual Shorts, never against long videos.</span>
        {p.apiKey && !base && (
          <button type="button" className={BTN_SM} disabled={pending} onClick={loadBase}>
            Show my Shorts baseline
          </button>
        )}
        {base && (
          <span>
            Usual views — Shorts: <b className="text-fg">{fmtCount(base.short)}</b> ({base.nShort} Shorts) · Long: <b className="text-fg">{fmtCount(base.long)}</b> ({base.nLong} videos)
          </span>
        )}
      </div>
      <Msg error={msg.error} info={msg.info} />
    </section>
  );
}
