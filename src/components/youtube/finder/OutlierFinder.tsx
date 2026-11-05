"use client";
// Topic step · Outlier finder (Worker C). Mounted by Worker A in /youtube/v/[id]/idea:
//   <OutlierFinder videoId={video.id} topic={…} savedYtIds={…} />
// Searches YouTube for the topic, keeps videos with ≥ N× their channel's usual views (filters editable), and
// saves picks as references of the video (yt_references, source "finder") → router.refresh().
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { YT_QUOTA } from "@/lib/youtube/constants";
import { ageDays, formatCount, formatDuration, type OutlierCandidate } from "@/lib/youtube/outliers";
import type { FinderFilters } from "@/lib/youtube/types";
import {
  finderSetup, myChannelBaseline, runFinder, saveFinderFilters, saveFinderReference, unsaveFinderReference,
  type FinderSetup,
} from "@/app/youtube-actions/api";

export type OutlierFinderProps = { videoId: string; topic: string; savedYtIds: string[] };

const INPUT = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-faint";
const BTN = "rounded-md border border-line-strong px-2.5 py-1 text-sm text-fg hover:bg-subtle disabled:opacity-50";
const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50";

const REASON_LABEL: Record<string, string> = { views: "too few views", subs: "channel too big", outlier: "not an outlier", age: "too new / too old", shorts: "Shorts filter", unknown: "no view count" };

type Answer = NonNullable<Awaited<ReturnType<typeof runFinder>>["answer"]>;
type Base = NonNullable<Awaited<ReturnType<typeof myChannelBaseline>>["baseline"]>;

export default function OutlierFinder({ videoId, topic, savedYtIds }: OutlierFinderProps) {
  const router = useRouter();
  const [setup, setSetup] = useState<(FinderSetup & { error?: string }) | null>(null);
  const [query, setQuery] = useState(topic);
  const [filters, setFilters] = useState<FinderFilters | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [base, setBase] = useState<Base | null>(null);
  const [baseNote, setBaseNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set(savedYtIds));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const savedKey = savedYtIds.join(",");
  useEffect(() => setSaved(new Set(savedKey ? savedKey.split(",") : [])), [savedKey]);
  useEffect(() => setQuery((q) => (q.trim() ? q : topic)), [topic]);

  useEffect(() => {
    let alive = true;
    finderSetup().then((s) => {
      if (!alive) return;
      setSetup(s);
      setFilters(s.filters);
      if (s.apiKey && s.channelUrl)
        myChannelBaseline().then((b) => {
          if (!alive) return;
          if (b.baseline) setBase(b.baseline);
          else if (b.error && !b.noKey) setBaseNote(b.error);
        });
      else if (s.apiKey) setBaseNote("Add your channel link in Settings to see your own usual views here.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const quota = setup?.quota;
  const searchesLeft = quota ? quota.searchLeft : YT_QUOTA.searchCallsPerDay;

  function search(force = false) {
    if (!filters) return;
    setError(null);
    setInfo(null);
    start(async () => {
      const r = await runFinder(query, filters, force);
      if (r.quota && setup) setSetup({ ...setup, quota: r.quota });
      if (r.error) setError(r.error);
      if (r.answer) setAnswer(r.answer);
    });
  }

  function saveDefaults() {
    if (!filters) return;
    start(async () => {
      const r = await saveFinderFilters(filters);
      if (r.error) setError(r.error);
      else setInfo("Filters saved as your default.");
    });
  }

  async function toggle(c: OutlierCandidate) {
    setBusyId(c.id);
    setError(null);
    const isSaved = saved.has(c.id);
    const r = isSaved ? await unsaveFinderReference(videoId, c.id) : await saveFinderReference(videoId, c);
    setBusyId(null);
    if (r.error) return setError(r.error);
    setSaved((s) => {
      const n = new Set(s);
      if (isSaved) n.delete(c.id);
      else n.add(c.id);
      return n;
    });
    router.refresh();
  }

  if (!setup) return <p className="text-sm text-faint">Loading the outlier finder…</p>;

  if (!setup.apiKey) return <NoKey topic={query || topic} />;

  return (
    <div className="space-y-3 text-sm">
      {base ? (
        <p className="text-xs text-muted">
          Your channel{base.title ? ` (${base.title})` : ""} usually gets <b className="text-fg">{formatCount(base.medianLong)}</b> views per long video
          {base.medianShort !== null ? <> and <b className="text-fg">{formatCount(base.medianShort)}</b> per Short</> : null}
          {setup.viewGoal ? <> · your goal: <b className="text-fg">{formatCount(setup.viewGoal)}</b></> : null}.
        </p>
      ) : baseNote ? (
        <p className="text-xs text-faint">{baseNote}</p>
      ) : null}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(false);
        }}
      >
        <input className={`${INPUT} min-w-0 flex-1`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Topic to search on YouTube" maxLength={200} aria-label="Topic to search" />
        <button className={PRIMARY} disabled={pending || query.trim().length < 2 || searchesLeft <= 0}>
          {pending ? "Searching…" : "Find outliers"}
        </button>
        <button type="button" className={BTN} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          Filters
        </button>
      </form>
      <p className="text-xs text-faint">
        Each new search uses 1 of your {YT_QUOTA.searchCallsPerDay} daily searches ({searchesLeft} left today). The same search is reused for 24 h for free.
      </p>

      {showFilters && filters ? <Filters f={filters} onChange={setFilters} onSave={saveDefaults} pending={pending} /> : null}

      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : null}
      {info ? <p className="text-xs text-success">{info}</p> : null}

      {answer ? <Results a={answer} saved={saved} busyId={busyId} onToggle={toggle} onFresh={() => search(true)} pending={pending} viewGoal={setup.viewGoal} /> : null}
    </div>
  );
}

function NoKey({ topic }: { topic: string }) {
  const q = encodeURIComponent(topic.slice(0, 120));
  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
      <p className="font-medium text-fg">Add YOUTUBE_API_KEY to turn on the outlier finder.</p>
      <p className="text-xs text-muted">
        It is a free key from Google Cloud. Follow <b>ACTIVAR-YOUTUBE-API.md</b> (in the PERSONAL OS folder), add it in Vercel → Settings → Environment Variables, and redeploy.
      </p>
      <p className="text-xs text-muted">Meanwhile, search by hand and paste the best links as references:</p>
      <a href={`https://www.youtube.com/results?search_query=${q}`} target="_blank" rel="noreferrer" className={`${BTN} inline-block`}>
        Search “{topic.slice(0, 50)}{topic.length > 50 ? "…" : ""}” on YouTube ↗
      </a>
    </div>
  );
}

function Num({ label, value, onChange, step = 1, hint }: { label: string; value: number | null | undefined; onChange: (n: number | null) => void; step?: number; hint?: string }) {
  return (
    <label className="block space-y-1 text-xs text-muted" title={hint}>
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        className={INPUT}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </label>
  );
}

function Filters({ f, onChange, onSave, pending }: { f: FinderFilters; onChange: (f: FinderFilters) => void; onSave: () => void; pending: boolean }) {
  const set = (k: keyof FinderFilters) => (n: number | null) => onChange({ ...f, [k]: n ?? (k === "published_after_days" ? null : 0) });
  return (
    <div className="space-y-3 rounded-md border border-line bg-subtle p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Num label="Min views" value={f.min_views} onChange={set("min_views")} step={1000} />
        <Num label="Max channel subscribers" value={f.max_subs} onChange={set("max_subs")} step={10000} />
        <Num label="Min outlier (× usual views)" value={f.min_outlier} onChange={set("min_outlier")} step={0.5} />
        <Num label="Older than (days)" value={f.min_age_days} onChange={set("min_age_days")} hint="Very new videos are still growing" />
        <Num label="Newer than (days, empty = any)" value={f.published_after_days ?? null} onChange={set("published_after_days")} />
        <Num label="Max results" value={f.max_results} onChange={set("max_results")} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>Shorts:</span>
        {(["exclude", "include", "only"] as const).map((v) => (
          <label key={v} className="flex items-center gap-1">
            <input type="radio" name="finder-shorts" checked={(f.shorts ?? "exclude") === v} onChange={() => onChange({ ...f, shorts: v })} />
            {v === "exclude" ? "Leave out" : v === "include" ? "Include" : "Only Shorts"}
          </label>
        ))}
        <button type="button" className={`${BTN} ml-auto text-xs`} onClick={onSave} disabled={pending}>
          Save as default
        </button>
      </div>
      <p className="text-xs text-faint">These filters apply to this search. “Save as default” stores them for every idea (also in Settings).</p>
    </div>
  );
}

function Results({ a, saved, busyId, onToggle, onFresh, pending, viewGoal }: { a: Answer; saved: Set<string>; busyId: string | null; onToggle: (c: OutlierCandidate) => void; onFresh: () => void; pending: boolean; viewGoal: number | null }) {
  const now = useMemo(() => new Date(), []);
  const left = Object.entries(a.rejected).filter(([, n]) => n);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          <b className="text-fg">{a.outliers.length}</b> outlier{a.outliers.length === 1 ? "" : "s"} out of {a.checked} videos for “{a.query}”
        </span>
        {a.aboveGoal !== null && viewGoal ? (
          <span>
            · <b className="text-fg">{a.aboveGoal}</b> above your view goal ({formatCount(viewGoal)})
          </span>
        ) : null}
        {a.cached ? (
          <span>
            · saved result from {new Date(a.at).toLocaleString()}{" "}
            <button type="button" className="underline hover:text-fg disabled:opacity-50" onClick={onFresh} disabled={pending}>
              search again
            </button>
          </span>
        ) : null}
      </div>
      {left.length ? <p className="text-xs text-faint">Left out: {left.map(([k, n]) => `${n} ${REASON_LABEL[k] ?? k}`).join(" · ")}</p> : null}
      {a.outliers.length === 0 ? (
        <p className="rounded-md border border-line p-3 text-xs text-muted">
          No video passed the filters. Try a broader topic, or lower “Min views” / “Min outlier” in Filters. Few outliers can also mean the topic does not explode — that is useful to know too.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {a.outliers.map((c) => {
            const isSaved = saved.has(c.id);
            const age = ageDays(c.publishedAt, now);
            return (
              <li key={c.id} className="flex gap-3 rounded-md border border-line bg-surface p-2">
                <a href={c.url} target="_blank" rel="noreferrer" className="relative block w-32 shrink-0">
                  {c.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnail} alt="" className="aspect-video w-full rounded object-cover" loading="lazy" />
                  ) : (
                    <div className="aspect-video w-full rounded bg-subtle" />
                  )}
                  {c.durationS ? <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] text-white">{formatDuration(c.durationS)}</span> : null}
                </a>
                <div className="min-w-0 flex-1 space-y-1">
                  <a href={c.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium text-fg hover:underline">
                    {c.title}
                  </a>
                  <p className="truncate text-xs text-muted">
                    {c.channelTitle ?? "—"} · {c.channelSubs === null ? "hidden subs" : `${formatCount(c.channelSubs)} subs`}
                  </p>
                  <p className="text-xs text-muted">
                    <span className="mr-1 rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">{c.outlierScore ?? "?"}×</span>
                    {formatCount(c.views)} views · usual {formatCount(c.channelMedian)}
                    {age !== null ? ` · ${age < 60 ? `${Math.round(age)} d` : age < 730 ? `${Math.round(age / 30)} mo` : `${Math.round(age / 365)} y`} ago` : ""}
                    {c.isShort ? " · Short" : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => onToggle(c)}
                    disabled={busyId === c.id}
                    className={`rounded border px-2 py-0.5 text-xs disabled:opacity-50 ${isSaved ? "border-success/50 bg-success-soft text-success" : "border-line text-muted hover:bg-subtle hover:text-fg"}`}
                  >
                    {busyId === c.id ? "…" : isSaved ? "✓ Saved — remove" : "Save as reference"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-faint">
        Score = views ÷ the channel’s usual views (median of its recent uploads of the same kind). Filters and defaults also live in{" "}
        <Link href="/youtube/settings" className="underline">Settings</Link>.
      </p>
    </div>
  );
}
