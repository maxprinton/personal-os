"use client";
// Package · Title + thumbnail pairs (A, B, C) — the variants for A/B tests later. One is the primary.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPair, autoPairs, deletePair, setPrimaryPair, updatePair } from "@/app/youtube-actions/package";
import { MAX_THUMBNAILS, MAX_TITLES } from "@/lib/youtube/constants";
import { titleWarnings } from "@/lib/youtube/package";
import type { YtPair, YtVariant, YtVideo } from "@/lib/youtube/types";
import { BOX, BTN, BTN_SM, Msg, Warn } from "@/components/youtube/idea/ui";

const SELECT = "rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-fg";

export default function PairsBox({ video, titles, thumbs, pairs }: { video: YtVideo; titles: YtVariant[]; thumbs: YtVariant[]; pairs: YtPair[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (r.error) setErr(r.error);
      else router.refresh();
    });
  const max = Math.max(MAX_TITLES, MAX_THUMBNAILS);
  return (
    <div className={BOX}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Pairs (title + thumbnail)</h3>
        <div className="flex gap-2">
          {pairs.length === 0 && (
            <button type="button" className={BTN} disabled={pending || !titles.length || !thumbs.length} onClick={() => run(() => autoPairs(video.id))}>
              Auto-pair
            </button>
          )}
          <button type="button" className={BTN} disabled={pending || pairs.length >= max} onClick={() => run(() => addPair(video.id, titles[0]?.id, thumbs[0]?.id))}>
            + Pair
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">Each pair must open the curiosity gap together. They become the variants of the A/B test after publishing.</p>
      {pairs.length > 0 && (
        <ul className="divide-y divide-line">
          {pairs.map((p) => {
            const title = titles.find((t) => t.id === p.title_id);
            const thumb = thumbs.find((t) => t.id === p.thumbnail_id);
            const repeats = title && thumb ? titleWarnings(title.value, { thumbTexts: [thumb.thumb_text] }).find((w) => w.kind === "repeats_thumb") : null;
            return (
              <li key={p.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-subtle text-sm font-semibold">{p.label}</span>
                  <select
                    className={`${SELECT} min-w-0 flex-1`}
                    value={p.title_id ?? ""}
                    aria-label={`Pair ${p.label} title`}
                    onChange={(e) => run(() => updatePair(p.id, { title_id: e.target.value || null }))}
                  >
                    <option value="">— title —</option>
                    {titles.map((t, i) => (
                      <option key={t.id} value={t.id}>
                        {i + 1}. {t.value}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted">+</span>
                  <select
                    className={`${SELECT} min-w-0 sm:w-48`}
                    value={p.thumbnail_id ?? ""}
                    aria-label={`Pair ${p.label} thumbnail`}
                    onChange={(e) => run(() => updatePair(p.id, { thumbnail_id: e.target.value || null }))}
                  >
                    <option value="">— thumbnail —</option>
                    {thumbs.map((t, i) => (
                      <option key={t.id} value={t.id}>
                        #{i + 1} {t.value}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input type="radio" name={`primary-${video.id}`} checked={p.is_primary} onChange={() => run(() => setPrimaryPair(p.id))} />
                    Primary
                  </label>
                  <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => deletePair(p.id))}>
                    Remove
                  </button>
                </div>
                {repeats && <Warn level="warn">{repeats.text}</Warn>}
              </li>
            );
          })}
        </ul>
      )}
      <Msg error={err} />
    </div>
  );
}
