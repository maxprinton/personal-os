"use client";
// Script tab of a video: Outline → Write (one editor per part, Markdown, no text outside parts) → Full script.
// Live words + duration per part and total, research Sources per part, intro assistant, Export to Notes.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import LazyRichEditor from "@/components/editor/LazyRichEditor";
import IntroAssistant from "@/components/youtube/intro/IntroAssistant";
import { saveSectionContent, setSectionCard } from "@/app/youtube-actions/script";
import { INTRO_STATUSES } from "@/lib/youtube/constants";
import { cardSource, displayCode, formatDuration, insertSourceBlock, removeSourceBlock, scriptTotals, sourceBlock } from "@/lib/youtube/outline";
import type { YtCard, YtKind, YtMoment, YtOutlineTemplate, YtSection, YtShot } from "@/lib/youtube/types";
import ExportDialog, { type ExportRow } from "./ExportDialog";
import FullScript from "./FullScript";
import OutlineCreator from "./OutlineCreator";
import OutlineEditor from "./OutlineEditor";
import SourcesPanel from "./SourcesPanel";
import { BTN, Msg } from "./ui";

export type ScriptCard = YtCard & { bucket: string; noteTitle: string | null };
export type PinnedPair = {
  label: string | null;
  primary: boolean;
  title: string | null;
  thumbnail: { concept: string; image: string | null; text: string | null; focal: string | null } | null;
};
export type ScriptShot = Pick<YtShot, "id" | "section_id" | "para_hash" | "kind" | "duration_s" | "position" | "matches_thumbnail" | "description">;
type VideoInfo = { id: string; code: string | null; idea_name: string; kind: YtKind; formats: string[]; outline_template: string | null; locked: boolean };
type View = "outline" | "write" | "full";

const SAVE_DELAY = 1200;

export default function ScriptWorkspace({
  video,
  sections,
  templates,
  cards,
  exports,
  pinned,
  shots,
  moments,
  wpm,
  aiReady,
}: {
  video: VideoInfo;
  sections: YtSection[];
  templates: YtOutlineTemplate[];
  cards: ScriptCard[];
  exports: ExportRow[];
  pinned: PinnedPair;
  shots: ScriptShot[];
  moments: YtMoment[];
  wpm: number;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(video.locked ? "write" : "outline");

  // ----- live text of every part (server copy only seeds it; typing never gets overwritten by a refresh) -----
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(sections.map((s) => [s.id, s.content ?? ""])));
  const latest = useRef(texts);
  useEffect(() => {
    let changed = false;
    const next = { ...latest.current };
    for (const s of sections)
      if (!(s.id in next)) {
        next[s.id] = s.content ?? "";
        changed = true;
      }
    if (changed) {
      latest.current = next;
      setTexts(next);
    }
  }, [sections]);
  const [cardIds, setCardIds] = useState<Record<string, string[]>>(() => Object.fromEntries(sections.map((s) => [s.id, s.card_ids ?? []])));
  useEffect(() => setCardIds(Object.fromEntries(sections.map((s) => [s.id, s.card_ids ?? []]))), [sections]);

  const [activeId, setActiveId] = useState<string | null>(() => (sections.find((s) => s.kind === "body") ?? sections[0])?.id ?? null);
  const active = sections.find((s) => s.id === activeId) ?? sections[0] ?? null;

  // ----- autosave -----
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const introStatusRef = useRef(Object.fromEntries(sections.map((s) => [s.id, s.intro_status])));
  useEffect(() => {
    introStatusRef.current = Object.fromEntries(sections.map((s) => [s.id, s.intro_status]));
  }, [sections]);

  const saveNow = useCallback(
    async (id: string): Promise<boolean> => {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
      setSaveState("saving");
      const r = await saveSectionContent(id, latest.current[id] ?? "");
      if (r.error) {
        setSaveState("error");
        setSaveErr(r.error);
        return false;
      }
      setSaveErr(null);
      setSaveState(Object.keys(timers.current).length ? "saving" : "saved");
      if (r.introStatus && r.introStatus !== introStatusRef.current[id]) router.refresh();
      return true;
    },
    [router],
  );
  const setText = useCallback(
    (id: string, md: string) => {
      latest.current = { ...latest.current, [id]: md };
      setTexts(latest.current);
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => void saveNow(id), SAVE_DELAY);
      setSaveState("saving");
    },
    [saveNow],
  );
  const flushAll = useCallback(async () => {
    const ids = Object.keys(timers.current);
    const ok = await Promise.all(ids.map((id) => saveNow(id)));
    return ok.every(Boolean);
  }, [saveNow]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(timers.current).length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      for (const id of Object.keys(timers.current)) void saveNow(id); // leaving the page: save what's left
    };
  }, [saveNow]);

  const openSection = (id: string) => {
    if (activeId && timers.current[activeId]) void saveNow(activeId);
    setActiveId(id);
    setView("write");
  };

  // ----- Sources -----
  const [cardBusy, startCard] = useTransition();
  const [cardErr, setCardErr] = useState<string | null>(null);
  const toggleCard = (sec: YtSection, card: ScriptCard, on: boolean) => {
    const before = latest.current[sec.id] ?? "";
    const src = cardSource(card, card.noteTitle);
    const md = on ? insertSourceBlock(before, sourceBlock(src)) : removeSourceBlock(before, src.title);
    clearTimeout(timers.current[sec.id]);
    delete timers.current[sec.id];
    latest.current = { ...latest.current, [sec.id]: md };
    setTexts(latest.current);
    const prevIds = cardIds[sec.id] ?? [];
    setCardIds({ ...cardIds, [sec.id]: on ? [...prevIds, card.id] : prevIds.filter((x) => x !== card.id) });
    startCard(async () => {
      setCardErr(null);
      const r = await setSectionCard(sec.id, card.id, on, md);
      if (r.error) {
        setCardErr(r.error);
        setCardIds((c) => ({ ...c, [sec.id]: prevIds }));
      } else router.refresh();
    });
  };

  // ----- totals -----
  const totals = useMemo(() => {
    const t = scriptTotals(sections.map((s) => ({ id: s.id, content: texts[s.id] ?? s.content })), wpm);
    return { map: Object.fromEntries(t.sections.map((r) => [r.id, { words: r.words, seconds: r.seconds }])), words: t.words, seconds: t.seconds };
  }, [sections, texts, wpm]);

  const [exportOpen, setExportOpen] = useState(false);

  if (!sections.length) return <OutlineCreator videoId={video.id} kind={video.kind} formats={video.formats} templates={templates} />;

  const orderOf = (s: YtSection) => (s.kind === "body" ? sections.filter((x) => x.kind === "body").findIndex((x) => x.id === s.id) + 1 : s.kind === "intro" ? 0 : 99);
  const climax = sections.find((s) => s.is_climax) ?? null;
  const intro = sections.find((s) => s.kind === "intro") ?? null;

  const tab = (id: View, label: string, disabled = false, title?: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (activeId && timers.current[activeId]) void saveNow(activeId);
        setView(id);
      }}
      className={`rounded-md px-3 py-1 text-sm disabled:opacity-40 ${view === id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {tab("outline", "Outline")}
          {tab("write", "Write", !video.locked, video.locked ? undefined : "Lock the outline first")}
          {tab("full", "Full script")}
        </div>
        <span className="text-sm tabular-nums text-muted" title={`At ${wpm} words per minute (change it in YouTube Settings)`}>
          {totals.words.toLocaleString()} words · ≈ {formatDuration(totals.seconds)}
        </span>
        <span className="text-xs text-faint" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className={BTN}
          onClick={() => {
            void flushAll();
            setExportOpen(true);
          }}
        >
          Export to Notes{exports.length ? ` (${exports.length})` : ""}
        </button>
      </div>
      <Msg error={saveErr} />

      {view === "outline" && <OutlineEditor videoId={video.id} kind={video.kind} locked={video.locked} sections={sections} totals={totals.map} defaultFormat={video.formats[0] ?? "tutorial"} onWrite={openSection} />}

      {view === "full" && <FullScript sections={sections} texts={texts} totals={totals.map} onEdit={(id) => (video.locked ? openSection(id) : setView("outline"))} />}

      {view === "write" && active && (
        <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Parts" className="space-y-1 lg:sticky lg:top-4 lg:self-start">
            {sections.map((s) => {
              const t = totals.map[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSection(s.id)}
                  aria-current={s.id === active.id ? "true" : undefined}
                  className={`block w-full rounded-md border px-2 py-1.5 text-left text-sm ${s.id === active.id ? "border-accent bg-accent-soft/50" : "border-transparent hover:bg-subtle"}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted">{displayCode(s, orderOf(s))}</span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {s.is_climax && <span className="text-accent">★</span>}
                  </span>
                  <span className="block text-[11px] tabular-nums text-faint">
                    {t?.words ?? 0}w · {formatDuration(t?.seconds ?? 0)}
                    {s.kind === "intro" && ` · ${INTRO_STATUSES.find((x) => x.id === s.intro_status)?.label ?? ""}`}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className={`grid min-w-0 gap-4 ${active.kind === "intro" ? "xl:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
            <div className="min-w-0 space-y-3">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">
                  <span className="font-mono text-sm text-muted">{displayCode(active, orderOf(active))}</span> · {active.title}
                  {active.is_climax && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">★ Climax</span>}
                </h3>
                {active.description && <p className="text-sm text-muted">{active.description}</p>}
                <p className="text-xs tabular-nums text-faint">
                  {totals.map[active.id]?.words ?? 0} words · ≈ {formatDuration(totals.map[active.id]?.seconds ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
                <LazyRichEditor
                  key={active.id}
                  mode="section"
                  value={texts[active.id] ?? ""}
                  onChange={(md) => setText(active.id, md)}
                  onBlur={() => timers.current[active.id] && void saveNow(active.id)}
                  placeholder={active.kind === "intro" ? "Write the intro (it's fine to write it last)…" : "Write this part… Type / for blocks."}
                  minHeight={320}
                  pageTitle={active.title}
                />
              </div>
              <SourcesPanel cards={cards} usedIds={cardIds[active.id] ?? []} busy={cardBusy} onToggle={(c, on) => toggleCard(active, c, on)} />
              <Msg error={cardErr} />
            </div>
            {active.kind === "intro" && intro && (
              <IntroAssistant
                videoId={video.id}
                kind={video.kind}
                intro={intro}
                introMd={texts[intro.id] ?? ""}
                sections={sections.map((s) => ({ id: s.id, title: s.title, kind: s.kind, is_climax: s.is_climax, content: texts[s.id] ?? s.content }))}
                climaxId={climax?.id ?? null}
                pinned={pinned}
                shots={shots}
                moments={moments}
                wpm={wpm}
                aiReady={aiReady}
                onInsert={(text, where) => {
                  const md = latest.current[intro.id] ?? "";
                  setText(intro.id, where === "start" ? `${text}\n\n${md}` : `${md.replace(/\s+$/, "")}\n\n${text}\n`);
                }}
              />
            )}
          </div>
        </div>
      )}

      {exportOpen && <ExportDialog videoId={video.id} exports={exports} beforeExport={flushAll} onClose={() => { setExportOpen(false); router.refresh(); }} />}
    </div>
  );
}
