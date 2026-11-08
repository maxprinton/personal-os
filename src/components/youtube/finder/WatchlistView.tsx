"use client";
// /youtube/watchlist UI (Worker C): add/remove/pause channels, "Check now", and the New outliers inbox.
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WATCH_CHECK_DAYS, videoHref } from "@/lib/youtube/constants";
import { formatCount } from "@/lib/youtube/outliers";
import type { YtWatchChannel, YtWatchOutlier } from "@/lib/youtube/types";
import {
  addWatchChannel, checkWatchNow, referenceTargets, removeWatchChannel, saveWatchOutlier, setWatchChannelActive, setWatchOutlierStatus,
  watchOutlierToIdea,
} from "@/app/youtube-actions/api";

const INPUT = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-faint";
const BTN = "rounded-md border border-line-strong px-2.5 py-1 text-sm text-fg hover:bg-subtle disabled:opacity-50";
const BTN_SM = "rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-fg disabled:opacity-50";
const PRIMARY = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50";
const BOX = "space-y-3 rounded-lg border border-line bg-surface p-4 shadow-card";

type Props = { channels: YtWatchChannel[]; outliers: YtWatchOutlier[]; apiKey: boolean; error: string | null };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");

export default function WatchlistView({ channels, outliers, apiKey, error }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<{ error?: string; info?: string } | null>(error ? { error } : null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [targets, setTargets] = useState<{ id: string; label: string }[]>([]);
  const [showHandled, setShowHandled] = useState(false);

  useEffect(() => {
    referenceTargets().then((r) => setTargets(r.items));
  }, []);

  const byRow = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const fresh = outliers.filter((o) => o.status === "new");
  const handled = outliers.filter((o) => o.status !== "new");

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
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {!apiKey ? (
        <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-fg">
          Add <b>YOUTUBE_API_KEY</b> in Vercel to check channels (see ACTIVAR-YOUTUBE-API.md). You can still see what was found before.
        </p>
      ) : null}
      {msg?.error ? <p className="text-sm text-danger" role="alert">{msg.error}</p> : null}
      {msg?.info ? <p className="text-sm text-success">{msg.info}</p> : null}

      <section className={BOX}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">New outliers {fresh.length ? <span className="text-muted">({fresh.length})</span> : null}</h3>
          {handled.length ? (
            <button type="button" className={BTN_SM} onClick={() => setShowHandled((v) => !v)}>
              {showHandled ? "Hide handled" : `Show handled (${handled.length})`}
            </button>
          ) : null}
        </div>
        {fresh.length === 0 ? (
          <p className="text-sm text-muted">Nothing new. {channels.length ? "The next daily check will look again." : "Add a channel below to start."}</p>
        ) : (
          <ul className="space-y-2">
            {fresh.map((o) => (
              <OutlierRow key={o.id} o={o} channel={o.channel_row_id ? byRow.get(o.channel_row_id) ?? null : null} targets={targets} busy={busy === o.id && pending} run={run} />
            ))}
          </ul>
        )}
        {showHandled && handled.length ? (
          <ul className="space-y-2 border-t border-line pt-3 opacity-80">
            {handled.map((o) => (
              <OutlierRow key={o.id} o={o} channel={o.channel_row_id ? byRow.get(o.channel_row_id) ?? null : null} targets={targets} busy={busy === o.id && pending} run={run} />
            ))}
          </ul>
        ) : null}
      </section>

      <section className={BOX}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Watched channels ({channels.length})</h3>
          {channels.some((c) => c.active) ? (
            <button type="button" className={BTN} disabled={!apiKey || pending} onClick={() => run("all", () => checkWatchNow(null))}>
              {busy === "all" && pending ? "Checking…" : "Check all now"}
            </button>
          ) : null}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("add", () => addWatchChannel(input), () => setInput(""));
          }}
        >
          <input className={`${INPUT} min-w-0 flex-1`} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Channel link or @handle (youtube.com/@name)" aria-label="Channel link or handle" />
          <button className={PRIMARY} disabled={!apiKey || pending || !input.trim()}>
            {busy === "add" && pending ? "Adding…" : "Add channel"}
          </button>
        </form>
        <p className="text-xs text-faint">Adding a channel checks it right away (≈ 4 quota units). Each daily check costs ≈ 3 units per channel (20 channels ≈ 60 of your 10,000 daily units).</p>
        {channels.length ? (
          <ul className="divide-y divide-line">
            {channels.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                {c.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumbnail_url} alt="" className="h-9 w-9 rounded-full object-cover" loading="lazy" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-subtle" />
                )}
                <div className="min-w-0 flex-1">
                  <a href={c.url ?? `https://www.youtube.com/channel/${c.channel_id}`} target="_blank" rel="noreferrer" className={`text-sm font-medium hover:underline ${c.active ? "text-fg" : "text-faint line-through"}`}>
                    {c.title}
                  </a>
                  <p className="text-xs text-muted">
                    {c.handle ? `${c.handle} · ` : ""}
                    {c.subs === null ? "hidden subs" : `${formatCount(c.subs)} subs`} · usual {formatCount(c.median_views)} views · checked {fmtDate(c.last_checked_at)}
                    {c.active ? "" : " · paused"}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button type="button" className={BTN_SM} disabled={!apiKey || pending || !c.active} onClick={() => run(c.id, () => checkWatchNow(c.id))}>
                    {busy === c.id && pending ? "…" : "Check now"}
                  </button>
                  <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(c.id, () => setWatchChannelActive(c.id, !c.active))}>
                    {c.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    className={`${BTN_SM} hover:text-danger`}
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`Stop watching ${c.title}? Its untouched outliers are removed too (saved ones stay).`)) run(c.id, () => removeWatchChannel(c.id));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No channels yet. Add 5–15 channels of your niche (similar size or a bit bigger than yours).</p>
        )}
        <p className="text-xs text-faint">Active channels are checked automatically every {WATCH_CHECK_DAYS === 1 ? "day" : `${WATCH_CHECK_DAYS} days`}.</p>
      </section>
    </div>
  );
}

function OutlierRow({
  o,
  channel,
  targets,
  busy,
  run,
}: {
  o: YtWatchOutlier;
  channel: YtWatchChannel | null;
  targets: { id: string; label: string }[];
  busy: boolean;
  run: <T extends { error?: string; info?: string }>(key: string, fn: () => Promise<T>, after?: (r: T) => void) => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const url = o.url ?? `https://www.youtube.com/watch?v=${o.yt_id}`;
  return (
    <li className="flex flex-wrap gap-3 rounded-md border border-line p-2">
      <a href={url} target="_blank" rel="noreferrer" className="block w-32 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={o.thumbnail_url ?? `https://i.ytimg.com/vi/${o.yt_id}/hqdefault.jpg`} alt="" className="aspect-video w-full rounded object-cover" loading="lazy" />
      </a>
      <div className="min-w-0 flex-1 space-y-1">
        <a href={url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium text-fg hover:underline">
          {o.title}
        </a>
        <p className="text-xs text-muted">
          <span className="mr-1 rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">{o.outlier_score ?? "?"}×</span>
          {formatCount(o.views)} views · usual {formatCount(o.channel_median)}
          {channel ? ` · ${channel.title}` : ""}
          {o.published_at ? ` · ${new Date(o.published_at).toLocaleDateString()}` : ""}
        </p>
        {o.status === "new" ? (
          <div className="flex flex-wrap items-center gap-1">
            <select className="rounded border border-line bg-surface px-1 py-0.5 text-xs text-fg" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Save to video">
              <option value="">Loose reference (no video)</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="button" className={BTN_SM} disabled={busy} onClick={() => run(o.id, () => saveWatchOutlier(o.id, target || null), () => undefined)}>
              Save as reference
            </button>
            <button
              type="button"
              className={BTN_SM}
              disabled={busy}
              onClick={() =>
                run(o.id, () => watchOutlierToIdea(o.id), (r) => {
                  const id = (r as { videoId?: string }).videoId;
                  if (id) router.push(videoHref(id, "idea"));
                })
              }
            >
              Create idea
            </button>
            <button type="button" className={`${BTN_SM} hover:text-danger`} disabled={busy} onClick={() => run(o.id, () => setWatchOutlierStatus(o.id, "dismissed"))}>
              Dismiss
            </button>
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-xs text-faint">
            {o.status === "saved" ? "Saved as reference" : o.status === "idea" ? "Turned into an idea" : "Dismissed"}
            {o.video_id ? (
              <Link href={videoHref(o.video_id)} className="underline">
                open video
              </Link>
            ) : null}
            {o.status === "dismissed" ? (
              <button type="button" className={BTN_SM} disabled={busy} onClick={() => run(o.id, () => setWatchOutlierStatus(o.id, "new"))}>
                Back to new
              </button>
            ) : null}
          </p>
        )}
      </div>
    </li>
  );
}
