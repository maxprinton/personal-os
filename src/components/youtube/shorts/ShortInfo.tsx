"use client";
// Top of a Short's Publish tab (Worker C): its long video (parent), role, source range, hook and the short
// path (Hook → source → short script → captions → Related video → publish). No Test & compare for Shorts.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateShort } from "@/app/youtube-actions/shorts";
import { SHORT_ROLES, videoHref } from "@/lib/youtube/constants";
import { parseStamp, shortPath, shortRangeProblems, stamp, youtubeWatchUrl, type ShortRoleId } from "@/lib/youtube/publish-rules";
import { BOX, BTN_SM, Chip, INPUT, Msg } from "@/components/youtube/script/ui";
import CopyButton from "@/components/youtube/publish/CopyButton";

type Parent = { id: string; code: string | null; idea_name: string; youtube_video_id: string | null };
type Props = {
  video: { id: string; short_role: string | null; source_start_s: number | null; source_end_s: number | null; quick_notes: string | null; stage: string };
  parent: Parent | null;
  hasScript: boolean;
  captionsDone: boolean;
  relatedDone: boolean;
};
const hookOfNotes = (n: string | null) => /^Hook:\s*(.*)$/m.exec(n ?? "")?.[1]?.trim() ?? "";

export default function ShortInfo(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const v = p.video;
  const [hook, setHook] = useState(hookOfNotes(v.quick_notes));
  const [from, setFrom] = useState(v.source_start_s == null ? "" : stamp(v.source_start_s));
  const [to, setTo] = useState(v.source_end_s == null ? "" : stamp(v.source_end_s));
  const [msg, setMsg] = useState<{ error?: string | null; info?: string | null }>({});
  const startS = from.trim() ? parseStamp(from) : null;
  const endS = to.trim() ? parseStamp(to) : null;
  const problems = (from.trim() && startS == null) || (to.trim() && endS == null) ? ["Write times like 1:05 or 65."] : shortRangeProblems(startS, endS);
  const path = shortPath({
    hook: !!hookOfNotes(v.quick_notes),
    source: v.source_start_s != null || p.hasScript,
    script: v.source_start_s != null ? null : p.hasScript,
    captions: p.captionsDone,
    related: p.relatedDone,
    published: v.stage === "published",
  });

  const save = (patch: Parameters<typeof updateShort>[1]) =>
    start(async () => {
      setMsg({});
      const r = await updateShort(v.id, patch);
      if (r.error) return setMsg({ error: r.error });
      setMsg({ info: "Saved." });
      router.refresh();
    });

  return (
    <section className={BOX}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Short</span>
        {p.parent ? (
          <>
            <span className="text-muted">from</span>
            <Link href={videoHref(p.parent.id, "publish")} className="text-accent underline">
              {p.parent.code ?? "Idea"} · {p.parent.idea_name}
            </Link>
            {p.parent.youtube_video_id && <CopyButton text={youtubeWatchUrl(p.parent.youtube_video_id)} label="Copy long video link" />}
          </>
        ) : (
          <span className="text-muted">(own Short idea — no long video)</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SHORT_ROLES.map((r) => (
          <Chip key={r.id} on={v.short_role === r.id} disabled={pending} title={r.hint} onClick={() => save({ role: r.id as ShortRoleId })}>
            {r.label}
          </Chip>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted">Hook (first 1–2 s, on-screen text)</span>
          <input className={INPUT} value={hook} maxLength={300} onChange={(e) => setHook(e.target.value)} onBlur={() => hook !== hookOfNotes(v.quick_notes) && save({ hook })} />
        </label>
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted">Source: clip of the long video (empty = made on purpose)</span>
          <div className="flex items-center gap-2">
            <input className={`${INPUT} w-24`} value={from} placeholder="1:05" onChange={(e) => setFrom(e.target.value)} aria-label="Clip start" />
            <span>–</span>
            <input className={`${INPUT} w-24`} value={to} placeholder="1:50" onChange={(e) => setTo(e.target.value)} aria-label="Clip end" />
            <button type="button" className={BTN_SM} disabled={pending || problems.length > 0} onClick={() => save({ start_s: startS, end_s: endS })}>
              Save range
            </button>
          </div>
          {problems.map((x) => <p key={x} className="text-xs text-danger">✗ {x}</p>)}
        </div>
      </div>
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {path.steps.map((s, i) => (
          <li key={s.id} className={s.done ? "text-success" : s.label === path.next ? "font-medium text-fg" : "text-muted"}>
            {s.done ? "✓" : `${i + 1}.`} {s.label}
          </li>
        ))}
      </ol>
      {!p.relatedDone && p.parent && (
        <p className="text-xs text-warning">
          Remember: in the Short’s details in YouTube, set “Related video” → {p.parent.code ?? ""} {p.parent.idea_name}
          {p.parent.youtube_video_id ? "" : " (publish the long video first)"}. Tick it in the checklist below when done.
        </p>
      )}
      <Msg error={msg.error} info={msg.info} />
    </section>
  );
}
