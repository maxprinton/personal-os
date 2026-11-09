"use client";
// Ideation steps 2 · Format (Topic + Format = Base idea) and 3 · Angle, each with ✨ suggestions
// shown as a preview (accept one by one, or discard).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTitleCandidate, aiSuggestAngles, aiSuggestFormats, updateIdea, type AngleSuggestion, type FormatSuggestion } from "@/app/youtube-actions/ideas";
import { showAiUsage } from "@/lib/ai-usage-client";
import Link from "next/link";
import { ANGLES, FORMATS, videoHref } from "@/lib/youtube/constants";
import { MAX_EXTRAS, extrasOf, sameMix, takenBy, usedAngles, type TopicIdea } from "@/lib/youtube/topics";
import type { YtVideo } from "@/lib/youtube/types";
import { AI_BTN, AiPreview, AutoField, BOX, BTN_SM, Chip, LABEL, Msg } from "@/components/youtube/idea/ui";

type Save = (p: Parameters<typeof updateIdea>[1]) => Promise<string | null>;

export function FormatStep({ video, siblings, aiReady, onSave }: { video: YtVideo; siblings: TopicIdea[]; aiReady: boolean; onSave: Save }) {
  const [format, setFormat] = useState<string | null>(video.format ?? null);
  const [mixed, setMixed] = useState<string[]>(extrasOf(video.formats, video.format));
  const [items, setItems] = useState<FormatSuggestion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [baseKey, setBaseKey] = useState(0);
  const [base, setBase] = useState(video.base_idea ?? "");
  const isLong = video.kind !== "short";
  const holder = (id: string) => (isLong ? takenBy(siblings, id, video.id) : null);
  const pick = async (id: string) => {
    const next = format === id ? null : id;
    setErr(null);
    const e = await onSave({ format: next });
    if (e) setErr(e);
    else {
      setFormat(next);
      setMixed((m) => (next ? m.filter((x) => x !== next) : []));
    }
  };
  const toggleMix = async (id: string) => {
    const next = mixed.includes(id) ? mixed.filter((x) => x !== id) : [...mixed, id];
    if (next.length > MAX_EXTRAS) return setErr(`Mix in at most ${MAX_EXTRAS} formats.`);
    setErr(null);
    const e = await onSave({ formats_extra: next });
    if (e) setErr(e);
    else setMixed(next);
  };
  const dupMix = isLong ? sameMix(siblings, format, mixed, video.id) : null;
  const ask = () =>
    start(async () => {
      setErr(null);
      const r = await aiSuggestFormats(video.id);
      showAiUsage(r.usage);
      if (r.error) setErr(r.error);
      else setItems(r.items ?? []);
    });
  const accept = async (s: FormatSuggestion) => {
    setErr(null);
    const e = await onSave({ format: s.format, base_idea: s.base_idea });
    if (e) setErr(e);
    else {
      setFormat(s.format);
      setBase(s.base_idea);
      setBaseKey((k) => k + 1);
      setItems((l) => (l ?? []).filter((x) => x !== s));
    }
  };
  return (
    <div className="space-y-4">
      <div className={BOX}>
        <h3 className="text-sm font-semibold">Format — Topic + Format = Idea</h3>
        <p className="text-xs text-muted">
          One format per idea. The same topic can be tried in other formats (that’s how you test it on your channel), but a topic + format pair is used once.
        </p>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => {
            const used = holder(f.id);
            return (
              <span key={f.id} className="inline-flex items-center gap-1">
                <Chip on={format === f.id} onClick={() => void pick(f.id)} disabled={!!used} title={used ? `Already used by “${used.idea_name}”` : f.hint}>
                  {f.label}
                </Chip>
                {used && (
                  <Link href={videoHref(used.id, "idea")} className="text-[11px] text-accent hover:underline" title={used.idea_name}>
                    {used.code ?? "open"} ↗
                  </Link>
                )}
              </span>
            );
          })}
        </div>
        <p className="text-xs text-muted">{FORMATS.find((f) => f.id === format)?.hint ?? "Pick the main format."}</p>
        <div className="space-y-1.5 rounded-md bg-subtle px-3 py-2">
          <p className="text-xs font-medium text-muted">Mix in another format (optional, up to {MAX_EXTRAS})</p>
          <div className="flex flex-wrap gap-2">
            {FORMATS.filter((f) => f.id !== format).map((f) => (
              <Chip key={f.id} on={mixed.includes(f.id)} onClick={() => void toggleMix(f.id)} disabled={!format} title={format ? f.hint : "Pick the main format first"}>
                + {f.label}
              </Chip>
            ))}
          </div>
          <p className="text-[11px] text-faint">Only the main format counts for “used once”. The mix is saved with the idea and shown as tags, so you can compare mixes later.</p>
          {dupMix && <p className="text-xs text-warning">⚠ Same mix as “{dupMix.code ? `${dupMix.code} · ` : ""}{dupMix.idea_name}”, just with another main format. Allowed — make sure it’s really a different video.</p>}
        </div>
        <label className={LABEL}>
          Base idea = Topic + Format (one sentence)
          <AutoField key={baseKey} value={base} multiline rows={2} maxLength={2000} label="Base idea" onSave={(v) => onSave({ base_idea: v })} />
        </label>
        <p className="rounded-md bg-subtle px-3 py-2 text-xs text-muted">
          <b>Be remarkable:</b> make it <i>better</i> (title, thumbnail, quality) or <i>different</i> (an unexpected angle — the next step).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={ask} disabled={pending || !aiReady} className={AI_BTN} title={aiReady ? "" : "Connect the AI (GROQ_API_KEY) first"}>
            {pending ? "Thinking…" : "✨ A base idea for each free format"}
          </button>
          <Msg error={err} />
        </div>
        {items && (
          <AiPreview title="Base ideas" onDiscard={() => setItems(null)}>
            {items.length === 0 && <p className="text-xs text-muted">All handled.</p>}
            <ul className="space-y-2">
              {items.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="w-24 shrink-0 text-xs font-semibold text-muted">{FORMATS.find((f) => f.id === s.format)?.label}</span>
                  <span className="flex-1">{s.base_idea}</span>
                  <button type="button" className={BTN_SM} onClick={() => void accept(s)}>
                    Use
                  </button>
                  <button type="button" className={BTN_SM} onClick={() => setItems((l) => (l ?? []).filter((x) => x !== s))} aria-label="Discard">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </AiPreview>
        )}
      </div>
    </div>
  );
}

export function AngleStep({ video, siblings, aiReady, titles, onSave }: { video: YtVideo; siblings: TopicIdea[]; aiReady: boolean; titles: number; onSave: Save }) {
  const router = useRouter();
  const [angle, setAngle] = useState<string | null>(video.angle ?? null);
  const [support, setSupport] = useState<string[]>(extrasOf(video.angles, video.angle));
  const [items, setItems] = useState<AngleSuggestion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [notes, setNotes] = useState(video.angle_notes ?? "");
  const [notesKey, setNotesKey] = useState(0);
  const [added, setAdded] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const taken = usedAngles(siblings, video.id);
  const pick = async (id: string) => {
    const next = angle === id ? null : id;
    setErr(null);
    const e = await onSave({ angle: next });
    if (e) setErr(e);
    else {
      setAngle(next);
      setSupport((m) => (next ? m.filter((x) => x !== next) : []));
    }
  };
  const toggleSupport = async (id: string) => {
    const next = support.includes(id) ? support.filter((x) => x !== id) : [...support, id];
    if (next.length > MAX_EXTRAS) return setErr(`Use at most ${MAX_EXTRAS} supporting angles.`);
    setErr(null);
    const e = await onSave({ angles_extra: next });
    if (e) setErr(e);
    else setSupport(next);
  };
  const ask = () =>
    start(async () => {
      setErr(null);
      const r = await aiSuggestAngles(video.id);
      showAiUsage(r.usage);
      if (r.error) setErr(r.error);
      else setItems(r.items ?? []);
    });
  const accept = async (s: AngleSuggestion) => {
    const label = ANGLES.find((a) => a.id === s.angle)?.label ?? s.angle;
    const nextNotes = `${notes.trim()}${notes.trim() ? "\n" : ""}${label}: ${s.idea}`;
    setErr(null);
    const e = await onSave({ angle: s.angle, angle_notes: nextNotes });
    if (e) return setErr(e);
    setAngle(s.angle);
    setNotes(nextNotes);
    setNotesKey((k) => k + 1);
    setItems((l) => (l ?? []).filter((x) => x !== s));
  };
  const addTitle = async (t: string) => {
    setErr(null);
    const r = await addTitleCandidate(video.id, t);
    if (r.error) setErr(r.error);
    else {
      setAdded((a) => [...a, t]);
      setInfo("Title saved to the package.");
      router.refresh();
    }
  };
  return (
    <div className={BOX}>
      <h3 className="text-sm font-semibold">Angle — Idea + Angle = Killer idea</h3>
      <p className="text-xs text-muted">
        {video.format ? `The idea is “${video.idea_name}” (${[video.format, ...extrasOf(video.formats, video.format)].map((f) => FORMATS.find((x) => x.id === f)?.label ?? f).join(" + ")}).` : "Pick the format first."} Choose the <b>lead angle</b>:
        the one that makes <i>this</i> topic in <i>this</i> format worth clicking. It shapes the title and thumbnail. You can add up to {MAX_EXTRAS} supporting angles below.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {ANGLES.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={angle === a.id}
            onClick={() => void pick(a.id)}
            className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${angle === a.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-subtle"}`}
          >
            <span className="block font-semibold">
              {a.label}
              {taken.includes(a.id) && <span className="ml-1 rounded bg-subtle px-1 text-[10px] font-normal text-muted">used on this topic</span>}
            </span>
            <span className="text-[11px] opacity-80">{a.example}</span>
          </button>
        ))}
      </div>
      <div className="space-y-1.5 rounded-md bg-subtle px-3 py-2">
        <p className="text-xs font-medium text-muted">Supporting angles (optional, up to {MAX_EXTRAS})</p>
        <div className="flex flex-wrap gap-2">
          {ANGLES.filter((a) => a.id !== angle).map((a) => (
            <Chip key={a.id} on={support.includes(a.id)} onClick={() => void toggleSupport(a.id)} disabled={!angle} title={angle ? a.example : "Pick the lead angle first"}>
              + {a.label}
            </Chip>
          ))}
        </div>
      </div>
      <label className={LABEL}>
        How the angle plays out (notes)
        <AutoField key={notesKey} value={notes} multiline rows={3} maxLength={4000} label="Angle notes" onSave={(v) => onSave({ angle_notes: v })} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={ask} disabled={pending || !aiReady} className={AI_BTN}>
          {pending ? "Thinking…" : "✨ Angle variations + titles"}
        </button>
        <span className="text-xs text-faint">{titles}/3 titles in the package</span>
        <Msg error={err} info={info} />
      </div>
      {items && (
        <AiPreview title="Angle variations" onDiscard={() => setItems(null)}>
          {items.length === 0 && <p className="text-xs text-muted">All handled.</p>}
          <ul className="space-y-3">
            {items.map((s, i) => (
              <li key={i} className="space-y-1 text-sm">
                <div className="flex items-start gap-2">
                  <span className="w-28 shrink-0 text-xs font-semibold text-muted">{ANGLES.find((a) => a.id === s.angle)?.label}</span>
                  <span className="flex-1">{s.idea}</span>
                  <button type="button" className={BTN_SM} onClick={() => void accept(s)}>
                    Use angle
                  </button>
                  <button type="button" className={BTN_SM} onClick={() => setItems((l) => (l ?? []).filter((x) => x !== s))} aria-label="Discard">
                    ✕
                  </button>
                </div>
                {s.titles.length > 0 && (
                  <ul className="ml-0 space-y-1 sm:ml-30">
                    {s.titles.map((t) => (
                      <li key={t} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 text-fg">“{t}”</span>
                        <button type="button" disabled={added.includes(t)} className={BTN_SM} onClick={() => void addTitle(t)}>
                          {added.includes(t) ? "Added" : "+ Title"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </AiPreview>
      )}
    </div>
  );
}
