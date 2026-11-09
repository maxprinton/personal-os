"use client";
// Ideation step 1 · Topic: is the topic able to explode? Outlier finder (Worker C) + manual references.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FORMATS, videoHref } from "@/lib/youtube/constants";
import { addReferences, deleteReference, switchTopic, updateReference, updateIdea } from "@/app/youtube-actions/ideas";
import { TOPIC_STATUS_INFO, similarTopics } from "@/lib/youtube/topics";
import { dataScore, fmtViews, outlierOf } from "@/lib/youtube/scoring";
import type { YtReference } from "@/lib/youtube/types";
import type { IdeaPageData } from "@/components/youtube/idea/IdeaStepper";
import { AutoField, BOX, BTN, BTN_SM, INPUT, LABEL, Msg } from "@/components/youtube/idea/ui";

export default function TopicStep({ data, onSave }: { data: IdeaPageData; onSave: (p: Parameters<typeof updateIdea>[1]) => Promise<string | null> }) {
  const { video, refs } = data;
  const router = useRouter();
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});
  const [pending, start] = useTransition();
  const ds = dataScore(refs, data.viewGoal);
  const [switchErr, setSwitchErr] = useState<string | null>(null);
  const [pendingSwitch, startSwitch] = useTransition();
  const similar = similarTopics(data.topics.filter((t) => t.id !== data.topic?.id), data.topic?.name ?? video.topic ?? "");
  const doSwitch = (topicId: string) =>
    startSwitch(async () => {
      setSwitchErr(null);
      const r = await switchTopic(video.id, { topicId });
      if (r.error) setSwitchErr(r.error);
      else router.refresh();
    });
  const add = () =>
    start(async () => {
      const r = await addReferences(video.id, paste);
      if (r.error) setMsg({ error: r.error });
      else {
        setPaste("");
        setMsg({ info: r.added ? `Saved ${r.added} reference${r.added === 1 ? "" : "s"}.${r.skipped ? ` ${r.skipped} already saved.` : ""}` : "Already saved." });
        router.refresh();
      }
    });
  return (
    <div className="space-y-4">
      <div className={BOX}>
        <label className={LABEL}>
          Topic name — short and reusable (the finder searches with it). One topic can have many ideas, one per format.
          <AutoField value={data.topic?.name ?? video.topic ?? ""} maxLength={120} label="Topic name" onSave={(v) => onSave({ topic_name: v })} />
        </label>
        {data.topic && (
          <p className="text-xs text-muted" title={TOPIC_STATUS_INFO[data.topic.status].hint}>
            On your channel: <b className="text-fg">{TOPIC_STATUS_INFO[data.topic.status].label}</b> · {TOPIC_STATUS_INFO[data.topic.status].hint}
          </p>
        )}
        {data.siblings.length > 1 && (
          <div className="space-y-1 text-xs">
            <p className="font-medium text-muted">Ideas on this topic</p>
            <ul className="flex flex-wrap gap-1.5">
              {data.siblings.map((i) => (
                <li key={i.id}>
                  <Link href={videoHref(i.id, "idea")} className={`rounded-full border px-2 py-0.5 ${i.id === video.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-subtle"}`}>
                    {FORMATS.find((f) => f.id === i.format)?.label ?? "no format"}
                    {i.verdict30 ? ` · ${i.verdict30}` : i.stage === "published" ? " · published" : i.stage === "archived" ? " · parked" : ""}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(similar.length > 0 || data.topics.length > 1) && (
          <div className="space-y-1">
            {similar.length > 0 && (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                Did you mean an existing topic?{" "}
                {similar.map((t) => (
                  <button key={t.id} type="button" className="mr-2 font-medium underline" disabled={pendingSwitch} onClick={() => doSwitch(t.id)}>
                    {t.name}
                  </button>
                ))}
              </p>
            )}
            <select
              value=""
              disabled={pendingSwitch}
              onChange={(e) => e.target.value && doSwitch(e.target.value)}
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-fg"
              aria-label="Switch to an existing topic"
            >
              <option value="">Switch to an existing topic…</option>
              {data.topics.filter((t) => t.id !== data.topic?.id).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Msg error={switchErr} />
          </div>
        )}
        <label className={LABEL}>
          Topic notes — what is this about? (optional)
          <AutoField value={video.topic ?? ""} multiline rows={2} maxLength={2000} label="Topic notes" onSave={(v) => onSave({ topic: v })} />
        </label>
        <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          <b>Familiarity trap:</b> a topic you know well isn’t automatically one people want. Look for outliers — videos with ≥ 3× the usual views of their channel —
          before investing.
        </p>
      </div>

      <div className={BOX}>
        <h3 className="text-sm font-semibold">Outlier finder</h3>
        {data.finder}
      </div>

      <div className={BOX}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Saved references ({refs.length})</h3>
          <p className="text-xs text-muted">
            View potential: <b className="text-fg">{ds.score ?? "—"}</b>
            {ds.score != null && "/10"} {ds.why && <span className="text-faint">· {ds.why}</span>}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <textarea
            rows={2}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste YouTube links (one or many) of videos on this topic that did unusually well…"
            className={`${INPUT} flex-1`}
            aria-label="YouTube links"
          />
          <button type="button" onClick={add} disabled={pending || !paste.trim()} className={`${BTN} self-start`}>
            {pending ? "Saving…" : "Save links"}
          </button>
        </div>
        <Msg {...msg} />
        {refs.length > 0 && (
          <ul className="divide-y divide-line">
            {refs.map((r) => (
              <RefRow key={r.id} r={r} goal={data.viewGoal} />
            ))}
          </ul>
        )}
        <p className="text-[11px] text-faint">Add views and the channel’s usual views (median) to each reference: the outlier score feeds the idea’s view potential.</p>
      </div>
    </div>
  );
}

function RefRow({ r, goal }: { r: YtReference; goal: number | null }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const out = outlierOf(r);
  const save = async (k: "views" | "channel_median" | "channel_subs" | "note", v: string) => {
    const res = await updateReference(r.id, { [k]: v });
    if (!res.error) router.refresh();
    return res.error ?? null;
  };
  return (
    <li className="flex flex-col gap-2 py-2 sm:flex-row">
      <a href={r.url} target="_blank" rel="noreferrer" className="shrink-0">
        {r.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.thumbnail_url} alt="" className="aspect-video w-40 rounded object-cover" loading="lazy" />
        ) : (
          <span className="grid aspect-video w-40 place-items-center rounded bg-subtle text-xs text-faint">No image</span>
        )}
      </a>
      <div className="min-w-0 flex-1 space-y-1">
        <a href={r.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium hover:text-accent">
          {r.title}
        </a>
        <p className="text-xs text-muted">
          {r.channel_title ?? "Unknown channel"}
          {r.is_short && " · Short"} · <span className="text-faint">{r.source}</span>
          {out != null && (
            <span className={`ml-2 rounded px-1 font-semibold ${out >= 3 ? "bg-success-soft text-success" : "bg-subtle text-muted"}`}>{Math.round(out * 10) / 10}×</span>
          )}
          {goal && r.views != null && r.views >= goal && <span className="ml-1 text-success">· above your goal</span>}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <label className={LABEL}>
            Views
            <AutoField value={r.views != null ? String(r.views) : ""} placeholder="e.g. 450K" label="Views" onSave={(v) => save("views", v)} />
          </label>
          <label className={LABEL}>
            Channel usual
            <AutoField value={r.channel_median != null ? String(r.channel_median) : ""} placeholder="median" label="Channel median views" onSave={(v) => save("channel_median", v)} />
          </label>
          <label className={LABEL}>
            Subscribers
            <AutoField value={r.channel_subs != null ? String(r.channel_subs) : ""} placeholder={fmtViews(null)} label="Channel subscribers" onSave={(v) => save("channel_subs", v)} />
          </label>
        </div>
        <AutoField value={r.note ?? ""} placeholder="Why it worked (optional)" label="Note" onSave={(v) => save("note", v)} />
      </div>
      <div className="flex shrink-0 items-start">
        <button
          type="button"
          className={BTN_SM}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await deleteReference(r.id);
              if (res.error) setErr(res.error);
              else router.refresh();
            })
          }
        >
          Remove
        </button>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
    </li>
  );
}
