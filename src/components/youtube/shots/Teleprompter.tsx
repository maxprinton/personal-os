"use client";
// Teleprompter (full screen): large text that scrolls at your speaking speed. Tap the text or press Space
// to pause / play, ↑ ↓ change the speed, mirror for a prompter glass. Whole script, one part, or only the
// lines of one filming setup.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { videoHref } from "@/lib/youtube/constants";
import { countWords, formatDuration } from "@/lib/youtube/outline";
import { PROMPTER_LIMITS, clampFont, clampWpm, prompterBlocks, scrollSpeed, secondsLeft, type PrompterSectionIn } from "@/lib/youtube/prompter";
import type { ShotKind } from "@/lib/youtube/types";
import { groupBySetup } from "./logic";

type PrompterShot = { kind: ShotKind; setup: string | null; location: string | null; para_hash: string | null; done: boolean };
const PREFS_KEY = "yt-prompter-prefs";
const CTRL = "rounded-md border border-white/25 px-2.5 py-1.5 text-sm text-white hover:bg-white/10 disabled:opacity-40";

function readPrefs(): { wpm?: number; font?: number; mirror?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export default function Teleprompter({
  videoId,
  title,
  sections,
  shots,
  defaultWpm,
  initialSection,
  initialSetup,
}: {
  videoId: string;
  title: string;
  sections: PrompterSectionIn[];
  shots: PrompterShot[];
  defaultWpm: number;
  initialSection: string | null;
  initialSetup: string | null;
}) {
  const setups = useMemo(() => groupBySetup(shots.filter((s) => s.para_hash)).map((g) => g.key), [shots]);
  const [source, setSource] = useState<string>(() =>
    initialSetup && setups.includes(initialSetup) ? `setup:${initialSetup}` : initialSection && sections.some((s) => s.id === initialSection) ? `section:${initialSection}` : "all",
  );
  const [wpm, setWpm] = useState(clampWpm(defaultWpm));
  const [font, setFont] = useState(52);
  const [mirror, setMirror] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const p = readPrefs();
    if (p.wpm) setWpm(clampWpm(p.wpm));
    if (p.font) setFont(clampFont(p.font));
    if (typeof p.mirror === "boolean") setMirror(p.mirror);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ wpm, font, mirror }));
    } catch {
      /* private mode: fine */
    }
  }, [wpm, font, mirror]);

  const blocks = useMemo(() => {
    if (source.startsWith("section:")) return prompterBlocks(sections, { sectionId: source.slice(8) });
    if (source.startsWith("setup:")) {
      const key = source.slice(6);
      const g = groupBySetup(shots.filter((s) => s.para_hash)).find((x) => x.key === key);
      return prompterBlocks(sections, { onlyHashes: new Set((g?.shots ?? []).map((s) => s.para_hash!)) });
    }
    return prompterBlocks(sections);
  }, [source, sections, shots]);
  const words = useMemo(() => blocks.reduce((m, b) => m + b.paragraphs.reduce((n, p) => n + countWords(p.text), 0), 0), [blocks]);

  // ----- scrolling -----
  const box = useRef<HTMLDivElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const pos = useRef(0);
  const speedRef = useRef(0);
  useEffect(() => {
    const w = textBox.current?.clientWidth ?? 800;
    speedRef.current = scrollSpeed(wpm, font, w, 1.4);
  }, [wpm, font, blocks]);
  useEffect(() => {
    if (!playing) return;
    const el = box.current;
    if (!el) return;
    pos.current = el.scrollTop;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      pos.current += speedRef.current * dt;
      el.scrollTop = pos.current;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    if (!playing) pos.current = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? el.scrollTop / max : 0);
  };
  const restart = useCallback(() => {
    setPlaying(false);
    if (box.current) box.current.scrollTop = 0;
    pos.current = 0;
  }, []);
  useEffect(() => restart(), [source, restart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setWpm((w) => clampWpm(w + 10));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setWpm((w) => clampWpm(w - 10));
      } else if (e.key === "Home") restart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restart]);

  const left = secondsLeft(Math.round(words * (1 - progress)), wpm);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white">
      <div className={`flex flex-wrap items-center gap-2 border-b border-white/15 bg-black/90 px-3 py-2 text-sm transition-opacity ${playing ? "opacity-30 hover:opacity-100" : ""}`}>
        <Link href={videoHref(videoId, "shots")} className={CTRL} aria-label="Exit the teleprompter">
          ✕
        </Link>
        <button type="button" className={`${CTRL} min-w-20 font-semibold`} onClick={() => setPlaying((p) => !p)} disabled={!words}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button type="button" className={CTRL} onClick={restart} title="Back to the start (Home)">
          ⏮
        </button>
        <label className="flex items-center gap-1.5">
          <span className="text-white/70">Speed</span>
          <button type="button" className={CTRL} onClick={() => setWpm((w) => clampWpm(w - 10))} aria-label="Slower">
            −
          </button>
          <input
            type="range"
            min={PROMPTER_LIMITS.minWpm}
            max={PROMPTER_LIMITS.maxWpm}
            step={5}
            value={wpm}
            onChange={(e) => setWpm(clampWpm(Number(e.target.value)))}
            className="w-24"
            aria-label="Words per minute"
          />
          <button type="button" className={CTRL} onClick={() => setWpm((w) => clampWpm(w + 10))} aria-label="Faster">
            +
          </button>
          <span className="w-16 tabular-nums">{wpm} wpm</span>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-white/70">Size</span>
          <input
            type="range"
            min={PROMPTER_LIMITS.minFont}
            max={PROMPTER_LIMITS.maxFont}
            step={2}
            value={font}
            onChange={(e) => setFont(clampFont(Number(e.target.value)))}
            className="w-20"
            aria-label="Text size"
          />
        </label>
        <button type="button" className={`${CTRL} ${mirror ? "bg-white/20" : ""}`} aria-pressed={mirror} onClick={() => setMirror((m) => !m)}>
          ⇋ Mirror
        </button>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="max-w-[16rem] rounded-md border border-white/25 bg-black px-2 py-1.5 text-sm text-white" aria-label="What to show">
          <option value="all">Whole script</option>
          <optgroup label="One part">
            {sections.map((s) => (
              <option key={s.id} value={`section:${s.id}`}>
                {s.code} · {s.title || "Untitled"}
              </option>
            ))}
          </optgroup>
          {setups.length > 0 && (
            <optgroup label="Lines of one setup">
              {setups.map((k) => (
                <option key={k} value={`setup:${k}`}>
                  📍 {k}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span className="ml-auto truncate text-white/60">
          {title} · {formatDuration(left)} left
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {/* reading line */}
        <div className="pointer-events-none absolute inset-x-0 top-[30%] z-10 h-[1.6em] -translate-y-1/2 border-y border-amber-300/40 bg-amber-300/5" style={{ fontSize: font }} aria-hidden />
        <div ref={box} onScroll={onScroll} onClick={() => words && setPlaying((p) => !p)} className="h-full cursor-pointer overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <div ref={textBox} className="mx-auto max-w-5xl px-6" style={{ transform: mirror ? "scaleX(-1)" : undefined, fontSize: font, lineHeight: 1.4, paddingTop: "30vh", paddingBottom: "70vh" }}>
            {!blocks.length && <p className="text-center text-white/60" style={{ fontSize: 24 }}>Nothing to show here yet — write the script first.</p>}
            {blocks.map((b) => (
              <div key={b.sectionId} className="mb-[1.5em]">
                <p className="mb-[0.6em] font-semibold text-amber-300/80" style={{ fontSize: "0.5em" }}>
                  {b.heading}
                </p>
                {b.paragraphs.map((p, i) => (
                  <p key={`${p.hash}-${i}`} className="mb-[0.8em] font-medium">
                    {p.text}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
        {!playing && words > 0 && progress === 0 && (
          <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-white/50">Tap the text or press Space to start · ↑ ↓ speed</p>
        )}
      </div>
    </div>
  );
}
