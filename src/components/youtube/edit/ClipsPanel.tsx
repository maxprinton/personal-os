"use client";
// Edit tab · Clips: one or more clips per shot (file/link, where it is, take, best ★, status), extra clips
// (stock/screen/images with source + license), footage folder, phone warning (Worker B).
import { useMemo, useState } from "react";
import { CLIP_LOCATIONS, CLIP_STATUSES } from "@/lib/youtube/constants";
import { videoFolderName } from "@/lib/youtube/naming";
import type { ClipLocation, ClipStatus, YtClip, YtShot } from "@/lib/youtube/types";
import type { ShotSection } from "@/components/youtube/shots/load";
import { kindLabel, shotName, shotTag } from "@/components/youtube/shots/logic";
import { BlurField, BTN, BTN_SM, BOX, Chip, INPUT, Msg, PRIMARY } from "@/components/youtube/script/ui";
import { addClip, bulkClipStatus, deleteClip, setFootageFolder, updateClip } from "@/app/youtube-actions/edit";
import { EXTRA_KINDS, collectProgress, phoneOnly, shotStatus, takesByShot } from "./logic";
import { copyText, useRun } from "./useRun";

type Video = { id: string; code: string | null; idea_name: string; footage_folder: string | null };
const STATUS_STYLE: Record<ClipStatus, string> = {
  missing: "bg-danger-soft text-danger",
  recorded: "bg-warning-soft text-warning",
  imported: "bg-accent-soft text-accent",
  in_timeline: "bg-success-soft text-success",
};
const statusLabel = (s: ClipStatus) => CLIP_STATUSES.find((x) => x.id === s)?.label ?? s;
export function StatusPill({ status }: { status: ClipStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}>{statusLabel(status)}</span>;
}

export default function ClipsPanel({ video, sections, shots, clips }: { video: Video; sections: ShotSection[]; shots: YtShot[]; clips: YtClip[] }) {
  const { run, pending, error, info } = useRun();
  const [filter, setFilter] = useState<ClipStatus | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const secById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const takes = useMemo(() => takesByShot(clips), [clips]);
  const progress = collectProgress(shots, clips);
  const phone = phoneOnly(clips);
  const extras = clips.filter((c) => !c.shot_id);
  const folderName = videoFolderName(video.code, video.idea_name);

  const groups = sections
    .map((sec) => ({ sec, shots: shots.filter((s) => s.section_id === sec.id && (filter === "all" || shotStatus(s.id, clips) === filter)) }))
    .filter((g) => g.shots.length);
  const orphan = shots.filter((s) => !s.section_id || !secById.has(s.section_id));

  return (
    <div className="space-y-4">
      <div className={BOX}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Footage</h3>
          <span className="text-sm text-muted">
            {progress.done}/{progress.total} shots have a clip
          </span>
        </div>
        <label className="block text-xs text-muted">
          Footage folder (Drive link or PC path)
          <BlurField value={video.footage_folder ?? ""} placeholder={`e.g. D:\\YouTube\\${folderName}`} onSave={async (v) => (await setFootageFolder(video.id, v)).error} />
        </label>
        <p className="text-xs text-muted">
          Suggested folder name: <code className="rounded bg-subtle px-1">{folderName}</code>{" "}
          <button type="button" className={BTN_SM} onClick={() => copyText(folderName)}>
            Copy
          </button>
          {video.footage_folder && /^https?:/i.test(video.footage_folder) && (
            <a className="ml-2 text-accent underline" href={video.footage_folder} target="_blank" rel="noreferrer">
              Open folder
            </a>
          )}
        </p>
      </div>

      {phone.length > 0 && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
          <p className="font-medium text-warning">📱 {phone.length} clip{phone.length === 1 ? " is" : "s are"} still only on the phone</p>
          <p className="text-xs text-muted">{phone.slice(0, 8).map((c) => c.file_name).join(", ")}{phone.length > 8 ? "…" : ""}</p>
          <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => bulkClipStatus(video.id, "recorded", "imported", true), "Marked as transferred to the PC.")}>
            I copied them to the PC → mark imported
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Chip on={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
        {CLIP_STATUSES.map((s) => (
          <Chip key={s.id} on={filter === s.id} onClick={() => setFilter(s.id)}>
            {s.label}
          </Chip>
        ))}
        <span className="flex-1" />
        <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => bulkClipStatus(video.id, "recorded", "imported"), "All recorded clips are now imported.")}>
          All recorded → imported
        </button>
        <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => bulkClipStatus(video.id, "imported", "in_timeline"), "All imported clips are now in the timeline.")}>
          All imported → in timeline
        </button>
      </div>
      <Msg error={error} info={info} />

      {!shots.length && <p className="text-sm text-muted">No shots yet. Make the shot list in the Shots tab first.</p>}
      {groups.map(({ sec, shots: list }) => (
        <section key={sec.id} className="space-y-2">
          <h4 className="text-sm font-semibold">
            {sec.code} · {sec.title}
          </h4>
          {list.map((s) => (
            <ShotRow key={s.id} video={video} shot={s} sectionNum={sec.num} clips={clips.filter((c) => c.shot_id === s.id)} nextTake={(takes[s.id] ?? 0) + 1} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
          ))}
        </section>
      ))}
      {filter === "all" && orphan.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Shots without a part</h4>
          {orphan.map((s) => (
            <ShotRow key={s.id} video={video} shot={s} sectionNum={null} clips={clips.filter((c) => c.shot_id === s.id)} nextTake={(takes[s.id] ?? 0) + 1} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
          ))}
        </section>
      )}

      <Extras videoId={video.id} code={video.code} extras={extras} />
    </div>
  );
}

function ShotRow({ video, shot, sectionNum, clips, nextTake, open, onToggle }: { video: Video; shot: YtShot; sectionNum: number | null; clips: YtClip[]; nextTake: number; open: boolean; onToggle: () => void }) {
  const status = shotStatus(shot.id, clips);
  const suggested = shotName(video.code, sectionNum, shot, nextTake, ".mp4");
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-surface p-3 text-sm shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onToggle} className="font-mono text-xs text-muted hover:text-fg" aria-expanded={open}>
          {open ? "▾" : "▸"} {shotTag(sectionNum, shot.num)} {shot.kind}
        </button>
        <span className="min-w-0 flex-1 truncate" title={shot.line_text ?? ""}>
          {shot.description || shot.line_text || kindLabel(shot.kind)}
        </span>
        {shot.is_pickup && <span className="rounded bg-subtle px-1.5 text-[11px] text-muted">Pickup</span>}
        <span className="text-xs text-faint">{clips.length ? `${clips.length} clip${clips.length > 1 ? "s" : ""}` : ""}</span>
        <StatusPill status={status} />
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">
            Next name: <code className="rounded bg-subtle px-1">{suggested}</code>{" "}
            <button type="button" className={BTN_SM} onClick={async () => setCopied(await copyText(suggested))}>
              {copied ? "Copied" : "Copy"}
            </button>
          </p>
          {clips.map((c) => (
            <ClipRow key={c.id} videoId={video.id} clip={c} />
          ))}
          <AddClip videoId={video.id} shotId={shot.id} defaultName={suggested} take={nextTake} kind={shot.kind} />
        </div>
      )}
    </div>
  );
}

function ClipRow({ videoId, clip, extra = false }: { videoId: string; clip: YtClip; extra?: boolean }) {
  const { run, pending, error } = useRun();
  const up = (patch: Parameters<typeof updateClip>[2]) => run(() => updateClip(videoId, clip.id, patch));
  return (
    <div className="space-y-1.5 rounded-md border border-line bg-subtle/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        {!extra && (
          <button type="button" title={clip.is_best ? "Best take" : "Mark as best take"} className={`text-lg leading-none ${clip.is_best ? "text-warning" : "text-faint hover:text-warning"}`} disabled={pending} onClick={() => up({ is_best: !clip.is_best })}>
            {clip.is_best ? "★" : "☆"}
          </button>
        )}
        <div className="min-w-[12rem] flex-1">
          <BlurField value={clip.file_name} ariaLabel="File name" onSave={async (v) => (await updateClip(videoId, clip.id, { file_name: v })).error} />
        </div>
        {!extra && (
          <label className="flex items-center gap-1 text-xs text-muted">
            Take
            <input type="number" min={1} max={999} defaultValue={clip.take} className={`${INPUT} w-16`} onBlur={(e) => Number(e.target.value) !== clip.take && up({ take: Number(e.target.value) })} />
          </label>
        )}
        <select aria-label="Where" className={`${INPUT} w-auto`} value={clip.location} disabled={pending} onChange={(e) => up({ location: e.target.value as ClipLocation })}>
          {CLIP_LOCATIONS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <select aria-label="Status" className={`${INPUT} w-auto`} value={clip.status} disabled={pending} onChange={(e) => up({ status: e.target.value as ClipStatus })}>
          {CLIP_STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" className={BTN_SM} disabled={pending} onClick={() => confirm("Remove this clip from the list? (The file itself is not touched.)") && run(() => deleteClip(videoId, clip.id))}>
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[12rem] flex-1">
          <BlurField value={clip.url_or_path ?? ""} placeholder="Link or path (optional)" onSave={async (v) => (await updateClip(videoId, clip.id, { url_or_path: v })).error} />
        </div>
        {clip.url_or_path && /^https?:/i.test(clip.url_or_path) && (
          <a href={clip.url_or_path} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
            Open
          </a>
        )}
        {clip.original_name && clip.original_name !== clip.file_name && <span className="text-xs text-faint">was {clip.original_name}</span>}
      </div>
      {extra && (
        <div className="grid gap-2 sm:grid-cols-3">
          <select aria-label="Kind" className={INPUT} value={clip.kind ?? "other"} disabled={pending} onChange={(e) => up({ kind: e.target.value })}>
            {EXTRA_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <BlurField value={clip.source ?? ""} placeholder="Source (site, author)" onSave={async (v) => (await updateClip(videoId, clip.id, { source: v })).error} />
          <BlurField value={clip.license ?? ""} placeholder="License (CC0, Pexels, own…)" onSave={async (v) => (await updateClip(videoId, clip.id, { license: v })).error} />
        </div>
      )}
      <Msg error={error} />
    </div>
  );
}

function AddClip({ videoId, shotId, defaultName, take, kind }: { videoId: string; shotId: string; defaultName: string; take: number; kind: string }) {
  const { run, pending, error } = useRun();
  const [name, setName] = useState(defaultName);
  const [loc, setLoc] = useState<ClipLocation>("pc");
  const [link, setLink] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
      <label className="min-w-[12rem] flex-1 text-xs text-muted">
        New clip (take {take})
        <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <select aria-label="Where" className={`${INPUT} w-auto`} value={loc} onChange={(e) => setLoc(e.target.value as ClipLocation)}>
        {CLIP_LOCATIONS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <input className={`${INPUT} w-48`} placeholder="Link or path (optional)" value={link} onChange={(e) => setLink(e.target.value)} />
      <button
        type="button"
        className={PRIMARY}
        disabled={pending}
        onClick={async () => {
          const ok = await run(() => addClip(videoId, { shot_id: shotId, file_name: name, location: loc, url_or_path: link, take, kind, status: loc === "phone" ? "recorded" : "imported" }));
          if (ok) setLink("");
        }}
      >
        Add clip
      </button>
      <Msg error={error} />
    </div>
  );
}

function Extras({ videoId, code, extras }: { videoId: string; code: string | null; extras: YtClip[] }) {
  const { run, pending, error } = useRun();
  const [f, setF] = useState({ file_name: "", kind: "stock", source: "", license: "", url_or_path: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className={BOX}>
      <h3 className="font-semibold">Extra clips</h3>
      <p className="text-xs text-muted">Stock, screen recordings, images, memes — anything outside the shot list. Keep the source and license for credits. Suggested name: {code ?? "VXXX"}_X_ST_&lt;desc&gt;.mp4</p>
      {extras.map((c) => (
        <ClipRow key={c.id} videoId={videoId} clip={c} extra />
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={INPUT} placeholder="File name or title" value={f.file_name} onChange={set("file_name")} />
        <select className={INPUT} value={f.kind} onChange={set("kind")} aria-label="Kind">
          {EXTRA_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <input className={INPUT} placeholder="Source (site, author)" value={f.source} onChange={set("source")} />
        <input className={INPUT} placeholder="License" value={f.license} onChange={set("license")} />
        <input className={`${INPUT} sm:col-span-2`} placeholder="Link or path" value={f.url_or_path} onChange={set("url_or_path")} />
      </div>
      <button
        type="button"
        className={BTN}
        disabled={pending}
        onClick={async () => {
          const ok = await run(() => addClip(videoId, { ...f, shot_id: null, location: /^https?:/i.test(f.url_or_path) ? "drive" : "pc", status: "imported" }));
          if (ok) setF({ file_name: "", kind: f.kind, source: "", license: "", url_or_path: "" });
        }}
      >
        Add extra clip
      </button>
      <Msg error={error} />
    </section>
  );
}
