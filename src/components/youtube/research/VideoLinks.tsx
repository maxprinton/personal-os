"use client";
// Video ↔ video links (Worker A): series, follow-up, "watch next" (the closing invites to that video).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addVideoLink, deleteVideoLink } from "@/app/youtube-actions/research";
import { LINK_KINDS, videoHref } from "@/lib/youtube/constants";
import type { LinkKind } from "@/lib/youtube/types";
import { BOX, BTN, BTN_SM, INPUT, Msg } from "@/components/youtube/idea/ui";
import { labVideoLabel, type LabLink, type LabVideo } from "./shared";

export default function VideoLinks({ videoId, links, videos }: { videoId: string; links: LabLink[]; videos: LabVideo[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<LinkKind>("watch_next");
  const [note, setNote] = useState("");
  const byId = new Map(videos.map((v) => [v.id, v]));
  const kindLabel = (k: string) => LINK_KINDS.find((x) => x.id === k)?.label ?? k;
  const out = links.filter((l) => l.from_id === videoId);
  const inc = links.filter((l) => l.to_id === videoId);
  const run = (fn: () => Promise<{ error?: string }>, info?: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : { info });
      if (!r.error) router.refresh();
    });
  const row = (l: LabLink, otherId: string, arrow: string) => {
    const v = byId.get(otherId);
    return (
      <li key={l.id} className="flex items-center gap-2 text-sm">
        <span className="rounded bg-subtle px-1.5 text-[11px] text-muted">{kindLabel(l.kind)}</span>
        <span className="text-faint">{arrow}</span>
        {v ? (
          <Link href={videoHref(v.id, "research")} className="min-w-0 flex-1 truncate hover:underline">
            {labVideoLabel(v)}
          </Link>
        ) : (
          <span className="flex-1 text-xs text-faint">(archived video)</span>
        )}
        {l.note && <span className="truncate text-xs text-muted">{l.note}</span>}
        <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => deleteVideoLink(l.id))} aria-label="Remove link">
          ✕
        </button>
      </li>
    );
  };

  return (
    <section className={BOX}>
      <h2 className="text-sm font-semibold">Linked videos</h2>
      <p className="text-xs text-muted">Series, follow-ups and “watch next” — the closing of this video can invite viewers to the next one.</p>
      {out.length + inc.length > 0 ? (
        <ul className="space-y-1">
          {out.map((l) => row(l, l.to_id, "→"))}
          {inc.map((l) => row(l, l.from_id, "←"))}
        </ul>
      ) : (
        <p className="text-xs text-faint">No links yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${INPUT} max-w-[9rem]`} value={kind} onChange={(e) => setKind(e.target.value as LinkKind)} aria-label="Kind of link">
          {LINK_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <select className={`${INPUT} max-w-xs`} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Video">
          <option value="">Pick a video…</option>
          {videos
            .filter((v) => v.id !== videoId)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {labVideoLabel(v)}
              </option>
            ))}
        </select>
        <input className={`${INPUT} max-w-xs`} placeholder="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <button
          type="button"
          className={BTN}
          disabled={pending || !to}
          onClick={() => {
            run(() => addVideoLink(videoId, to, kind, note), "Linked.");
            setTo("");
            setNote("");
          }}
        >
          Link
        </button>
      </div>
      <Msg {...msg} />
    </section>
  );
}
