"use client";
// Subtitles from the final script (Worker C): EN text built from the sections (no sources, no cues), ✨ ES
// translation, review + edit (required), then captions.insert on the linked video. YouTube times the text
// against the audio by itself. Warns about improvised parts.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aiTranslateCaptions, buildCaptionsFromScript, pushCaptions, saveCaption } from "@/app/youtube-actions/publish";
import { captionWarnings, captionWords } from "@/lib/youtube/publish-rules";
import type { CaptionTrack } from "@/lib/youtube/types";
import { AI_BTN, BOX, BTN, BTN_SM, INPUT, Msg, PRIMARY } from "@/components/youtube/script/ui";
import CopyButton from "@/components/youtube/publish/CopyButton";

type Props = {
  videoId: string;
  linked: boolean;
  connected: boolean;
  aiReady: boolean;
  captions: Record<string, CaptionTrack>;
  /** what the script gives right now (to show "the script changed") */
  scriptText: string;
  wpm: number;
  cutSeconds: number | null;
};
const LANGS = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
] as const;

export default function CaptionsPanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"en" | "es">("en");
  const [text, setText] = useState<Record<string, string>>({ en: p.captions.en?.text ?? "", es: p.captions.es?.text ?? "" });
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({ en: !!p.captions.en?.reviewed, es: !!p.captions.es?.reviewed });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ error?: string | null; info?: string | null }>({});
  const t = text[tab] ?? "";
  const saved = p.captions[tab];
  const warnings = captionWarnings({ text: text.en ?? "", wpm: p.wpm, cutSeconds: p.cutSeconds });
  const scriptChanged = !!p.captions.en?.text && !!p.scriptText && p.captions.en.text.trim() !== p.scriptText.trim() && !dirty.en;

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setMsg({});
      await fn();
    });
  const build = () =>
    run(async () => {
      if (text.en.trim() && !confirm("Replace the English captions with the text from the script? Your edits to them are lost.")) return;
      const r = await buildCaptionsFromScript(p.videoId);
      if (r.error || r.text === undefined) return setMsg({ error: r.error ?? "No text." });
      setText((o) => ({ ...o, en: r.text! }));
      setReviewed((o) => ({ ...o, en: false }));
      setDirty((o) => ({ ...o, en: false }));
      setTab("en");
      setMsg({ info: "English captions made from the script. Read them and fix what you said differently." });
      router.refresh();
    });
  const translate = () =>
    run(async () => {
      if (dirty.en) {
        const s = await saveCaption(p.videoId, "en", text.en, reviewed.en);
        if (s.error) return setMsg({ error: s.error });
        setDirty((o) => ({ ...o, en: false }));
      }
      if (text.es.trim() && !confirm("Replace the Spanish captions with a new ✨ translation?")) return;
      const r = await aiTranslateCaptions(p.videoId, "es");
      if (r.error || r.text === undefined) return setMsg({ error: r.error ?? "No answer." });
      setText((o) => ({ ...o, es: r.text! }));
      setReviewed((o) => ({ ...o, es: false }));
      setDirty((o) => ({ ...o, es: false }));
      setTab("es");
      setMsg({ info: `✨ Spanish draft ready — review it.${r.usage ? ` ${r.usage}` : ""}` });
      router.refresh();
    });
  const save = (rev = reviewed[tab]) =>
    run(async () => {
      const r = await saveCaption(p.videoId, tab, t, rev);
      if (r.error) return setMsg({ error: r.error });
      setDirty((o) => ({ ...o, [tab]: false }));
      setMsg({ info: "Saved." });
      router.refresh();
    });
  const send = () =>
    run(async () => {
      if (dirty[tab] || reviewed[tab] !== !!saved?.reviewed) {
        const s = await saveCaption(p.videoId, tab, t, reviewed[tab]);
        if (s.error) return setMsg({ error: s.error });
        setDirty((o) => ({ ...o, [tab]: false }));
      }
      const r = await pushCaptions(p.videoId, tab);
      if (r.error) return setMsg({ error: r.error });
      setMsg({ info: `${tab.toUpperCase()} captions sent ✓ — YouTube needs a few minutes to time them.` });
      router.refresh();
    });

  return (
    <section className={BOX}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          <span className="mr-1.5 rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-muted">10</span>
          Subtitles from the script
        </h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} disabled={pending} onClick={build}>
            {text.en.trim() ? "↻ Remake EN from script" : "Make EN from script"}
          </button>
          {p.aiReady && (
            <button type="button" className={AI_BTN} disabled={pending || !text.en.trim()} onClick={translate}>
              ✨ Translate to Spanish
            </button>
          )}
        </div>
      </div>
      {text.en.trim() && warnings.map((w) => <p key={w} className="text-xs text-warning">! {w}</p>)}
      {scriptChanged && <p className="text-xs text-muted">The script changed since these captions were made — remake them if you want the new text.</p>}
      <div className="flex gap-1" role="tablist">
        {LANGS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={tab === l.id}
            onClick={() => setTab(l.id)}
            className={`rounded-md px-2.5 py-1 text-sm ${tab === l.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle"}`}
          >
            {l.label}
            {p.captions[l.id]?.pushed_at ? " ✓" : ""}
          </button>
        ))}
      </div>
      <textarea
        className={`${INPUT} font-mono text-xs leading-relaxed`}
        rows={14}
        value={t}
        placeholder={tab === "en" ? "Click “Make EN from script”." : "Translate with ✨ or paste the Spanish text."}
        onChange={(e) => {
          setText((o) => ({ ...o, [tab]: e.target.value }));
          setDirty((o) => ({ ...o, [tab]: true }));
          setReviewed((o) => ({ ...o, [tab]: false }));
        }}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs text-faint">{captionWords(t)} words</span>
        <CopyButton text={t} />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={!!reviewed[tab]}
            disabled={!t.trim()}
            onChange={(e) => {
              setReviewed((o) => ({ ...o, [tab]: e.target.checked }));
              setDirty((o) => ({ ...o, [tab]: true }));
            }}
          />
          I reviewed them (read once, fixed improvised parts)
        </label>
        <button type="button" className={BTN_SM} disabled={pending || !dirty[tab]} onClick={() => save()}>
          Save
        </button>
        <span className="flex-1" />
        {saved?.pushed_at && <span className="text-xs text-success">Sent {new Date(saved.pushed_at).toLocaleString()}</span>}
        <button
          type="button"
          className={PRIMARY}
          disabled={pending || !t.trim() || !reviewed[tab] || !p.linked || !p.connected}
          title={!p.linked ? "Link the YouTube video first" : !p.connected ? "Connect Google in Settings" : !reviewed[tab] ? "Review them first" : undefined}
          onClick={send}
        >
          {saved?.track_id ? "Update on YouTube" : "Send to YouTube"}
        </button>
      </div>
      {(!p.linked || !p.connected) && (
        <p className="text-xs text-muted">
          {!p.linked ? "Link the uploaded video (step 1) to send them. " : ""}
          {!p.connected ? "Without Google connected: Copy the text → Studio → Subtitles → Add → Upload file / Auto-sync → paste." : ""}
        </p>
      )}
      <Msg error={msg.error} info={msg.info} />
    </section>
  );
}
