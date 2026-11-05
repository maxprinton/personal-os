"use client";
// Intro tab of Filming mode: write (or dictate) the intro right after filming, with the intro assistant
// and the moments you just logged. Same editor and same assistant as the Script tab.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import LazyRichEditor from "@/components/editor/LazyRichEditor";
import { saveSectionContent } from "@/app/youtube-actions/script";
import { INTRO_STATUSES } from "@/lib/youtube/constants";
import type { YtKind, YtMoment, YtSection } from "@/lib/youtube/types";
import type { PinnedPair, ScriptShot } from "@/components/youtube/script/ScriptWorkspace";
import { BTN, Msg } from "@/components/youtube/script/ui";
import IntroAssistant from "./IntroAssistant";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
};
function makeRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

const SAVE_DELAY = 1200;

export default function IntroFilmTab({
  videoId,
  kind,
  sections,
  pinned,
  shots,
  moments,
  wpm,
  aiReady,
}: {
  videoId: string;
  kind: YtKind;
  sections: YtSection[];
  pinned: PinnedPair;
  shots: ScriptShot[];
  moments: YtMoment[];
  wpm: number;
  aiReady: boolean;
}) {
  const router = useRouter();
  const intro = sections.find((s) => s.kind === "intro") ?? null;
  const [md, setMd] = useState(intro?.content ?? "");
  const [rev, setRev] = useState(0); // remount the editor when text is inserted from outside (dictation, ✨ ideas)
  const latest = useRef(md);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const saveNow = useCallback(async () => {
    if (!intro) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState("saving");
    const r = await saveSectionContent(intro.id, latest.current);
    if (r.error) {
      setState("error");
      setErr(r.error);
      return;
    }
    setErr(null);
    setState("saved");
    if (r.introStatus && r.introStatus !== intro.intro_status) router.refresh();
  }, [intro, router]);
  const change = useCallback(
    (text: string) => {
      latest.current = text;
      setMd(text);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveNow(), SAVE_DELAY);
      setState("saving");
    },
    [saveNow],
  );
  useEffect(
    () => () => {
      if (timer.current) void saveNow();
    },
    [saveNow],
  );
  const insert = (text: string, where: "start" | "end") => {
    const cur = latest.current;
    change(where === "start" ? `${text}\n\n${cur}` : `${cur.replace(/\s+$/, "")}${cur.trim() ? "\n\n" : ""}${text}\n`);
    setRev((r) => r + 1);
  };

  // ----- dictation (browser speech recognition; works in Chrome / Edge / Android) -----
  const rec = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [canDictate, setCanDictate] = useState(false);
  const [lang, setLang] = useState("en-US");
  useEffect(() => setCanDictate(!!makeRecognition()), []);
  const dictate = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = makeRecognition();
    if (!r) return;
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += e.results[i][0].transcript;
      if (said.trim()) insert(said.trim(), "end");
    };
    r.onerror = (e) => setErr(e.error === "not-allowed" ? "The browser blocked the microphone. Allow it and try again." : "Dictation stopped. Try again.");
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  if (!intro) return <p className="text-sm text-muted">This video has no intro part yet (make the outline in the Script tab).</p>;
  const climax = sections.find((s) => s.is_climax) ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          Intro status: <b>{INTRO_STATUSES.find((x) => x.id === intro.intro_status)?.label ?? intro.intro_status}</b>
        </span>
        {canDictate && (
          <>
            <button type="button" className={BTN} onClick={dictate} aria-pressed={listening}>
              {listening ? "■ Stop dictation" : "🎙 Dictate"}
            </button>
            <select className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Dictation language" disabled={listening}>
              <option value="en-US">English</option>
              <option value="es-ES">Español</option>
            </select>
          </>
        )}
        <span className="ml-auto text-xs text-muted">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : ""}</span>
      </div>
      <Msg error={err} />
      <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
        <LazyRichEditor key={rev} mode="section" value={md} onChange={change} onBlur={() => timer.current && void saveNow()} placeholder="Write the intro now that you know what happened…" minHeight={220} pageTitle="Intro" />
      </div>
      <IntroAssistant
        videoId={videoId}
        kind={kind}
        intro={intro}
        introMd={md}
        sections={sections.map((s) => ({ id: s.id, title: s.title, kind: s.kind, is_climax: s.is_climax, content: s.id === intro.id ? md : s.content }))}
        climaxId={climax?.id ?? null}
        pinned={pinned}
        shots={shots}
        moments={moments}
        wpm={wpm}
        aiReady={aiReady}
        onInsert={insert}
      />
    </div>
  );
}
