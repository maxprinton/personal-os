"use client";
// /youtube/v/[id]/idea — the ideation stepper (Worker A): Topic → Format → Angle → Criteria.
// Each step is a focused screen with the framework's tips; you can jump to any step at any time.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateIdea } from "@/app/youtube-actions/ideas";
import { IDEA_STEPS, SHORT_ROLES, videoHref } from "@/lib/youtube/constants";
import type { IdeaStep, YtReference, YtVideo } from "@/lib/youtube/types";
import { FORMATS, ANGLES } from "@/lib/youtube/constants";
import { extrasOf, type TopicIdea, type TopicStatus } from "@/lib/youtube/topics";
import { AutoField, LABEL } from "@/components/youtube/idea/ui";
import TopicStep from "@/components/youtube/idea/TopicStep";
import { AngleStep, FormatStep } from "@/components/youtube/idea/FormatAngle";
import CriteriaStep from "@/components/youtube/idea/CriteriaStep";

export type IdeaPageData = {
  video: YtVideo;
  refs: YtReference[];
  weights: Record<string, number>;
  viewGoal: number | null;
  titles: number;
  note: { id: string; title: string } | null;
  aiReady: boolean;
  /** the topic this idea belongs to (Topic + Format = Idea) with its status on your channel */
  topic: { id: string; name: string; status: TopicStatus } | null;
  /** every idea of the topic (this one included) */
  siblings: TopicIdea[];
  /** all topics, to switch to an existing one */
  topics: { id: string; name: string }[];
  finder: React.ReactNode;
};

export default function IdeaStepper({ data }: { data: IdeaPageData }) {
  const { video } = data;
  const router = useRouter();
  const [step, setStep] = useState<IdeaStep>(video.step ?? "topic");
  const [, start] = useTransition();
  const go = (s: IdeaStep) => {
    setStep(s);
    if (s !== video.step) start(async () => {
      await updateIdea(video.id, { step: s });
      router.refresh();
    });
  };
  const save = async (patch: Parameters<typeof updateIdea>[1]) => {
    const r = await updateIdea(video.id, patch);
    if (!r.error) router.refresh();
    return r.error ?? null;
  };
  const idx = IDEA_STEPS.findIndex((s) => s.id === step);
  const approved = !(video.stage === "bank" || video.stage === "idea");

  return (
    <div className="space-y-4">
      {approved && (
        <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {video.stage === "archived" ? "Parked idea — you can still edit it, then move it back from the board." : `Approved${video.code ? ` as ${video.code}` : ""}. `}
          {video.stage !== "archived" && (
            <Link href={videoHref(video.id, "package")} className="font-medium underline-offset-2 hover:underline">
              Go to Package →
            </Link>
          )}
        </p>
      )}

      <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-card sm:grid-cols-[1fr_auto]">
        <label className={LABEL}>
          Idea name — plain words, what the video really is (titles come later, in Package)
          <AutoField value={video.idea_name} maxLength={200} label="Idea name" onSave={(v) => save({ idea_name: v })} />
        </label>
        <div className="flex flex-wrap items-start gap-3 sm:flex-col">
          <label className={LABEL}>
            Kind
            <select
              defaultValue={video.kind}
              onChange={(e) => void save({ kind: e.target.value as "long" | "short" })}
              className="block rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg"
            >
              <option value="long">Long video</option>
              <option value="short">Short</option>
            </select>
          </label>
          {video.kind === "short" && (
            <label className={LABEL}>
              Short role
              <select
                defaultValue={video.short_role ?? ""}
                onChange={(e) => void save({ short_role: e.target.value || null })}
                className="block rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg"
              >
                <option value="">—</option>
                {SHORT_ROLES.map((r) => (
                  <option key={r.id} value={r.id} title={r.hint}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {(data.note || video.source_quote) && (
          <div className="text-xs text-muted sm:col-span-2">
            {data.note && (
              <p>
                From note:{" "}
                <Link href={`/notes/${data.note.id}`} className="text-accent hover:underline">
                  {data.note.title || "Untitled"}
                </Link>
              </p>
            )}
            {video.source_quote && <blockquote className="mt-1 line-clamp-3 border-l-2 border-line pl-2 italic">{video.source_quote}</blockquote>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs" aria-label="Killer idea formula">
        {([
          ["topic", "Topic", data.topic?.name ?? video.topic ?? null],
          ["format", "Format", video.format ? [video.format, ...extrasOf(video.formats, video.format)].map((f) => FORMATS.find((x) => x.id === f)?.label ?? f).join(" + ") : null],
          ["angle", "Angle", video.angle ? [video.angle, ...extrasOf(video.angles, video.angle)].map((a) => ANGLES.find((x) => x.id === a)?.label ?? a).join(" + ") : null],
        ] as const).map(([stepId, label, val], i) => (
          <span key={stepId} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-faint">{i === 2 ? "+ ➜" : "+"}</span>}
            <button type="button" onClick={() => go(stepId)} className={`max-w-56 truncate rounded-full border px-2.5 py-0.5 ${val ? "border-accent/40 bg-accent-soft text-accent" : "border-dashed border-line-strong text-faint hover:bg-subtle"}`} title={`${label}: ${val ?? "not chosen yet"}`}>
              {label}: {val ?? "—"}
            </button>
          </span>
        ))}
        <span className={`ml-auto font-semibold ${video.format && video.angle ? "text-success" : "text-muted"}`}>{video.format && video.angle ? "Killer idea ✓" : video.format ? "Idea — needs an angle" : "Needs a format"}</span>
      </div>

      <nav aria-label="Ideation steps" className="grid grid-cols-4 gap-1">
        {IDEA_STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.id)}
            aria-current={s.id === step ? "step" : undefined}
            className={`rounded-md border px-2 py-2 text-left text-xs transition-colors ${s.id === step ? "border-accent bg-accent-soft text-accent" : i < idx ? "border-line bg-subtle text-fg" : "border-line text-muted hover:bg-subtle"}`}
          >
            <span className="block font-semibold">
              {i + 1}. {s.label}
            </span>
            <span className="hidden text-[11px] text-muted sm:block">{s.hint}</span>
          </button>
        ))}
      </nav>

      {step === "topic" && <TopicStep data={data} onSave={save} />}
      {step === "format" && <FormatStep video={video} siblings={data.siblings} aiReady={data.aiReady} onSave={save} />}
      {step === "angle" && <AngleStep video={video} siblings={data.siblings} aiReady={data.aiReady} titles={data.titles} onSave={save} />}
      {step === "criteria" && <CriteriaStep data={data} onGo={go} />}

      <div className="flex justify-between">
        <button type="button" disabled={idx === 0} onClick={() => go(IDEA_STEPS[idx - 1].id)} className="text-sm text-muted hover:text-fg disabled:invisible">
          ← {IDEA_STEPS[idx - 1]?.label}
        </button>
        <button type="button" disabled={idx === IDEA_STEPS.length - 1} onClick={() => go(IDEA_STEPS[idx + 1].id)} className="text-sm font-medium text-accent hover:underline disabled:invisible">
          {IDEA_STEPS[idx + 1]?.label} →
        </button>
      </div>
    </div>
  );
}
