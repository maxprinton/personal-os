"use client";
// Filming mode (phone-friendly, full screen): shots grouped by setup so everything of one setup is filmed
// at once, big ✓ buttons, a Moments log (funny, fail, reveal, effort…) and the Intro tab.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { addMoment, deleteMoment, setShotDone } from "@/app/youtube-actions/shots";
import { MOMENT_KINDS, videoHref } from "@/lib/youtube/constants";
import type { MomentKind, YtKind, YtMoment, YtSection, YtShot } from "@/lib/youtube/types";
import type { PinnedPair } from "@/components/youtube/script/ScriptWorkspace";
import IntroFilmTab from "@/components/youtube/intro/IntroFilmTab";
import { BTN_SM, Chip, Msg, PRIMARY } from "@/components/youtube/script/ui";
import { cameraSummary, groupBySetup, kindLabel, setupSummary, shotName, shotTag } from "./logic";
import { CopyName } from "./ShotCard";
import type { ShotSection } from "./load";

type Tab = "shots" | "moments" | "intro";
type VideoInfo = { id: string; code: string | null; idea_name: string; kind: YtKind };

export default function FilmMode({
  video,
  sections,
  rawSections,
  shots,
  moments,
  pinned,
  wpm,
  aiReady,
  drift = false,
}: {
  video: VideoInfo;
  sections: ShotSection[];
  rawSections: YtSection[];
  shots: YtShot[];
  moments: YtMoment[];
  pinned: PinnedPair;
  wpm: number;
  aiReady: boolean;
  drift?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("shots");
  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(shots.map((s) => [s.id, s.done])));
  useEffect(() => setDone(Object.fromEntries(shots.map((s) => [s.id, s.done]))), [shots]);
  const [hideDone, setHideDone] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [lastShot, setLastShot] = useState<string | null>(null);

  const secById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const live = useMemo(() => shots.map((s) => ({ ...s, done: done[s.id] ?? s.done })), [shots, done]);
  const groups = useMemo(() => groupBySetup(live), [live]);
  const total = live.length;
  const filmed = live.filter((s) => s.done).length;

  const toggle = async (s: YtShot) => {
    const next = !done[s.id];
    setDone((d) => ({ ...d, [s.id]: next }));
    if (next) setLastShot(s.id);
    if (navigator.vibrate) navigator.vibrate(30);
    const r = await setShotDone(s.id, next);
    if (r.error) {
      setDone((d) => ({ ...d, [s.id]: !next }));
      setErr(r.error);
    } else router.refresh();
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-app text-fg">
      <header className="sticky top-14 z-10 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <Link href={videoHref(video.id, "shots")} className={BTN_SM} aria-label="Back to the shot list">
            ← Back
          </Link>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">
            🎬 {video.code ?? "VXXX"} · {video.idea_name}
          </div>
          <span className="text-xs text-muted">
            {filmed}/{total} filmed
          </span>
        </div>
        <div className="mx-auto mt-2 flex max-w-3xl gap-1">
          {(
            [
              ["shots", "Shots"],
              ["moments", `Moments${moments.length ? ` (${moments.length})` : ""}`],
              ["intro", "Intro"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${tab === id ? "bg-accent text-accent-fg" : "bg-subtle text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mx-auto mt-2 h-1.5 max-w-3xl overflow-hidden rounded-full bg-subtle" aria-hidden>
          <div className="h-full bg-success-solid transition-all" style={{ width: `${total ? (filmed / total) * 100 : 0}%` }} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-4 pb-24">
        <Msg error={err} />
        {tab === "shots" && (
          <>
            {drift && (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                The script changed since the shot list was updated.{" "}
                <Link className="underline" href={videoHref(video.id, "shots")}>
                  Open the Shots tab
                </Link>{" "}
                to update it.
              </p>
            )}
            {!total && (
              <p className="text-sm text-muted">
                No shots yet. Open the{" "}
                <Link className="text-accent underline" href={videoHref(video.id, "shots")}>
                  Shots tab
                </Link>{" "}
                first (it makes them from the script).
              </p>
            )}
            {total > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="h-5 w-5" />
                Hide filmed shots
              </label>
            )}
            {groups.map((g) => {
              const list = hideDone ? g.shots.filter((s) => !s.done) : g.shots;
              const isClosed = closed[g.key] ?? false;
              return (
                <section key={g.key} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setClosed((c) => ({ ...c, [g.key]: !isClosed }))} aria-expanded={!isClosed}>
                      <span className="block truncate font-semibold">📍 {g.key}</span>
                      <span className="text-xs text-muted">
                        {g.done}/{g.total} filmed{g.done === g.total ? " · all done ✓" : ""}
                      </span>
                    </button>
                    <Link href={`${videoHref(video.id, "prompter")}?setup=${encodeURIComponent(g.key)}`} className={BTN_SM}>
                      📜 Prompter
                    </Link>
                  </div>
                  {!isClosed && (
                    <ul className="divide-y divide-line">
                      {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">All filmed here.</li>}
                      {list.map((s) => {
                        const sec = s.section_id ? secById.get(s.section_id) : undefined;
                        const name = shotName(video.code, sec?.num ?? null, s);
                        const cam = cameraSummary(s);
                        const extra = setupSummary(s);
                        return (
                          <li key={s.id} className={`flex items-start gap-3 px-3 py-3 ${s.done ? "opacity-60" : ""}`}>
                            <button
                              type="button"
                              onClick={() => void toggle(s)}
                              aria-pressed={s.done}
                              aria-label={s.done ? "Filmed — tap to undo" : "Mark as filmed"}
                              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 text-2xl font-bold ${s.done ? "border-success bg-success-solid text-white" : "border-line-strong text-faint active:bg-subtle"}`}
                            >
                              ✓
                            </button>
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="font-mono text-muted">{shotTag(sec?.num ?? null, s.num)}</span>
                                <span className="rounded bg-subtle px-1.5 py-0.5 font-medium" title={kindLabel(s.kind)}>
                                  {s.kind}
                                </span>
                                {s.is_pickup && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-warning">Pickup</span>}
                                {s.script_changed && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-warning">Script changed</span>}
                              </div>
                              <p className="text-[15px] leading-snug">{s.description || (s.kind === "AR" ? "Talking head" : kindLabel(s.kind))}</p>
                              {s.line_text && <p className="line-clamp-3 text-sm italic text-muted">“{s.line_text}”</p>}
                              {(cam || extra) && <p className="text-xs text-muted">{[cam, extra].filter(Boolean).join(" · ")}</p>}
                              {s.edit_notes && <p className="text-xs text-faint">Edit: {s.edit_notes}</p>}
                              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px]">{name}</code>
                                <CopyName name={name} />
                                <button
                                  type="button"
                                  className={BTN_SM}
                                  onClick={() => {
                                    setLastShot(s.id);
                                    setTab("moments");
                                  }}
                                >
                                  + Moment
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </>
        )}

        {tab === "moments" && <MomentsLog videoId={video.id} shots={shots} sections={secById} moments={moments} shotId={lastShot} onShot={setLastShot} />}

        {tab === "intro" && (
          <IntroFilmTab
            videoId={video.id}
            kind={video.kind}
            sections={rawSections}
            pinned={pinned}
            shots={shots.map((s) => ({ id: s.id, section_id: s.section_id, para_hash: s.para_hash, kind: s.kind, duration_s: s.duration_s, position: s.position, matches_thumbnail: s.matches_thumbnail, description: s.description }))}
            moments={moments}
            wpm={wpm}
            aiReady={aiReady}
          />
        )}
      </main>
    </div>
  );
}

function MomentsLog({
  videoId,
  shots,
  sections,
  moments,
  shotId,
  onShot,
}: {
  videoId: string;
  shots: YtShot[];
  sections: Map<string, ShotSection>;
  moments: YtMoment[];
  shotId: string | null;
  onShot: (id: string | null) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<MomentKind>("funny");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = (s: YtShot) => {
    const sec = s.section_id ? sections.get(s.section_id) : undefined;
    return `${shotTag(sec?.num ?? null, s.num)} ${s.kind} · ${(s.description || s.line_text || "").slice(0, 50)}`;
  };
  const shotLabel = (id: string | null) => {
    const s = id ? shots.find((x) => x.id === id) : null;
    return s ? label(s) : null;
  };
  const add = async () => {
    setBusy(true);
    const r = await addMoment(videoId, text, kind, shotId);
    setBusy(false);
    if (r.error) return setErr(r.error);
    setErr(null);
    setText("");
    router.refresh();
  };
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-line bg-surface p-3 shadow-card">
        <p className="text-sm text-muted">Write down what just happened — it feeds the intro (open loop, input bias, the moment for the thumbnail).</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="e.g. The tripod fell in the middle of take 3 😅"
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-base"
          aria-label="What happened"
        />
        <div className="flex flex-wrap gap-1.5">
          {MOMENT_KINDS.map((m) => (
            <Chip key={m.id} on={kind === m.id} onClick={() => setKind(m.id)}>
              {m.icon} {m.label}
            </Chip>
          ))}
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted">Shot (optional)</span>
          <select value={shotId ?? ""} onChange={(e) => onShot(e.target.value || null)} className="w-full rounded-md border border-line-strong bg-surface px-2 py-2 text-sm">
            <option value="">— none —</option>
            {shots.map((s) => (
              <option key={s.id} value={s.id}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={`${PRIMARY} w-full py-3 text-base`} disabled={busy || !text.trim()} onClick={() => void add()}>
          {busy ? "Saving…" : "＋ Log moment"}
        </button>
        <Msg error={err} />
      </div>
      <ul className="space-y-2">
        {moments.length === 0 && <li className="text-sm text-muted">No moments yet.</li>}
        {[...moments].reverse().map((m) => (
          <MomentRow key={m.id} m={m} shot={shotLabel(m.shot_id)} />
        ))}
      </ul>
    </div>
  );
}

function MomentRow({ m, shot }: { m: YtMoment; shot: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const k = MOMENT_KINDS.find((x) => x.id === m.kind);
  return (
    <li className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-sm shadow-card">
      <span className="text-lg" aria-label={k?.label}>
        {k?.icon ?? "📝"}
      </span>
      <div className="min-w-0 flex-1">
        <p>{m.text}</p>
        <p className="text-xs text-muted">
          {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {shot ? ` · ${shot}` : ""}
          {m.used_in_intro ? " · used in intro" : ""}
        </p>
      </div>
      <button
        type="button"
        className={BTN_SM}
        disabled={busy}
        onClick={async () => {
          if (!confirm("Delete this moment?")) return;
          setBusy(true);
          await deleteMoment(m.id);
          setBusy(false);
          router.refresh();
        }}
      >
        Delete
      </button>
    </li>
  );
}

