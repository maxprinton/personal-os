"use client";

import { useEffect, useMemo, useState } from "react";
import Simulator, { type SendRequest, type ShowRequest } from "@/components/telegram/Simulator";
import WordsEditor from "@/components/telegram/WordsEditor";
import { GROUPS, type Feature } from "@/lib/bot/registry";
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

export default function TelegramModule({ features, menu, initialVocab }: { features: FeatureView[]; menu: string[][]; initialVocab: VocabRow[] }) {
  const [selectedId, setSelectedId] = useState(features[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [vocab, setVocab] = useState(initialVocab);
  const [practiced, setPracticed] = useState<string[]>([]);
  const [request, setRequest] = useState<SendRequest | null>(null);
  const [show, setShow] = useState<ShowRequest | null>(null);
  const [tab, setTab] = useState<"list" | "feature" | "practice">("list");
  const nonce = useMemo(() => ({ n: 0 }), []);

  useEffect(() => {
    setPracticed(read());
  }, []);
  const markPracticed = (id: string, on = true) =>
    setPracticed((cur) => {
      const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
      try {
        localStorage.setItem(PRACTICED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

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
        </aside>

        {/* How it works */}
        <section className={`${tab === "feature" ? "" : "hidden"} min-w-0 lg:block`}>
          {feature && (
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
          <Simulator menu={menu} request={request} show={show} />
        </div>
      </div>
    </div>
  );
}
