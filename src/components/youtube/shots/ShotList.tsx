"use client";
// Shots tab of a video: one shot per script paragraph (A-roll by default), ✨ suggestions for B-roll /
// screen / graphics (accept or discard), every field (basics, camera, setup, edit), "script changed"
// flags, pickups, a suggested file name per shot with Copy, vertical (VT) shots for Shorts.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { acceptShotSuggestions, addShot, aiSuggestShots, syncShots } from "@/app/youtube-actions/shots";
import { SHOT_KINDS, videoHref } from "@/lib/youtube/constants";
import { formatDuration } from "@/lib/youtube/outline";
import type { ShotKind, YtKind, YtShot } from "@/lib/youtube/types";
import { AI_BTN, BTN, BTN_SM, Chip, Msg } from "@/components/youtube/script/ui";
import { distinctValues, kindLabel, type ShotSuggestion } from "./logic";
import ShotCard from "./ShotCard";
import type { ShotSection } from "./load";

type VideoInfo = { id: string; code: string | null; idea_name: string; kind: YtKind; locked: boolean };
type Show = "all" | "todo" | "changed" | "pickups";

export default function ShotList({ video, sections, shots, drift, aiReady }: { video: VideoInfo; sections: ShotSection[]; shots: YtShot[]; drift: boolean; aiReady: boolean }) {
  const router = useRouter();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const synced = useRef(false);

  const runSync = async (manual: boolean) => {
    setSyncing(true);
    setSyncErr(null);
    const r = await syncShots(video.id);
    setSyncing(false);
    if (r.error) return setSyncErr(r.error);
    const parts = [r.created ? `${r.created} new shot${r.created === 1 ? "" : "s"}` : "", r.flagged ? `${r.flagged} marked "script changed"` : "", r.cleared ? `${r.cleared} back to normal` : ""].filter(Boolean);
    setSyncMsg(parts.length ? `Shot list updated from the script: ${parts.join(", ")}.` : manual ? "The shot list already matches the script." : null);
    if (parts.length) router.refresh();
  };
  // Automatic: the first time the page sees the script and the shots out of step, it brings them in line.
  useEffect(() => {
    if (drift && !synced.current) {
      synced.current = true;
      void runSync(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drift]);

  const [kind, setKind] = useState<ShotKind | "all">("all");
  const [show, setShow] = useState<Show>("all");
  const visible = (s: YtShot) =>
    (kind === "all" || s.kind === kind) && (show === "all" || (show === "todo" && !s.done) || (show === "changed" && s.script_changed) || (show === "pickups" && s.is_pickup));

  const secNum = useMemo(() => new Map(sections.map((s) => [s.id, s.num])), [sections]);
  const setups = useMemo(() => distinctValues(shots.map((s) => s.setup)), [shots]);
  const locations = useMemo(() => distinctValues(shots.map((s) => s.location)), [shots]);
  const totals = useMemo(() => {
    const done = shots.filter((s) => s.done).length;
    const changed = shots.filter((s) => s.script_changed).length;
    const pickups = shots.filter((s) => s.is_pickup && !s.done).length;
    const secs = shots.reduce((m, s) => m + (s.duration_s ?? 0), 0);
    return { done, changed, pickups, secs };
  }, [shots]);

  // ----- ✨ suggestions -----
  const [aiScope, setAiScope] = useState<string>("all");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [sugs, setSugs] = useState<ShotSuggestion[]>([]);
  const [saving, setSaving] = useState(false);
  const suggest = async (scope: string) => {
    setAiBusy(true);
    setAiErr(null);
    const r = await aiSuggestShots(video.id, scope === "all" ? null : scope);
    setAiBusy(false);
    setUsage(r.usage ?? null);
    if (r.error) return setAiErr(r.error);
    const stamp = Date.now();
    setSugs((old) => [
      ...old,
      ...(r.suggestions ?? []).filter((n) => !old.some((o) => o.para_hash === n.para_hash && o.description === n.description)).map((n, i) => ({ ...n, key: `${n.key}-${stamp}-${i}` })),
    ]);
  };
  const accept = async (items: ShotSuggestion[]) => {
    if (!items.length) return;
    setSaving(true);
    const r = await acceptShotSuggestions(video.id, items);
    setSaving(false);
    if (r.error) return setAiErr(r.error);
    const keys = new Set(items.map((i) => i.key));
    setSugs((s) => s.filter((x) => !keys.has(x.key)));
    router.refresh();
  };
  const secCode = (id: string) => sections.find((s) => s.id === id)?.code ?? "S??";

  if (!sections.length)
    return (
      <div className="rounded-lg border border-line bg-surface p-6 text-sm text-muted shadow-card">
        No script yet. Make the outline and write the script first — every paragraph becomes a shot.{" "}
        <Link href={videoHref(video.id, "script")} className="text-accent underline">
          Go to Script
        </Link>
      </div>
    );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 shadow-card">
        <div className="mr-auto text-sm">
          <span className="font-semibold">{shots.length} shots</span>
          <span className="text-muted">
            {" "}
            · {totals.done} filmed{totals.changed ? ` · ${totals.changed} script changed` : ""}
            {totals.pickups ? ` · ${totals.pickups} pickups to film` : ""}
            {totals.secs ? ` · ≈ ${formatDuration(totals.secs)} of planned shots` : ""}
          </span>
        </div>
        <Link href={videoHref(video.id, "film")} className={BTN}>
          🎬 Filming mode
        </Link>
        <Link href={videoHref(video.id, "prompter")} className={BTN}>
          📜 Teleprompter
        </Link>
        <Link href="/youtube/shots" className={BTN}>
          Missing shots
        </Link>
        <button type="button" className={BTN} disabled={syncing} onClick={() => void runSync(true)} title="Compare the shot list with the script again">
          {syncing ? "Checking…" : "↻ Sync with script"}
        </button>
      </div>
      {!video.locked && <p className="text-xs text-warning">The outline is not locked yet, so section numbers (S01, S02…) in file names can still change. Lock it in the Script tab.</p>}
      {!video.code && <p className="text-xs text-warning">This idea has no V-number yet (VXXX in names). It gets one when the idea is approved.</p>}
      <Msg error={syncErr} info={syncMsg} />

      {/* ✨ AI */}
      <div className="space-y-2 rounded-lg border border-line bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">✨ Shot ideas</span>
          <select className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm" value={aiScope} onChange={(e) => setAiScope(e.target.value)} aria-label="Which part">
            <option value="all">Whole script</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.title}
              </option>
            ))}
          </select>
          <button type="button" className={AI_BTN} disabled={!aiReady || aiBusy} onClick={() => void suggest(aiScope)} title={aiReady ? "Suggest B-roll, screen recordings and graphics per line" : "The AI is not connected (GROQ_API_KEY)"}>
            {aiBusy ? "Thinking…" : "✨ Suggest B-roll, screen & graphics"}
          </button>
          {sugs.length > 0 && (
            <>
              <button type="button" className={BTN_SM} disabled={saving} onClick={() => void accept(sugs)}>
                Accept all ({sugs.length})
              </button>
              <button type="button" className={BTN_SM} onClick={() => setSugs([])}>
                Discard all
              </button>
            </>
          )}
        </div>
        <Msg error={aiErr} />
        {usage && <p className="text-[11px] text-faint">{usage}</p>}
        {sugs.length > 0 && (
          <ul className="space-y-1.5">
            {sugs.map((s) => (
              <li key={s.key} className="flex flex-wrap items-start gap-2 rounded-md border border-accent/30 bg-accent-soft/40 p-2 text-sm">
                <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px] font-medium">{secCode(s.section_id)}</span>
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent" title={kindLabel(s.kind)}>
                  {s.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p>
                    {s.description}
                    {s.duration_s ? <span className="text-muted"> · {s.duration_s}s</span> : null}
                  </p>
                  <p className="truncate text-[11px] text-muted">“{s.line_text}”</p>
                </div>
                <button type="button" className={BTN_SM} disabled={saving} onClick={() => void accept([s])}>
                  Accept
                </button>
                <button type="button" className={BTN_SM} onClick={() => setSugs((x) => x.filter((y) => y.key !== s.key))}>
                  Discard
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip on={kind === "all"} onClick={() => setKind("all")}>
          All types
        </Chip>
        {SHOT_KINDS.filter((k) => video.kind === "short" || k.id !== "VT" || shots.some((s) => s.kind === "VT")).map((k) => (
          <Chip key={k.id} on={kind === k.id} onClick={() => setKind(k.id)} title={k.label}>
            {k.id} · {shots.filter((s) => s.kind === k.id).length}
          </Chip>
        ))}
        <span className="mx-1 text-faint">|</span>
        {(
          [
            ["all", "All"],
            ["todo", "Not filmed"],
            ["changed", "Script changed"],
            ["pickups", "Pickups"],
          ] as [Show, string][]
        ).map(([id, label]) => (
          <Chip key={id} on={show === id} onClick={() => setShow(id)}>
            {label}
          </Chip>
        ))}
      </div>

      <datalist id="yt-setups">
        {setups.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="yt-locations">
        {locations.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* sections */}
      {sections.map((sec) => {
        const mine = shots.filter((s) => s.section_id === sec.id);
        const list = mine.filter(visible);
        return (
          <section key={sec.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 border-b border-line pb-1">
              <h3 className="font-semibold">
                {sec.code} · {sec.title || "Untitled"}
                {sec.is_climax && <span className="ml-1 text-xs text-warning">★ climax</span>}
                {sec.kind === "intro" && <span className="ml-1 text-xs text-muted">(intro shots added after filming are pickups)</span>}
              </h3>
              <span className="text-xs text-muted">
                {mine.filter((s) => s.done).length}/{mine.length} filmed
              </span>
              <div className="ml-auto flex gap-1.5">
                <button type="button" className={BTN_SM} disabled={!aiReady || aiBusy} onClick={() => void suggest(sec.id)}>
                  ✨ Ideas
                </button>
                <AddShotButton videoId={video.id} sectionId={sec.id} />
              </div>
            </div>
            {!sec.paragraphs.length && !mine.length && <p className="text-xs text-muted">No text in this part yet.</p>}
            {list.length === 0 && mine.length > 0 && <p className="text-xs text-muted">No shots match the filter here.</p>}
            <ul className="space-y-2">
              {list.map((s, i) => {
                const prev = list[i - 1];
                const sameLine = !!prev && !!s.para_hash && prev.para_hash === s.para_hash;
                return (
                  <li key={s.id} className={sameLine ? "ml-6" : ""}>
                    <ShotCard shot={s} code={video.code} sectionNum={secNum.get(sec.id) ?? null} showLine={!sameLine} isIntro={sec.kind === "intro"} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {/* shots without a section (their part was deleted) */}
      {shots.some((s) => !s.section_id || !secNum.has(s.section_id)) && (
        <section className="space-y-2">
          <h3 className="border-b border-line pb-1 font-semibold">Without a part</h3>
          <ul className="space-y-2">
            {shots
              .filter((s) => (!s.section_id || !secNum.has(s.section_id)) && visible(s))
              .map((s) => (
                <li key={s.id}>
                  <ShotCard shot={s} code={video.code} sectionNum={null} showLine isIntro={false} />
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AddShotButton({ videoId, sectionId }: { videoId: string; sectionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={BTN_SM}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await addShot(videoId, { sectionId, kind: "BR" });
          setBusy(false);
          setErr(r.error ?? null);
          if (!r.error) router.refresh();
        }}
      >
        + Shot
      </button>
      {err && <Msg error={err} />}
    </>
  );
}
