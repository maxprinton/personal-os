"use client";
// Settings → Writing: spelling, prediction and the AI on/off (per language and area), your dictionary,
// teaching it words (review your notes / paste a text), what the prediction learned, your voice profile.
import { useEffect, useMemo, useState } from "react";
import {
  addGlossaryWords,
  allNotesText,
  buildVoiceProfile,
  clearVoiceProfile,
  forgetPredictions,
  loadWritingWords,
  removeGlossaryWord,
  saveWritingSettings,
  trainFromNotes,
} from "@/app/writing-actions";
import { setWritingSettings, setKnownWords, knownWords, unknownWordsIn } from "@/lib/writing/client";
import { AI_DAILY_CAP, WRITING_AREAS, type WritingArea, type WritingSettings as WS } from "@/lib/writing/settings";

const btn = "rounded-md border border-edge px-3 py-1.5 text-sm transition-colors hover:bg-subtle disabled:opacity-50";
const input = "w-full rounded-md border border-line-strong bg-transparent px-3 py-1.5 text-sm";

function Toggle({ on, label, hint, onChange }: { on: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1 text-sm">
      <input type="checkbox" className="mt-1" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export default function WritingSettings() {
  const [s, setS] = useState<WS | null>(null);
  const [glossary, setGlossary] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [newWord, setNewWord] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<{ words: [string, number][]; picked: Set<string>; from: string } | null>(null);
  const [paste, setPaste] = useState("");

  const load = async () => {
    const r = await loadWritingWords();
    if (!r.ok) return setErr(r.error);
    setS(r.settings ?? {});
    setGlossary(r.glossary);
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async (patch: Partial<WS>) => {
    if (!s) return;
    const optimistic = { ...s, ...patch, areas: { ...(s.areas ?? {}), ...(patch.areas ?? {}) } };
    setS(optimistic);
    setWritingSettings(optimistic);
    const r = await saveWritingSettings(patch as Record<string, unknown>);
    if (!r.ok) {
      setErr(r.error);
      setS(s);
      setWritingSettings(s);
    } else setErr(null);
  };
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setMsg(null);
    setErr(null);
    try {
      const m = await fn();
      if (m) setMsg(m);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something failed.");
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => glossary.filter((w) => w.toLowerCase().includes(q.trim().toLowerCase())), [glossary, q]);
  if (!s) return <p className="text-sm text-muted">{err ?? "Loading…"}</p>;
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const used = s.aiDay === today ? s.aiCount ?? 0 : 0;
  const areaOn = (a: WritingArea) => s.areas?.[a] !== false;

  const addWords = async (words: string[]) => {
    const r = await addGlossaryWords(words);
    if (!r.ok) throw new Error(r.error);
    setGlossary((g) => [...new Set([...g, ...words])].sort((a, b) => a.localeCompare(b)));
    setKnownWords([...knownWords(), ...words]);
    return r.added ? `Added ${r.added} ${r.added === 1 ? "word" : "words"} to your dictionary.` : "Those words were already there.";
  };
  const findUnknown = async (text: string, from: string) => {
    const list = await unknownWordsIn(text);
    setReview({ words: list, picked: new Set(), from });
    return list.length ? undefined : "No unknown words found.";
  };

  return (
    <div className="space-y-5">
      {err && <p className="text-sm text-danger">{err}</p>}
      {msg && <p className="text-sm text-success">{msg}</p>}

      <div className="grid gap-x-6 sm:grid-cols-2">
        <div>
          <Toggle on={s.spell !== false} label="Spelling and rules" hint="Wavy underline while you write" onChange={(v) => void save({ spell: v })} />
          <Toggle on={s.predict !== false} label="Next-word prediction" hint="Gray word after the cursor · Tab or tap adds it" onChange={(v) => void save({ predict: v })} />
          <Toggle on={s.ai !== false} label="AI checks on its own" hint={`Grave problems and non-native English · ${used} of ${AI_DAILY_CAP} today`} onChange={(v) => void save({ ai: v })} />
        </div>
        <div>
          <Toggle on={s.es !== false} label="Spanish (Mexico)" onChange={(v) => void save({ es: v })} />
          <Toggle on={s.en !== false} label="English (US)" onChange={(v) => void save({ en: v })} />
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Where</p>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {WRITING_AREAS.map((a) => (
            <Toggle key={a.id} on={areaOn(a.id)} label={a.label} onChange={(v) => void save({ areas: { [a.id]: v } })} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Your dictionary · {glossary.length} words</p>
        <p className="text-xs text-muted">Never marked as mistakes. Names of your notes, blocks and tags are accepted on their own.</p>
        <div className="flex gap-2">
          <input className={input} value={newWord} onChange={(e) => setNewWord(e.target.value)} placeholder="Add a word…" />
          <button
            className={btn}
            disabled={!newWord.trim() || busy === "add"}
            onClick={() =>
              void run("add", async () => {
                const m = await addWords([newWord.trim()]);
                setNewWord("");
                return m;
              })
            }
          >
            Add
          </button>
        </div>
        {glossary.length > 8 && <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your dictionary…" />}
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {shown.map((w) => (
            <span key={w} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
              {w}
              <button
                className="text-faint hover:text-danger"
                aria-label={`Remove ${w}`}
                onClick={() =>
                  void run("rm", async () => {
                    const r = await removeGlossaryWord(w);
                    if (!r.ok) throw new Error(r.error);
                    setGlossary((g) => g.filter((x) => x !== w));
                    setKnownWords(knownWords().filter((x) => x !== w.toLowerCase()));
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
          {!glossary.length && <span className="text-xs text-faint">Empty. Use “Add to dictionary” on an underlined word, or the buttons below.</span>}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Teach it words</p>
        <p className="text-xs text-muted">
          Finds the words the dictionaries don&apos;t know. Tick the correct ones (names, slang, your Spanglish) and leave the typos out. It also asks by itself when you write the same unknown word on 3 different days.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              void run("review", async () => {
                const r = await allNotesText();
                if (!r.ok) throw new Error(r.error);
                return findUnknown(r.text, `your ${r.notes} notes`);
              })
            }
          >
            {busy === "review" ? "Reading your notes…" : "Review my notes"}
          </button>
        </div>
        <textarea className={`${input} min-h-[72px]`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Or paste a text (a document, a chat, an email of yours)…" />
        <button className={btn} disabled={!paste.trim() || !!busy} onClick={() => void run("paste", () => findUnknown(paste, "the text"))}>
          {busy === "paste" ? "Reading…" : "Find unknown words in this text"}
        </button>
        {review && (
          <div className="space-y-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {review.words.length} unknown {review.words.length === 1 ? "word" : "words"} in {review.from}
              </span>
              <span className="flex gap-2">
                <button className="text-xs text-muted underline" onClick={() => setReview({ ...review, picked: new Set(review.words.map((w) => w[0])) })}>
                  Tick all
                </button>
                <button className="text-xs text-muted underline" onClick={() => setReview(null)}>
                  Close
                </button>
              </span>
            </div>
            <div className="grid max-h-64 grid-cols-2 gap-x-4 overflow-y-auto sm:grid-cols-3">
              {review.words.map(([w, n]) => (
                <label key={w} className="flex items-center gap-2 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={review.picked.has(w)}
                    onChange={(e) => {
                      const picked = new Set(review.picked);
                      if (e.target.checked) picked.add(w);
                      else picked.delete(w);
                      setReview({ ...review, picked });
                    }}
                  />
                  <span className="truncate">{w}</span>
                  <span className="text-xs text-faint">{n}</span>
                </label>
              ))}
            </div>
            <button
              className={btn}
              disabled={!review.picked.size || !!busy}
              onClick={() =>
                void run("addMany", async () => {
                  const m = await addWords([...review.picked]);
                  setReview(null);
                  return m;
                })
              }
            >
              Add {review.picked.size || ""} to my dictionary
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Prediction</p>
        <p className="text-xs text-muted">It learns which word you write after which, only from what you write. It learned from all your notes the first time.</p>
        <div className="flex flex-wrap gap-2">
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              void run("train", async () => {
                const f = await forgetPredictions();
                if (!f.ok) throw new Error(f.error);
                const r = await trainFromNotes();
                if (!r.ok) throw new Error(r.error);
                return `Learned again from ${r.notes} notes. Reload the page to use it.`;
              })
            }
          >
            {busy === "train" ? "Learning…" : "Learn again from my notes"}
          </button>
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              void run("forget", async () => {
                if (!window.confirm("Forget everything the prediction learned?")) return;
                const r = await forgetPredictions();
                if (!r.ok) throw new Error(r.error);
                return "Forgotten. It starts learning again as you write.";
              })
            }
          >
            Forget what it learned
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Your voice</p>
        <p className="text-xs text-muted">The AI reads your 8 longest notes of the last months once and sums up how you write, so its suggestions keep your style.</p>
        {s.voice ? <pre className="whitespace-pre-wrap rounded-md bg-subtle p-3 text-xs">{s.voice}</pre> : <p className="text-xs text-faint">Not created yet.</p>}
        <div className="flex flex-wrap gap-2">
          <button
            className={btn}
            disabled={!!busy}
            onClick={() =>
              void run("voice", async () => {
                const r = await buildVoiceProfile();
                if (!r.ok) throw new Error(r.error);
                setS({ ...s, voice: r.voice });
                setWritingSettings({ ...s, voice: r.voice });
                return "Voice profile saved.";
              })
            }
          >
            {busy === "voice" ? "Reading your notes…" : s.voice ? "Update from my notes" : "Create from my notes"}
          </button>
          {s.voice && (
            <button
              className={btn}
              disabled={!!busy}
              onClick={() =>
                void run("voiceRm", async () => {
                  const r = await clearVoiceProfile();
                  if (!r.ok) throw new Error(r.error);
                  setS({ ...s, voice: null });
                })
              }
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
