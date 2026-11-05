"use client";
// Ideation steps 2 · Format (Topic + Format = Base idea) and 3 · Angle, each with ✨ suggestions
// shown as a preview (accept one by one, or discard).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTitleCandidate, aiSuggestAngles, aiSuggestFormats, updateIdea, type AngleSuggestion, type FormatSuggestion } from "@/app/youtube-actions/ideas";
import { showAiUsage } from "@/lib/ai-usage-client";
import { ANGLES, FORMATS } from "@/lib/youtube/constants";
import type { YtVideo } from "@/lib/youtube/types";
import { AI_BTN, AiPreview, AutoField, BOX, BTN_SM, Chip, LABEL, Msg } from "@/components/youtube/idea/ui";

type Save = (p: Parameters<typeof updateIdea>[1]) => Promise<string | null>;

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function FormatStep({ video, aiReady, onSave }: { video: YtVideo; aiReady: boolean; onSave: Save }) {
  const [formats, setFormats] = useState<string[]>(video.formats ?? []);
  const [items, setItems] = useState<FormatSuggestion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [baseKey, setBaseKey] = useState(0);
  const [base, setBase] = useState(video.base_idea ?? "");
  const pick = (id: string) => {
    const next = toggle(formats, id);
    setFormats(next);
    void onSave({ formats: next });
  };
  const ask = () =>
    start(async () => {
      setErr(null);
      const r = await aiSuggestFormats(video.id);
      showAiUsage(r.usage);
      if (r.error) setErr(r.error);
      else setItems(r.items ?? []);
    });
  const accept = async (s: FormatSuggestion) => {
    const next = formats.includes(s.format) ? formats : [...formats, s.format];
    setFormats(next);
    const e = await onSave({ formats: next, base_idea: s.base_idea });
    if (e) setErr(e);
    else {
      setBase(s.base_idea);
      setBaseKey((k) => k + 1);
      setItems((l) => (l ?? []).filter((x) => x !== s));
    }
  };
  return (
    <div className="space-y-4">
      <div className={BOX}>
        <h3 className="text-sm font-semibold">Format — you can mix them</h3>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => (
            <Chip key={f.id} on={formats.includes(f.id)} onClick={() => pick(f.id)} title={f.hint}>
              {f.label}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-muted">{FORMATS.filter((f) => formats.includes(f.id)).map((f) => `${f.label}: ${f.hint}`).join(" · ") || "Pick at least one."}</p>
        <label className={LABEL}>
          Base idea = Topic + Format (one sentence)
          <AutoField key={baseKey} value={base} multiline rows={2} maxLength={2000} label="Base idea" onSave={(v) => onSave({ base_idea: v })} />
        </label>
        <p className="rounded-md bg-subtle px-3 py-2 text-xs text-muted">
          <b>Be remarkable:</b> make it <i>better</i> (title, thumbnail, quality) or <i>different</i> (a mix of formats or an unexpected angle).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={ask} disabled={pending || !aiReady} className={AI_BTN} title={aiReady ? "" : "Connect the AI (GROQ_API_KEY) first"}>
            {pending ? "Thinking…" : "✨ One base idea per format"}
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

export function AngleStep({ video, aiReady, titles, onSave }: { video: YtVideo; aiReady: boolean; titles: number; onSave: Save }) {
  const router = useRouter();
  const [angles, setAngles] = useState<string[]>(video.angles ?? []);
  const [items, setItems] = useState<AngleSuggestion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [notes, setNotes] = useState(video.angle_notes ?? "");
  const [notesKey, setNotesKey] = useState(0);
  const [added, setAdded] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const pick = (id: string) => {
    const next = toggle(angles, id);
    setAngles(next);
    void onSave({ angles: next });
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
    const next = angles.includes(s.angle) ? angles : [...angles, s.angle];
    const label = ANGLES.find((a) => a.id === s.angle)?.label ?? s.angle;
    const nextNotes = `${notes.trim()}${notes.trim() ? "\n" : ""}${label}: ${s.idea}`;
    setAngles(next);
    const e = await onSave({ angles: next, angle_notes: nextNotes });
    if (e) return setErr(e);
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
      <h3 className="text-sm font-semibold">Angle — the specific way in</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {ANGLES.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={angles.includes(a.id)}
            onClick={() => pick(a.id)}
            className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${angles.includes(a.id) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-subtle"}`}
          >
            <span className="block font-semibold">{a.label}</span>
            <span className="text-[11px] opacity-80">{a.example}</span>
          </button>
        ))}
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
