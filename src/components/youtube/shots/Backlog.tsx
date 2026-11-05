"use client";
// Missing shots backlog: every shot not filmed yet, from all videos (pickups included), grouped by setup and
// filterable by setup / location, so any filming day can clear shots of several videos at once.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { setShotDone } from "@/app/youtube-actions/shots";
import { SHOT_KINDS, videoHref } from "@/lib/youtube/constants";
import type { ShotKind, YtShot } from "@/lib/youtube/types";
import { Chip, INPUT, Msg } from "@/components/youtube/script/ui";
import { cameraSummary, distinctValues, filterBacklog, groupBySetup, kindLabel, setupKey, shotName, shotTag } from "./logic";
import { CopyName } from "./ShotCard";

export type BacklogShot = YtShot & { videoCode: string | null; videoName: string; sectionNum: number | null; sectionTitle: string | null };

const SELECT = "rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm";

export default function Backlog({ shots }: { shots: BacklogShot[] }) {
  const router = useRouter();
  const [setup, setSetup] = useState("");
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState<ShotKind | "">("");
  const [video, setVideo] = useState("");
  const [pickupsOnly, setPickupsOnly] = useState(false);
  const [q, setQ] = useState("");
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => setDone({}), [shots]);
  const [err, setErr] = useState<string | null>(null);

  const setupOptions = useMemo(() => distinctValues(shots.map((s) => setupKey(s))), [shots]);
  const locationOptions = useMemo(() => distinctValues(shots.map((s) => s.location)), [shots]);
  const videos = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of shots) if (!m.has(s.video_id)) m.set(s.video_id, `${s.videoCode ?? "VXXX"} · ${s.videoName}`);
    return [...m.entries()];
  }, [shots]);
  const list = useMemo(
    () => filterBacklog(shots, { setup: setup || null, location: location || null, kind: kind || null, video: video || null, pickupsOnly, q }),
    [shots, setup, location, kind, video, pickupsOnly, q],
  );
  const groups = useMemo(() => groupBySetup(list.map((s) => ({ ...s, done: done[s.id] ?? false }))), [list, done]);

  const toggle = async (s: BacklogShot) => {
    const next = !(done[s.id] ?? false);
    setDone((d) => ({ ...d, [s.id]: next }));
    const r = await setShotDone(s.id, next);
    if (r.error) {
      setDone((d) => ({ ...d, [s.id]: !next }));
      setErr(r.error);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Missing shots</h2>
        <p className="text-sm text-muted">
          Every shot not filmed yet, from all your videos (pickups included). Pick a setup or a place and film shots of several videos in one go.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 shadow-card">
        <select className={SELECT} value={setup} onChange={(e) => setSetup(e.target.value)} aria-label="Setup">
          <option value="">All setups</option>
          {setupOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={SELECT} value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location">
          <option value="">All locations</option>
          {locationOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as ShotKind | "")} aria-label="Type">
          <option value="">All types</option>
          {SHOT_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.id} · {k.label}
            </option>
          ))}
        </select>
        <select className={SELECT} value={video} onChange={(e) => setVideo(e.target.value)} aria-label="Video">
          <option value="">All videos</option>
          {videos.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <Chip on={pickupsOnly} onClick={() => setPickupsOnly((p) => !p)}>
          Pickups only
        </Chip>
        <input className={`${INPUT} max-w-[14rem]`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search" />
        <button type="button" className="ml-auto text-xs text-accent underline" onClick={() => router.refresh()}>
          Refresh
        </button>
      </div>
      <Msg error={err} />
      <p className="text-sm text-muted">
        {list.length} of {shots.length} shots
      </p>
      {shots.length === 0 && <p className="rounded-lg border border-line bg-surface p-6 text-sm text-muted shadow-card">Nothing missing — every planned shot is filmed. 🎉</p>}
      {groups.map((g) => (
        <section key={g.key} className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2">
            <span className="font-semibold">📍 {g.key}</span>
            <span className="text-xs text-muted">
              {g.done}/{g.total} filmed now
            </span>
          </div>
          <ul className="divide-y divide-line">
            {g.shots.map((s) => {
              const name = shotName(s.videoCode, s.sectionNum, s);
              const cam = cameraSummary(s);
              return (
                <li key={s.id} className={`flex items-start gap-3 px-3 py-2.5 ${s.done ? "opacity-60" : ""}`}>
                  <button
                    type="button"
                    onClick={() => void toggle(s)}
                    aria-pressed={s.done}
                    aria-label={s.done ? "Filmed — tap to undo" : "Mark as filmed"}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 text-xl font-bold ${s.done ? "border-success bg-success-solid text-white" : "border-line-strong text-faint hover:bg-subtle"}`}
                  >
                    ✓
                  </button>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Link href={videoHref(s.video_id, "shots")} className="font-medium text-accent hover:underline">
                        {s.videoCode ?? "VXXX"} · {s.videoName}
                      </Link>
                      <span className="font-mono text-muted">{shotTag(s.sectionNum, s.num)}</span>
                      <span className="rounded bg-subtle px-1.5 py-0.5 font-medium" title={kindLabel(s.kind)}>
                        {s.kind}
                      </span>
                      {s.is_pickup && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-warning">Pickup</span>}
                      {s.script_changed && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-warning">Script changed</span>}
                    </div>
                    <p className="text-sm">{s.description || (s.kind === "AR" ? "Talking head" : kindLabel(s.kind))}</p>
                    {s.line_text && <p className="line-clamp-2 text-xs italic text-muted">“{s.line_text}”</p>}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {s.location && <span>{s.location}</span>}
                      {cam && <span>· {cam}</span>}
                      <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg">{name}</code>
                      <CopyName name={name} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
