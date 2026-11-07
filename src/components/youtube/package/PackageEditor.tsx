"use client";
// Package step (Worker A): idea name pinned on top → curiosity gap → titles → thumbnail concepts → pairs →
// realistic preview → final tests → "package ready". The idea name never changes here (it lives in Idea).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveGap, setPackageReady } from "@/app/youtube-actions/package";
import { videoHref } from "@/lib/youtube/constants";
import { packageReadyHint } from "@/lib/youtube/package";
import type { YtPair, YtVariant, YtVideo } from "@/lib/youtube/types";
import { AutoField, BOX, BTN, LABEL, Msg, PRIMARY } from "@/components/youtube/idea/ui";
import TitlesBox from "@/components/youtube/package/TitlesBox";
import ThumbsBox, { FinalTests } from "@/components/youtube/package/ThumbsBox";
import PairsBox from "@/components/youtube/package/PairsBox";
import PackagePreview from "@/components/youtube/package/PackagePreview";

export type CrowdItem = { id: string; title: string; channel: string; views: number | null; image: string; published_at: string | null };

export default function PackageEditor({
  video,
  titles,
  thumbs,
  pairs,
  crowd,
  channel,
  aiReady,
}: {
  video: YtVideo;
  titles: YtVariant[];
  thumbs: YtVariant[];
  pairs: YtPair[];
  crowd: CrowdItem[];
  channel: string;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});
  const [pending, start] = useTransition();
  const bank = video.stage === "bank" || video.stage === "idea";
  const hint = packageReadyHint({
    gapKnown: video.gap_known,
    gapWant: video.gap_want,
    titles: titles.map((t) => ({ id: t.id, value: t.value })),
    thumbs: thumbs.map((t) => ({ id: t.id, tests: t.tests, image_url: t.image_url })),
    pairs,
  });
  const gap = (k: "gap_known" | "gap_want") => async (v: string) => {
    const r = await saveGap(video.id, { [k]: v });
    if (!r.error) router.refresh();
    return r.error ?? null;
  };
  const ready = (on: boolean) =>
    start(async () => {
      const r = await setPackageReady(video.id, on);
      setMsg(r.error ? { error: r.error } : { info: on ? "Package ready." : "Marked as not ready." });
      if (!r.error) router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 -mx-1 rounded-lg border border-line bg-surface/95 px-4 py-2 shadow-card backdrop-blur">
        <p className="text-[11px] uppercase tracking-wide text-faint">Idea name — what the video really is (not the title)</p>
        <p className="text-sm font-semibold">
          {video.idea_name}{" "}
          <Link href={videoHref(video.id, "idea")} className="text-xs font-normal text-accent hover:underline">
            edit in Idea
          </Link>
        </p>
      </div>

      {bank && (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          This idea is still in the bank. You can sketch the package, but approve it in{" "}
          <Link href={videoHref(video.id, "idea")} className="underline">Idea → Criteria</Link> first to get its V-number.
        </p>
      )}

      <div className={BOX}>
        <h3 className="text-sm font-semibold">Curiosity gap</h3>
        <p className="text-xs text-muted">The distance between what the viewer knows and what they want to know. Title and thumbnail each give one part — never the same part twice.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL}>
            What the viewer already knows
            <AutoField value={video.gap_known ?? ""} multiline rows={2} maxLength={1000} label="What the viewer already knows" onSave={gap("gap_known")} />
          </label>
          <label className={LABEL}>
            What they want to know
            <AutoField value={video.gap_want ?? ""} multiline rows={2} maxLength={1000} label="What they want to know" onSave={gap("gap_want")} />
          </label>
        </div>
      </div>

      <TitlesBox video={video} titles={titles} thumbs={thumbs} aiReady={aiReady} />
      <ThumbsBox video={video} thumbs={thumbs} />
      <PairsBox video={video} titles={titles} thumbs={thumbs} pairs={pairs} />
      <PackagePreview titles={titles} thumbs={thumbs} pairs={pairs} crowd={crowd} channel={channel} />
      <FinalTests thumbs={thumbs} pairs={pairs} />

      <div className={`${BOX} ${video.package_ready ? "border-success" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{video.package_ready ? "✅ Package ready" : "Package ready?"}</h3>
          {video.package_ready ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN} disabled={pending} onClick={() => ready(false)}>
                Not ready yet
              </button>
              <Link href={videoHref(video.id, "research")} className={PRIMARY}>
                Go to Research →
              </Link>
            </div>
          ) : (
            <button type="button" className={PRIMARY} disabled={pending || !hint.ready} onClick={() => ready(true)}>
              Mark package ready
            </button>
          )}
        </div>
        {!video.package_ready && hint.missing.length > 0 && (
          <ul className="list-inside list-disc text-xs text-muted">
            {hint.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {!hint.bonus && <p className="text-[11px] text-faint">Bonus: 3 titles and 3 thumbnail concepts give you variations to swap in A/B tests later.</p>}
        <Msg {...msg} />
      </div>
    </div>
  );
}
