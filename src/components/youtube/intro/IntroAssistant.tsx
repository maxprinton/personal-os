"use client";
// Intro assistant ("killer intro", Aprilynne Alter): the package's pair pinned on top, First 5 seconds
// (first sentence vs title, first shot vs thumbnail), Exceed (open loop closed by the climax, context,
// input bias + logged moments), Final construction (without sound, pace — when shots exist), Watch it 10 times, ✨ ideas.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { aiIntroIdeas, setMomentUsed, updateIntro, type IntroIdeas } from "@/app/youtube-actions/script";
import { INTRO_STATUSES, INTRO_WATCH_TARGET, MOMENT_KINDS } from "@/lib/youtube/constants";
import { formatDuration, introReport } from "@/lib/youtube/outline";
import type { IntroGuides, IntroStatus, SectionKind, YtKind, YtMoment, YtSection } from "@/lib/youtube/types";
import type { PinnedPair, ScriptShot } from "@/components/youtube/script/ScriptWorkspace";
import { AI_BTN, BlurField, BTN_SM, Chip, INPUT, Msg } from "@/components/youtube/script/ui";

type Sec = { id: string; title: string; kind: SectionKind; is_climax: boolean; content: string };

const H = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <div>
    <h4 className="text-sm font-semibold">{children}</h4>
    {hint && <p className="text-[11px] text-muted">{hint}</p>}
  </div>
);
const CARD = "space-y-2 rounded-lg border border-line bg-surface p-3 shadow-card";

export default function IntroAssistant({
  videoId,
  kind,
  intro,
  introMd,
  sections,
  climaxId,
  pinned,
  shots,
  moments,
  wpm,
  aiReady,
  onInsert,
}: {
  videoId: string;
  kind: YtKind;
  intro: YtSection;
  introMd: string;
  sections: Sec[];
  climaxId: string | null;
  pinned: PinnedPair;
  shots: ScriptShot[];
  moments: YtMoment[];
  wpm: number;
  aiReady: boolean;
  onInsert: (text: string, where: "start" | "end") => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<IntroStatus>(intro.intro_status);
  useEffect(() => setStatus(intro.intro_status), [intro.intro_status]);
  const [guides, setGuides] = useState<IntroGuides>(intro.intro_guides ?? {});
  useEffect(() => setGuides(intro.intro_guides ?? {}), [intro.intro_guides]);
  const [watch, setWatch] = useState(intro.watch_checks ?? 0);
  useEffect(() => setWatch(intro.watch_checks ?? 0), [intro.watch_checks]);
  const [usedMoments, setUsedMoments] = useState(() => new Set(moments.filter((m) => m.used_in_intro).map((m) => m.id)));
  const [ideas, setIdeas] = useState<IntroIdeas | null>(null);
  const [usage, setUsage] = useState<string | null>(null);

  const report = useMemo(
    () =>
      introReport({
        introId: intro.id,
        introMd,
        title: pinned.title,
        shots: shots.map((s) => ({ kind: s.kind, para_hash: s.para_hash, duration_s: s.duration_s, section_id: s.section_id, position: s.position, matches_thumbnail: s.matches_thumbnail, description: s.description })),
        sections: sections.map((s) => ({ id: s.id, content: s.content })),
        wpm,
      }),
    [intro.id, introMd, pinned.title, shots, sections, wpm],
  );
  const hasShots = shots.length > 0;
  const closesId = guides.closes_section_id ?? climaxId ?? null;
  const others = sections.filter((s) => s.kind !== "intro");

  const save = async (patch: Parameters<typeof updateIntro>[1]) => {
    const r = await updateIntro(intro.id, patch);
    if (r.error) setErr(r.error);
    else {
      setErr(null);
      router.refresh();
    }
    return r.error ?? null;
  };
  const saveGuide = (patch: Partial<IntroGuides>) => {
    setGuides((g) => ({ ...g, ...patch }));
    return save({ guides: patch });
  };

  const pickMoment = (m: YtMoment) => {
    const next = [guides.input_bias?.trim(), m.text.trim()].filter(Boolean).join("\n");
    setUsedMoments((s) => new Set(s).add(m.id));
    start(async () => {
      await saveGuide({ input_bias: next });
      const r = await setMomentUsed(m.id, true);
      if (r.error) setErr(r.error);
    });
  };

  const askAi = () =>
    start(async () => {
      setErr(null);
      const r = await aiIntroIdeas(videoId, pinned.title);
      setUsage(r.usage ?? null);
      if (r.error || !r.ideas) setErr(r.error ?? "No ideas this time. Try again.");
      else setIdeas(r.ideas);
    });

  const sectionByTitle = (t?: string) => {
    if (!t) return null;
    const k = t.trim().toLowerCase();
    return others.find((s) => s.title.trim().toLowerCase() === k) ?? others.find((s) => k.includes(s.title.trim().toLowerCase()) || s.title.trim().toLowerCase().includes(k)) ?? null;
  };

  return (
    <aside className="min-w-0 space-y-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto" aria-label="Intro assistant">
      {/* Pinned pair */}
      <div className={`${CARD} border-accent/40`}>
        <div className="flex items-center justify-between gap-2">
          <H>📌 {pinned.primary ? `Primary pair${pinned.label ? ` ${pinned.label}` : ""}` : "Your package"}</H>
          <a href={`/youtube/v/${videoId}/package`} className="text-xs text-muted hover:text-accent">
            Package →
          </a>
        </div>
        {pinned.thumbnail?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pinned.thumbnail.image} alt="Thumbnail" className="aspect-video w-full rounded-md border border-line object-cover" />
        ) : pinned.thumbnail ? (
          <div className="flex aspect-video w-full flex-col items-center justify-center rounded-md border border-dashed border-line bg-subtle p-2 text-center">
            <span className="text-sm font-medium">{pinned.thumbnail.concept}</span>
            {pinned.thumbnail.focal && <span className="text-[11px] text-muted">Focal: {pinned.thumbnail.focal}</span>}
            {pinned.thumbnail.text && <span className="text-xs font-bold uppercase">“{pinned.thumbnail.text}”</span>}
          </div>
        ) : null}
        <p className="text-sm font-semibold leading-snug">{pinned.title ?? <span className="font-normal text-muted">No title yet — the intro delivers on the title, so pick one in Package.</span>}</p>
      </div>

      {/* Status */}
      <div className={CARD}>
        <H hint={kind === "short" ? "The Hook: first 1–2 seconds, with on-screen text." : "Never blocks filming. Needs Final + Filmed to publish."}>Intro status</H>
        <div className="flex flex-wrap gap-1.5">
          {INTRO_STATUSES.map((s) => (
            <Chip
              key={s.id}
              on={status === s.id}
              disabled={pending}
              onClick={() => {
                setStatus(s.id);
                start(async () => void (await save({ intro_status: s.id })));
              }}
            >
              {s.label}
            </Chip>
          ))}
        </div>
        <p className="text-[11px] tabular-nums text-faint">
          {report.words} words · ≈ {formatDuration(report.seconds)}
        </p>
      </div>

      {/* First 5 seconds */}
      <div className={CARD}>
        <H hint="Meet the expectations the title and thumbnail set — not word for word.">First 5 seconds</H>
        <div className="space-y-1 text-xs">
          <p className="text-muted">First sentence</p>
          <p className="rounded bg-subtle p-1.5 text-sm">{report.firstSentence || <span className="text-faint">Nothing written yet.</span>}</p>
          {report.title ? (
            report.title.ok ? (
              <p className="text-success">✓ Shares the title’s key words: {report.title.shared.join(", ")}</p>
            ) : (
              <p className="text-warning">
                ⚠ Doesn’t carry the title’s key words{report.title.missing.length ? ` (missing: ${report.title.missing.slice(0, 5).join(", ")})` : ""}.
              </p>
            )
          ) : (
            <p className="text-faint">{pinned.title ? "Write the first sentence to check it." : "No title to compare yet."}</p>
          )}
        </div>
        <div className="space-y-1 text-xs">
          <p className="text-muted">First shot vs thumbnail</p>
          {report.firstShot ? (
            <>
              <p className="rounded bg-subtle p-1.5 text-sm">
                <span className="font-mono text-[11px] text-muted">{report.firstShot.kind}</span> {report.firstShot.description || "(no description)"}
              </p>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!guides.first_shot_matches} onChange={(e) => void saveGuide({ first_shot_matches: e.target.checked })} />
                The first shot matches the thumbnail ✓
              </label>
            </>
          ) : (
            <p className="text-faint">No intro shots yet — add them in the Shots tab.</p>
          )}
        </div>
      </div>

      {/* Exceed */}
      <div className={CARD}>
        <H hint="Then go beyond: a question they stay for, what they need to know, and the effort it took.">Exceed expectations</H>
        <label className="block space-y-1 text-xs text-muted">
          Open loop
          <BlurField multiline rows={2} value={guides.open_loop ?? ""} placeholder="The question the video will answer…" onSave={(v) => saveGuide({ open_loop: v })} className={`${INPUT} text-sm`} />
        </label>
        <label className="block space-y-1 text-xs text-muted">
          Closed in
          <select
            className={`${INPUT} text-sm`}
            value={closesId ?? ""}
            onChange={(e) => void saveGuide({ closes_section_id: e.target.value || null })}
          >
            <option value="">— choose a part —</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.is_climax ? " ★ (climax)" : ""}
              </option>
            ))}
          </select>
          {!guides.closes_section_id && climaxId && <span className="block text-[11px] text-faint">By default the climax closes the loop.</span>}
        </label>
        <label className="block space-y-1 text-xs text-muted">
          Context
          <BlurField multiline rows={2} value={guides.context ?? ""} placeholder="What they need to know for the video to make sense…" onSave={(v) => saveGuide({ context: v })} className={`${INPUT} text-sm`} />
        </label>
        <label className="block space-y-1 text-xs text-muted">
          Input bias (effort: time, energy, money)
          <BlurField multiline rows={2} value={guides.input_bias ?? ""} placeholder="“It took me 3 weeks and 40 tries…”" onSave={(v) => saveGuide({ input_bias: v })} className={`${INPUT} text-sm`} />
        </label>
        {moments.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted">Moments you logged while filming</p>
            <ul className="space-y-1">
              {moments.map((m) => (
                <li key={m.id} className="flex items-start gap-1.5 text-xs">
                  <span title={m.kind}>{MOMENT_KINDS.find((k) => k.id === m.kind)?.icon ?? "📝"}</span>
                  <span className="min-w-0 flex-1">{m.text}</span>
                  {usedMoments.has(m.id) ? (
                    <span className="text-success">used</span>
                  ) : (
                    <button type="button" className={BTN_SM} disabled={pending} onClick={() => pickMoment(m)}>
                      Use
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Final construction */}
      <div className={CARD}>
        <H hint="Show, don’t tell: it should work without sound. And cut faster than the rest of the video.">Final construction</H>
        {!hasShots ? (
          <p className="text-xs text-faint">These checks run once the video has shots (Shots tab).</p>
        ) : (
          <>
            {report.noShots ? (
              <p className="text-xs text-warning">⚠ The intro has text but no shots yet.</p>
            ) : report.silentGaps.length ? (
              <div className="space-y-1 text-xs">
                <p className="text-warning">⚠ Without sound, these lines only have talking head:</p>
                <ul className="list-disc space-y-0.5 pl-4 text-muted">
                  {report.silentGaps.slice(0, 6).map((p) => (
                    <li key={p.hash}>{p.text.length > 90 ? `${p.text.slice(0, 90)}…` : p.text}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-success">✓ Every intro line has a visual shot.</p>
            )}
            <p className={`text-xs ${report.pace.ok === false ? "text-warning" : report.pace.ok ? "text-success" : "text-faint"}`}>{report.pace.text}</p>
          </>
        )}
      </div>

      {/* Watch it 10 times */}
      <div className={CARD}>
        <H hint="If you get bored or look away, others will too. Note where.">Watch it 10 times</H>
        <div className="flex items-center gap-2">
          <button type="button" className={BTN_SM} disabled={watch <= 0} onClick={() => { const n = watch - 1; setWatch(n); void save({ watch_checks: n }); }} aria-label="One less">
            −
          </button>
          <span className="min-w-[3.5rem] text-center text-sm font-semibold tabular-nums">
            {watch}/{INTRO_WATCH_TARGET}
          </span>
          <button type="button" className={BTN_SM} disabled={watch >= INTRO_WATCH_TARGET} onClick={() => { const n = watch + 1; setWatch(n); void save({ watch_checks: n }); }} aria-label="One more">
            +
          </button>
          <div className="h-1.5 flex-1 overflow-hidden rounded bg-subtle">
            <div className="h-full bg-accent" style={{ width: `${(watch / INTRO_WATCH_TARGET) * 100}%` }} />
          </div>
        </div>
        <BlurField multiline rows={2} value={intro.watch_notes ?? ""} placeholder="Where did your attention drop?" onSave={(v) => save({ watch_notes: v })} className={`${INPUT} text-sm`} />
      </div>

      {/* AI */}
      <div className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <H>✨ Ideas</H>
          <button type="button" className={AI_BTN} disabled={pending || !aiReady} onClick={askAi} title={aiReady ? "" : "Connect the AI (GROQ_API_KEY)"}>
            {pending ? "Thinking…" : "✨ Suggest"}
          </button>
        </div>
        {!aiReady && <p className="text-[11px] text-faint">The AI isn’t connected (GROQ_API_KEY).</p>}
        {usage && <p className="text-[11px] text-faint">{usage}</p>}
        {ideas && (
          <div className="space-y-2 text-xs">
            {ideas.first_lines.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-muted">First lines</p>
                {ideas.first_lines.map((l, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="min-w-0 flex-1">{l}</span>
                    <button type="button" className={BTN_SM} onClick={() => onInsert(l, "start")}>
                      Use
                    </button>
                  </div>
                ))}
              </div>
            )}
            {ideas.open_loops.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-muted">Open loops</p>
                {ideas.open_loops.map((l, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="min-w-0 flex-1">
                      {l.text}
                      {l.closes && <span className="text-faint"> → {l.closes}</span>}
                    </span>
                    <button
                      type="button"
                      className={BTN_SM}
                      onClick={() => {
                        const sec = sectionByTitle(l.closes);
                        void saveGuide({ open_loop: l.text, ...(sec ? { closes_section_id: sec.id } : {}) });
                      }}
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            )}
            {ideas.context && (
              <div className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-muted">Context: </span>
                  {ideas.context}
                </span>
                <button type="button" className={BTN_SM} onClick={() => void saveGuide({ context: ideas.context })}>
                  Use
                </button>
              </div>
            )}
            {ideas.input_bias.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium text-muted">Input bias</p>
                {ideas.input_bias.map((l, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="min-w-0 flex-1">{l}</span>
                    <button type="button" className={BTN_SM} onClick={() => void saveGuide({ input_bias: [guides.input_bias?.trim(), l].filter(Boolean).join("\n") })}>
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className={BTN_SM} onClick={() => setIdeas(null)}>
              Discard ideas
            </button>
          </div>
        )}
      </div>
      <Msg error={err} />
    </aside>
  );
}
