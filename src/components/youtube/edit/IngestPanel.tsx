"use client";
// Edit tab · Ingest: paste the camera/phone file names in filming order → each goes to a shot → new names
// + a Windows rename file (.bat) to run inside the footage folder → save as clips (Worker B).
import { useMemo, useState } from "react";
import { CLIP_LOCATIONS } from "@/lib/youtube/constants";
import { parseFileList, planIngest, renameBat, renameList, renamePs1, type IngestShot } from "@/lib/youtube/ingest";
import type { ClipLocation, YtClip, YtShot } from "@/lib/youtube/types";
import type { ShotSection } from "@/components/youtube/shots/load";
import { groupBySetup, shotTag } from "@/components/youtube/shots/logic";
import { BTN, BTN_SM, BOX, Chip, INPUT, Msg, PRIMARY } from "@/components/youtube/script/ui";
import { ingestClips } from "@/app/youtube-actions/edit";
import { shotStatus, takesByShot } from "./logic";
import { copyText, downloadText, useRun } from "./useRun";

type Order = "setup" | "script";

export default function IngestPanel({ video, sections, shots, clips }: { video: { id: string; code: string | null; footage_folder: string | null }; sections: ShotSection[]; shots: YtShot[]; clips: YtClip[] }) {
  const { run, pending, error, info } = useRun();
  const [text, setText] = useState("");
  const [order, setOrder] = useState<Order>("setup");
  const [includeDone, setIncludeDone] = useState(false);
  const [loc, setLoc] = useState<ClipLocation>("pc");
  const [folder, setFolder] = useState(video.footage_folder ?? "");
  const [manual, setManual] = useState<Record<number, string>>({});
  const [keepUnmatched, setKeepUnmatched] = useState(false);
  const [copied, setCopied] = useState(false);

  const secNum = useMemo(() => new Map(sections.map((s) => [s.id, s.num])), [sections]);
  const files = useMemo(() => parseFileList(text), [text]);
  const target = useMemo(() => {
    const pool = shots.filter((s) => includeDone || shotStatus(s.id, clips) === "missing");
    const ordered = order === "setup" ? groupBySetup(pool).flatMap((g) => g.shots) : pool;
    return ordered.map<IngestShot>((s) => ({ id: s.id, sectionNum: s.section_id ? secNum.get(s.section_id) ?? null : null, num: s.num, kind: s.kind, label: s.description || s.line_text || "" }));
  }, [shots, clips, includeDone, order, secNum]);
  const allShots = useMemo(
    () => shots.map<IngestShot>((s) => ({ id: s.id, sectionNum: s.section_id ? secNum.get(s.section_id) ?? null : null, num: s.num, kind: s.kind, label: s.description || s.line_text || "" })),
    [shots, secNum],
  );
  // manual choices may point at any shot: give planIngest every shot, the auto queue first
  const planShots = useMemo(() => [...target, ...allShots.filter((s) => !target.some((t) => t.id === s.id))], [target, allShots]);
  const plan = useMemo(() => {
    const p = planIngest(files, target, video.code, takesByShot(clips), manual);
    // shots chosen by hand that are outside the auto list
    if (Object.values(manual).some((id) => id && !target.some((t) => t.id === id))) return planIngest(files, planShots, video.code, takesByShot(clips), { ...autoManual(p, files.length), ...manual });
    return p;
  }, [files, target, planShots, video.code, clips, manual]);
  const byId = useMemo(() => new Map(allShots.map((s) => [s.id, s])), [allShots]);
  const toRename = plan.rows.filter((r) => r.newName && r.newName !== r.original).length;
  const code = video.code ?? "VXXX";

  const save = () =>
    run(async () => {
      const rows = plan.rows
        .filter((r) => r.shotId || keepUnmatched)
        .map((r) => ({ shot_id: r.shotId, original: r.original, file_name: r.newName ?? r.original, take: r.take || 1, kind: r.shotId ? byId.get(r.shotId)?.kind ?? null : "other" }));
      const res = await ingestClips(video.id, rows, loc, folder || null);
      if (!res.error) {
        setText("");
        setManual({});
      }
      return res;
    }, "Clips saved. Run the rename file in the footage folder if you haven't yet.");

  return (
    <div className="space-y-4">
      <div className={BOX}>
        <h3 className="font-semibold">Ingest footage</h3>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>
            In the footage folder, copy the file names in the order you filmed them (Windows: type <code>dir /b /od</code> in the folder, or copy them from DaVinci&apos;s Media Pool).
          </li>
          <li>Paste them below. Each file goes to the next shot without a clip; change any row by hand.</li>
          <li>Download the rename file, put it in the footage folder and double-click it. Then save the clips.</li>
        </ol>
        <textarea className={INPUT} rows={6} value={text} onChange={(e) => { setText(e.target.value); setManual({}); }} placeholder={"C0001.MP4\nC0002.MP4\nIMG_4411.MOV"} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Shot order:
          <Chip on={order === "setup"} onClick={() => setOrder("setup")} title="Same order as Filming mode (grouped by setup)">
            By setup (filming order)
          </Chip>
          <Chip on={order === "script"} onClick={() => setOrder("script")}>
            Script order
          </Chip>
          <label className="ml-2 flex items-center gap-1">
            <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} /> include shots that already have clips
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted">
            Where are these files?
            <select className={INPUT} value={loc} onChange={(e) => setLoc(e.target.value as ClipLocation)}>
              {CLIP_LOCATIONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Folder (saved with each clip)
            <input className={INPUT} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="D:\YouTube\V012 - …\01_Footage" />
          </label>
        </div>
      </div>

      {files.length > 0 && (
        <div className={BOX}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">
              {files.length} file{files.length > 1 ? "s" : ""} · {toRename} to rename · {plan.unmatched.length} unmatched
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-2">File</th>
                  <th className="py-1 pr-2">Shot</th>
                  <th className="py-1 pr-2">New name</th>
                  <th className="py-1">How</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1 pr-2 font-mono">{r.original}</td>
                    <td className="py-1 pr-2">
                      <select
                        aria-label={`Shot for ${r.original}`}
                        className={`${INPUT} py-0.5 text-xs`}
                        value={r.shotId ?? ""}
                        onChange={(e) => setManual({ ...manual, [i]: e.target.value })}
                      >
                        <option value="">— Unmatched —</option>
                        {allShots.map((s) => (
                          <option key={s.id} value={s.id}>
                            {shotTag(s.sectionNum, s.num)} {s.kind} · {(s.label ?? "").slice(0, 40)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2 font-mono">{r.newName ?? "—"}</td>
                    <td className="py-1 text-muted">{r.matchedBy ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plan.unmatched.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning-soft p-2 text-xs">
              <p className="font-medium text-warning">Unmatched ({plan.unmatched.length})</p>
              <p className="text-muted">{plan.unmatched.join(", ")}</p>
              <label className="mt-1 flex items-center gap-1 text-muted">
                <input type="checkbox" checked={keepUnmatched} onChange={(e) => setKeepUnmatched(e.target.checked)} /> save them as extra clips (keep their names)
              </label>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN} disabled={!toRename} onClick={() => downloadText(`rename-${code}.bat`, renameBat(plan, `Rename ${code} clips`), "application/x-bat")}>
              Download rename file (.bat)
            </button>
            <button type="button" className={BTN_SM} disabled={!toRename} onClick={() => downloadText(`rename-${code}.ps1`, renamePs1(plan))}>
              PowerShell version
            </button>
            <button type="button" className={BTN_SM} disabled={!toRename} onClick={async () => setCopied(await copyText(renameList(plan)))}>
              {copied ? "Copied" : "Copy list (old → new)"}
            </button>
            <span className="flex-1" />
            <button type="button" className={PRIMARY} disabled={pending || (!plan.rows.some((r) => r.shotId) && !keepUnmatched)} onClick={save}>
              Save clips
            </button>
          </div>
          <p className="text-xs text-faint">The .bat only renames files it finds in its own folder and never overwrites a file. It prints OK / SKIP / MISS for each one.</p>
        </div>
      )}
      <Msg error={error} info={info} />
    </div>
  );
}

/** Freezes the automatic choices of a plan (so adding a manual pick for a shot outside the queue keeps the rest). */
function autoManual(p: ReturnType<typeof planIngest>, n: number): Record<number, string> {
  const out: Record<number, string> = {};
  for (let i = 0; i < n; i++) out[i] = p.rows[i]?.shotId ?? "";
  return out;
}
