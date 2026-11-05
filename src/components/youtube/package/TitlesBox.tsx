"use client";
// Package · Titles (up to 3): the first words carry the idea (highlighted), length counter, warnings
// (too long, repeats the thumbnail text, almost the idea name, duplicate, ALL CAPS) and ✨ suggestions.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addVariant, aiSuggestTitles, archiveVariant, updateVariant, type TitleSuggestion } from "@/app/youtube-actions/package";
import { showAiUsage } from "@/lib/ai-usage-client";
import { MAX_TITLES, TITLE_CUT_WARNING, TITLE_FIRST_WORDS, TITLE_SOFT_LIMIT } from "@/lib/youtube/constants";
import { splitFirstWords, titleWarnings } from "@/lib/youtube/package";
import type { YtVariant, YtVideo } from "@/lib/youtube/types";
import { AI_BTN, AiPreview, AutoField, BOX, BTN, BTN_SM, INPUT, Msg, Warn } from "@/components/youtube/idea/ui";

export default function TitlesBox({ video, titles, thumbs, aiReady }: { video: YtVideo; titles: YtVariant[]; thumbs: YtVariant[]; aiReady: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<TitleSuggestion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const full = titles.length >= MAX_TITLES;
  const add = (value: string, after?: () => void) =>
    start(async () => {
      setErr(null);
      const r = await addVariant(video.id, "title", value);
      if (r.error) setErr(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  const ask = () =>
    start(async () => {
      setErr(null);
      const r = await aiSuggestTitles(video.id);
      showAiUsage(r.usage);
      if (r.error) setErr(r.error);
      else setItems(r.items ?? []);
    });
  const thumbTexts = thumbs.map((t) => t.thumb_text);
  return (
    <div className={BOX}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Titles <span className="font-normal text-muted">({titles.length}/{MAX_TITLES})</span>
        </h3>
        <p className="text-xs text-muted">
          Clickable, never boring, the idea in the first {TITLE_FIRST_WORDS} words, ≤ {TITLE_SOFT_LIMIT} characters.
        </p>
      </div>
      <ol className="space-y-3">
        {titles.map((t, i) => (
          <TitleRow key={t.id} t={t} n={i + 1} ctx={{ ideaName: video.idea_name, thumbTexts, otherTitles: titles.filter((x) => x.id !== t.id).map((x) => x.value) }} />
        ))}
      </ol>
      {!full && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) add(draft, () => setDraft(""));
            }}
            maxLength={150}
            placeholder="New title…"
            className={INPUT}
            aria-label="New title"
          />
          <button type="button" className={BTN} disabled={pending || !draft.trim()} onClick={() => add(draft, () => setDraft(""))}>
            Add
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={ask} disabled={pending || !aiReady} className={AI_BTN} title={aiReady ? "From the idea name + angle + curiosity gap" : "Connect the AI (GROQ_API_KEY) first"}>
          {pending && !draft ? "Thinking…" : "✨ Suggest titles"}
        </button>
        <Msg error={err} />
      </div>
      {items && (
        <AiPreview title="Title ideas" onDiscard={() => setItems(null)}>
          {items.length === 0 && <p className="text-xs text-muted">All handled.</p>}
          <ul className="space-y-2">
            {items.map((s) => {
              const sp = splitFirstWords(s.title);
              return (
                <li key={s.title} className="flex items-start gap-2 text-sm">
                  <div className="flex-1">
                    <p>
                      <b>{sp.head}</b>
                      {sp.tail} <span className="text-[11px] text-faint">{[...s.title].length}</span>
                    </p>
                    {s.why && <p className="text-[11px] text-muted">{s.why}</p>}
                  </div>
                  <button type="button" className={BTN_SM} disabled={pending || full} title={full ? "Remove a title first" : ""} onClick={() => add(s.title, () => setItems((l) => (l ?? []).filter((x) => x !== s)))}>
                    Use
                  </button>
                  <button type="button" className={BTN_SM} onClick={() => setItems((l) => (l ?? []).filter((x) => x !== s))} aria-label="Discard">
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          {full && <p className="text-[11px] text-warning">You already have {MAX_TITLES} titles — remove one to use another.</p>}
        </AiPreview>
      )}
    </div>
  );
}

function TitleRow({ t, n, ctx }: { t: YtVariant; n: number; ctx: Parameters<typeof titleWarnings>[1] }) {
  const router = useRouter();
  const [live, setLive] = useState(t.value);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const sp = splitFirstWords(live);
  const len = [...live.trim()].length;
  const warns = titleWarnings(live, ctx);
  return (
    <li className="space-y-1">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 w-4 text-xs text-faint">{n}</span>
        <div className="flex-1" onInput={(e) => setLive((e.target as HTMLInputElement).value)}>
          <AutoField
            value={t.value}
            maxLength={150}
            label={`Title ${n}`}
            onSave={async (v) => {
              const r = await updateVariant(t.id, { value: v });
              if (!r.error) router.refresh();
              return r.error ?? null;
            }}
          />
        </div>
        <span className={`mt-1.5 w-12 text-right text-xs tabular-nums ${len > TITLE_CUT_WARNING ? "text-danger" : len > TITLE_SOFT_LIMIT ? "text-warning" : "text-faint"}`}>
          {len}/{TITLE_SOFT_LIMIT}
        </span>
        <button
          type="button"
          className={`${BTN_SM} mt-1`}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await archiveVariant(t.id);
              if (r.error) setErr(r.error);
              else router.refresh();
            })
          }
        >
          Remove
        </button>
      </div>
      <p className="ml-6 text-xs text-muted">
        <mark className="rounded bg-accent-soft px-0.5 text-accent">{sp.head}</mark>
        {sp.tail} <span className="text-[11px] text-faint">— does the idea show in the highlighted words?</span>
      </p>
      <div className="ml-6 space-y-0.5">
        {warns.map((w) => (
          <Warn key={w.kind} level={w.level}>
            {w.text}
          </Warn>
        ))}
        <Msg error={err} />
      </div>
    </li>
  );
}
