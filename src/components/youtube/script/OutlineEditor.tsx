"use client";
// Outline: Intro (S00) fixed at the top, Closing (S99) fixed at the bottom, body parts in between
// (add, rename, describe, drag or ↑↓ to reorder, delete), exactly one climax (long videos), lock = fixed numbers.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addSection, deleteSection, lockOutline, reorderSections, saveOutlineTemplate, setClimax, updateSectionMeta } from "@/app/youtube-actions/script";
import { FORMATS, INTRO_STATUSES } from "@/lib/youtube/constants";
import { displayCode, formatDuration, moveItem, validateOutline } from "@/lib/youtube/outline";
import type { YtKind, YtSection } from "@/lib/youtube/types";
import { BlurField, BOX, BTN, BTN_SM, INPUT, Msg, PRIMARY } from "./ui";

type Props = {
  videoId: string;
  kind: YtKind;
  locked: boolean;
  sections: YtSection[];
  /** live words / seconds per section id */
  totals: Record<string, { words: number; seconds: number }>;
  defaultFormat: string;
  onWrite: (sectionId: string) => void;
};

export default function OutlineEditor({ videoId, kind, locked, sections, totals, defaultFormat, onWrite }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const intro = sections.find((s) => s.kind === "intro");
  const closing = sections.find((s) => s.kind === "closing");
  const [body, setBody] = useState(() => sections.filter((s) => s.kind === "body"));
  useEffect(() => setBody(sections.filter((s) => s.kind === "body")), [sections]);
  const [drag, setDrag] = useState<number | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplFormat, setTplFormat] = useState(defaultFormat || "tutorial");
  const check = validateOutline(sections, kind);
  const isShort = kind === "short";

  const run = (fn: () => Promise<{ error?: string; info?: string } | undefined | void>) =>
    start(async () => {
      setErr(null);
      setInfo(null);
      const r = await fn();
      if (r?.error) setErr(r.error);
      else {
        if (r?.info) setInfo(r.info);
        router.refresh();
      }
    });

  const saveMeta = async (id: string, patch: Parameters<typeof updateSectionMeta>[1]) => {
    const r = await updateSectionMeta(id, patch);
    if (!r.error) router.refresh();
    return r.error ?? null;
  };

  const reorder = (next: YtSection[]) => {
    setBody(next);
    run(() => reorderSections(videoId, next.map((s) => s.id)));
  };

  const row = (s: YtSection, i: number | null) => {
    const order = s.kind === "intro" ? 0 : s.kind === "closing" ? 99 : (i ?? 0) + 1;
    const t = totals[s.id];
    const isBody = s.kind === "body";
    return (
      <li
        key={s.id}
        draggable={isBody}
        onDragStart={() => i != null && setDrag(i)}
        onDragOver={(e) => isBody && drag != null && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (drag != null && i != null && drag !== i) reorder(moveItem(body, drag, i));
          setDrag(null);
        }}
        onDragEnd={() => setDrag(null)}
        className={`rounded-md border p-2.5 ${s.is_climax ? "border-accent bg-accent-soft/30" : isBody ? "border-line" : "border-line bg-subtle/60"} ${drag === i && isBody ? "opacity-50" : ""}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {isBody ? (
            <span className="cursor-grab select-none text-faint" title="Drag to reorder" aria-hidden>
              ⠿
            </span>
          ) : (
            <span className="w-3" aria-hidden />
          )}
          <span className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs font-semibold text-muted" title={locked ? "Fixed number (used in file names)" : "Numbers are fixed when you lock the outline"}>
            {displayCode(s, order)}
          </span>
          <div className="min-w-[10rem] flex-1">
            <BlurField value={s.title} ariaLabel="Part title" maxLength={200} onSave={(v) => saveMeta(s.id, { title: v })} className={`${INPUT} font-medium`} />
          </div>
          {s.kind === "intro" && (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted" title="Intro status">
              {INTRO_STATUSES.find((x) => x.id === s.intro_status)?.label ?? "Not written"}
            </span>
          )}
          {t && (
            <span className="text-xs tabular-nums text-faint" title="Words · estimated time">
              {t.words}w · {formatDuration(t.seconds)}
            </span>
          )}
          <select
            aria-label="Energy"
            title="Energy 1–5 (music & pacing)"
            className="rounded border border-line bg-surface px-1 py-0.5 text-xs text-muted"
            value={s.energy ?? ""}
            onChange={(e) => saveMeta(s.id, { energy: e.target.value ? Number(e.target.value) : null }).then((m) => m && setErr(m))}
          >
            <option value="">Energy –</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Energy {n}
              </option>
            ))}
          </select>
          {isBody && !isShort && (
            <label className={`flex items-center gap-1 text-xs ${s.is_climax ? "font-semibold text-accent" : "text-muted"}`} title="Exactly one part is the climax">
              <input type="radio" name="climax" checked={s.is_climax} disabled={pending} onChange={() => run(() => setClimax(videoId, s.id))} />★ Climax
            </label>
          )}
          {locked && (
            <button type="button" className={BTN_SM} onClick={() => onWrite(s.id)}>
              Write →
            </button>
          )}
        </div>
        <div className="mt-1.5 pl-5">
          <BlurField
            value={s.description ?? ""}
            multiline
            rows={1}
            ariaLabel="What happens in this part"
            placeholder={s.kind === "closing" ? "Wrap up and invite them to the next video…" : "What happens in this part (short)…"}
            maxLength={1000}
            onSave={(v) => saveMeta(s.id, { description: v })}
            className={`${INPUT} text-xs`}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
          {isBody && i != null && (
            <>
              <button type="button" className={BTN_SM} disabled={pending || i === 0} onClick={() => reorder(moveItem(body, i, i - 1))} aria-label="Move up">
                ↑
              </button>
              <button type="button" className={BTN_SM} disabled={pending || i === body.length - 1} onClick={() => reorder(moveItem(body, i, i + 1))} aria-label="Move down">
                ↓
              </button>
            </>
          )}
          {s.kind !== "closing" && (
            <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(async () => { const r = await addSection(videoId, s.id); return r.error ? { error: r.error } : undefined; })}>
              + Part below
            </button>
          )}
          {isBody && (
            <button
              type="button"
              className={`${BTN_SM} hover:text-danger`}
              disabled={pending}
              onClick={() => {
                const words = totals[s.id]?.words ?? 0;
                if (!confirm(words ? `Delete “${s.title}” and its ${words} words of script?` : `Delete “${s.title}”?`)) return;
                run(() => deleteSection(s.id));
              }}
            >
              Delete
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className={BOX}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">Outline</h3>
            <p className="text-xs text-muted">
              {isShort ? "Hook · Body · Payoff." : "Intro and Closing are fixed. Drag the parts in between, and mark exactly one ★ climax."}{" "}
              {locked ? "Numbers are fixed now (file names use them); new parts get the next free number." : "Lock it to give every part a fixed number and start writing."}
            </p>
          </div>
          {!locked && (
            <button type="button" className={PRIMARY} disabled={pending || !check.ok} onClick={() =>
                start(async () => {
                  setErr(null);
                  const r = await lockOutline(videoId);
                  if (r.error) return setErr(r.error);
                  router.refresh();
                  const first = body[0] ?? intro;
                  if (first) onWrite(first.id);
                })
              } title={check.ok ? "" : check.errors.join(" ")}>
              🔒 Lock outline & write
            </button>
          )}
        </div>
        {(check.errors.length > 0 || check.warnings.length > 0) && (
          <ul className="space-y-0.5 text-xs">
            {check.errors.map((e) => (
              <li key={e} className="text-danger">
                ✕ {e}
              </li>
            ))}
            {check.warnings.map((w) => (
              <li key={w} className="text-warning">
                ⚠ {w}
              </li>
            ))}
          </ul>
        )}
        <ol className="space-y-2">
          {intro && row(intro, null)}
          {body.map((s, i) => row(s, i))}
          {closing && row(closing, null)}
        </ol>
        {body.length === 0 && (
          <button type="button" className={BTN} disabled={pending} onClick={() => run(async () => { const r = await addSection(videoId, null); return r.error ? { error: r.error } : undefined; })}>
            + Add a part
          </button>
        )}
        <Msg error={err} info={info} />
      </div>

      <details className={BOX}>
        <summary className="cursor-pointer text-sm font-medium">Save this outline as a template</summary>
        <p className="text-xs text-muted">Saves the parts (titles, descriptions, climax, energy) — not the text.</p>
        <div className="flex flex-wrap gap-2">
          <input className={`${INPUT} max-w-xs`} placeholder="Template name" value={tplName} maxLength={80} onChange={(e) => setTplName(e.target.value)} />
          <select className="rounded-md border border-line-strong bg-surface px-2 text-sm" value={tplFormat} onChange={(e) => setTplFormat(e.target.value)} aria-label="Format">
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <button type="button" className={BTN} disabled={pending || !tplName.trim()} onClick={() => run(() => saveOutlineTemplate(videoId, tplName, tplFormat))}>
            Save template
          </button>
        </div>
      </details>
    </div>
  );
}
