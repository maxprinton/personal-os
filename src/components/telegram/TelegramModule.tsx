"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Simulator, { type SendRequest, type ShowRequest } from "@/components/telegram/Simulator";
import WordsEditor from "@/components/telegram/WordsEditor";
import { GROUPS, type Feature } from "@/lib/bot/registry";
import { LESSONS, stepPassed, type StepInfo } from "@/lib/bot/lessons";
import type { VocabRow } from "@/lib/bot/vocab";

/** A feature as the page receives it: the registry entry plus its live words. */
export type FeatureView = Feature & { base: string[]; editable: boolean };

const PRACTICED_KEY = "telegram-practiced";
const read = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PRACTICED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const LESSONS_KEY = "telegram-lessons";
const readLessons = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(LESSONS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export default function TelegramModule({ features, menu, initialVocab }: { features: FeatureView[]; menu: string[][]; initialVocab: VocabRow[] }) {
  const [selectedId, setSelectedId] = useState(features[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [vocab, setVocab] = useState(initialVocab);
  const [practiced, setPracticed] = useState<string[]>([]);
  const [request, setRequest] = useState<SendRequest | null>(null);
  const [show, setShow] = useState<ShowRequest | null>(null);
  const [tab, setTab] = useState<"list" | "feature" | "practice">("list");
  const nonce = useMemo(() => ({ n: 0 }), []);
  // Guided lessons
  const [mode, setMode] = useState<"features" | "lessons">("features");
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [passedNow, setPassedNow] = useState(false);
  const [hint, setHint] = useState(false);
  const [lessonsDone, setLessonsDone] = useState<string[]>([]);
  const [resetSignal, setResetSignal] = useState(0);
  const live = useRef({ lessonId, stepIdx });
  live.current = { lessonId, stepIdx };

  useEffect(() => {
    setPracticed(read());
    setLessonsDone(readLessons());
  }, []);
  const markPracticed = (id: string, on = true) =>
    setPracticed((cur) => {
      const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
      try {
        localStorage.setItem(PRACTICED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  const lesson = LESSONS.find((l) => l.id === lessonId) ?? null;
  const step = lesson ? lesson.steps[stepIdx] : null;
  const finished = Boolean(lesson) && stepIdx >= (lesson?.steps.length ?? 0);

  const saveLessonDone = useCallback((id: string) => {
    setLessonsDone((cur) => {
      if (cur.includes(id)) return cur;
      const next = [...cur, id];
      try {
        localStorage.setItem(LESSONS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  const advance = useCallback(() => {
    const { lessonId: id, stepIdx: i } = live.current;
    const l = LESSONS.find((x) => x.id === id);
    if (!l) return;
    setPassedNow(false);
    setHint(false);
    setStepIdx(i + 1);
    if (i + 1 >= l.steps.length) saveLessonDone(l.id);
  }, [saveLessonDone]);
  // The chat reports each thing you do; when it is what the step asked for, the step is done
  const onStep = useCallback(
    (info: StepInfo) => {
      const { lessonId: id, stepIdx: i } = live.current;
      const l = LESSONS.find((x) => x.id === id);
      const st = l?.steps[i];
      if (!l || !st || !stepPassed(st.expect, info)) return;
      setPassedNow(true);
      setTimeout(() => {
        if (live.current.lessonId === l.id && live.current.stepIdx === i) advance();
      }, 900);
    },
    [advance],
  );
  const startLesson = (id: string) => {
    setLessonId(id);
    setStepIdx(0);
    setPassedNow(false);
    setHint(false);
    setResetSignal((n) => n + 1);
    setTab("feature");
  };
  const nextLesson = lesson ? LESSONS[(LESSONS.findIndex((l) => l.id === lesson.id) + 1) % LESSONS.length] : null;

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => features.filter((f) => !q || [f.title, f.summary, ...f.base, ...f.examples.map((e) => e.text)].join(" ").toLowerCase().includes(q)),
    [features, q],
  );
  const order = useMemo(() => GROUPS.flatMap((g) => visible.filter((f) => f.group === g.id)), [visible]);
  const feature = features.find((f) => f.id === selectedId) ?? features[0];
  const nextOne = feature ? order[(order.findIndex((f) => f.id === feature.id) + 1) % Math.max(order.length, 1)] : undefined;

  const pick = (id: string) => {
    setSelectedId(id);
    setTab("feature");
  };
  const tryIt = (text: string) => {
    setRequest({ text, nonce: ++nonce.n });
    setTab("practice");
  };
  const showDemo = (f: Feature) => {
    if (!f.demo) return;
    setShow({ lines: [{ from: "me", text: f.demo.input }, { from: "bot", text: f.demo.reply }], nonce: ++nonce.n });
    setTab("practice");
  };
  const totalTrackable = features.filter((f) => f.examples.length || f.demo).length;
  const done = practiced.filter((id) => features.some((f) => f.id === id)).length;

  const tabBtn = (id: typeof tab, label: string) => (
    <button type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${tab === id ? "bg-accent text-accent-fg" : "text-muted hover:bg-subtle"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full border border-line bg-surface p-1 lg:hidden">
        {tabBtn("list", "Features")}
        {tabBtn("feature", "How it works")}
        {tabBtn("practice", "Practice")}
      </div>

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)_370px]">
        {/* Library */}
        <aside className={`${tab === "list" ? "" : "hidden"} space-y-3 lg:block lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1`}>
          <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
            {(["features", "lessons"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={`flex-1 rounded-full px-3 py-1 text-sm font-medium transition-colors ${mode === m ? "bg-accent text-accent-fg" : "text-muted hover:bg-subtle"}`}>
                {m === "features" ? "Features" : `Lessons ${lessonsDone.filter((id) => LESSONS.some((l) => l.id === id)).length}/${LESSONS.length}`}
              </button>
            ))}
          </div>
          {mode === "lessons" && (
            <ul className="space-y-0.5">
              {LESSONS.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => startLesson(l.id)} aria-current={l.id === lessonId} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${l.id === lessonId ? "bg-accent-soft font-medium text-accent" : "hover:bg-subtle"}`}>
                    <span className="min-w-0 flex-1 truncate">{l.title}</span>
                    {lessonsDone.includes(l.id) && <span title="Done" className="text-success">✓</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mode === "features" && (
            <>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search features or commands" aria-label="Search features" className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
          <p className="text-xs text-faint">{done} of {totalTrackable} practiced</p>
          {GROUPS.map((g) => {
            const items = visible.filter((f) => f.group === g.id);
            if (!items.length) return null;
            return (
              <section key={g.id}>
                <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-faint">{g.label}</h2>
                <ul className="mt-1 space-y-0.5">
                  {items.map((f) => (
                    <li key={f.id}>
                      <button type="button" onClick={() => pick(f.id)} aria-current={f.id === feature?.id} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${f.id === feature?.id ? "bg-accent-soft font-medium text-accent" : "hover:bg-subtle"}`}>
                        <span className="min-w-0 flex-1 truncate">{f.title}</span>
                        {f.locked && <span title="Money or system: protected" className="text-[11px]">🔒</span>}
                        {practiced.includes(f.id) && <span title="Practiced" className="text-success">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {!visible.length && <p className="px-1 text-sm text-muted">Nothing matches “{query}”.</p>}
            </>
          )}
        </aside>

        {/* How it works */}
        <section className={`${tab === "feature" ? "" : "hidden"} min-w-0 lg:block`}>
          {mode === "lessons" && (
            <article className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
              {!lesson ? (
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold tracking-tight">Guided lessons</h2>
                  <p className="text-sm text-muted">Short lessons with a few steps each. You do each step in the practice chat and it tells you when you got it. Nothing is saved. Pick a lesson on the left.</p>
                </div>
              ) : finished ? (
                <div className="space-y-3">
                  <h2 className="text-xl font-semibold tracking-tight">✓ {lesson.title}: done</h2>
                  <p className="text-sm text-muted">You can now: {lesson.goal.toLowerCase()}</p>
                  <div className="flex flex-wrap gap-2">
                    {nextLesson && nextLesson.id !== lesson.id && <button type="button" onClick={() => startLesson(nextLesson.id)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover">Next lesson: {nextLesson.title} →</button>}
                    <button type="button" onClick={() => startLesson(lesson.id)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">Do it again</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <header className="space-y-1">
                    <h2 className="text-xl font-semibold tracking-tight">{lesson.title}</h2>
                    <p className="text-sm text-muted">{lesson.goal}</p>
                    <div className="flex gap-1 pt-1" aria-label={`Step ${stepIdx + 1} of ${lesson.steps.length}`}>
                      {lesson.steps.map((_, i) => (
                        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < stepIdx ? "bg-success" : i === stepIdx ? "bg-accent" : "bg-subtle-2"}`} />
                      ))}
                    </div>
                  </header>
                  {step && (
                    <div className={`space-y-3 rounded-xl border p-4 ${passedNow ? "border-success bg-success-soft" : "border-line bg-subtle"}`}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-faint">Step {stepIdx + 1} of {lesson.steps.length}</p>
                      <p className="text-base font-medium">{passedNow ? "✓ Done!" : step.say}</p>
                      {!passedNow && step.try && <code className="block whitespace-pre-wrap break-words rounded-lg bg-surface px-2.5 py-1.5 text-sm">{step.try}</code>}
                      {!passedNow && hint && step.hint && <p className="text-sm text-muted">💡 {step.hint}</p>}
                      {!passedNow && (
                        <div className="flex flex-wrap gap-2">
                          {step.try && <button type="button" onClick={() => tryIt(step.try!)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover">Type it for me</button>}
                          {step.hint && !hint && <button type="button" onClick={() => setHint(true)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-fg">Hint</button>}
                          <button type="button" onClick={advance} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-fg">Skip</button>
                        </div>
                      )}
                    </div>
                  )}
                  <button type="button" onClick={() => { setLessonId(null); }} className="text-xs text-faint hover:text-fg">← All lessons</button>
                </div>
              )}
            </article>
          )}
          {mode === "features" && feature && (
            <article className="space-y-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <header className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight">{feature.title}</h2>
                  {feature.locked && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">🔒 protected</span>}
                  {feature.ai && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">✨ uses the AI</span>}
                </div>
                <p className="text-sm text-muted">{feature.summary}</p>
              </header>

              {feature.how.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold">How it works</h3>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted">
                    {feature.how.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}

              {feature.editable && (
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold">Command words</h3>
                  <WordsEditor featureId={feature.id} base={feature.base} locked={Boolean(feature.locked)} vocab={vocab} onVocab={setVocab} />
                </div>
              )}

              <div>
                <h3 className="mb-1.5 text-sm font-semibold">Practice</h3>
                {feature.examples.length > 0 && (
                  <ul className="space-y-1.5">
                    {feature.examples.map((e) => (
                      <li key={e.text} className="flex items-start gap-2">
                        <code className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-lg bg-subtle px-2.5 py-1.5 text-sm">{e.text}</code>
                        <button type="button" onClick={() => tryIt(e.text)} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover">Try it</button>
                        {e.note && <span className="hidden max-w-[10rem] text-xs text-faint xl:block">{e.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {feature.demo && (
                  <button type="button" onClick={() => showDemo(feature)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">Show an example</button>
                )}
                {!feature.examples.length && !feature.demo && <p className="text-sm text-muted">Nothing to type here: this one happens by itself. Use the chat to try anything else.</p>}
                <p className="mt-2 text-xs text-faint">Or type anything in the chat. Your real data is only read; nothing is saved.</p>
              </div>

              <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <button type="button" onClick={() => markPracticed(feature.id, !practiced.includes(feature.id))} className={`rounded-lg border px-3 py-1.5 text-sm ${practiced.includes(feature.id) ? "border-success text-success" : "border-line text-muted hover:bg-subtle"}`}>
                  {practiced.includes(feature.id) ? "✓ Practiced" : "Mark as practiced"}
                </button>
                {nextOne && nextOne.id !== feature.id && (
                  <button type="button" onClick={() => pick(nextOne.id)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">Next: {nextOne.title} →</button>
                )}
              </footer>
            </article>
          )}
        </section>

        {/* Practice chat */}
        <div className={`${tab === "practice" ? "" : "hidden"} lg:block lg:sticky lg:top-4 lg:self-start`}>
          <Simulator menu={menu} request={request} show={show} resetSignal={resetSignal} onStep={onStep} />
        </div>
      </div>
    </div>
  );
}
