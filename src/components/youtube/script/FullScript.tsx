"use client";
// Read-only whole script: the ordered sum of every section (Sources left out). "Edit" opens that section.
import { displayCode, formatDuration, paragraphs } from "@/lib/youtube/outline";
import type { YtSection } from "@/lib/youtube/types";
import { BOX, BTN_SM } from "./ui";

export default function FullScript({
  sections,
  texts,
  totals,
  onEdit,
}: {
  sections: YtSection[];
  texts: Record<string, string>;
  totals: Record<string, { words: number; seconds: number }>;
  onEdit: (id: string) => void;
}) {
  let bodyIdx = 0;
  return (
    <div className={`${BOX} space-y-6`}>
      <p className="text-xs text-muted">Read-only. Everything here belongs to a part — to change it, edit that part.</p>
      {sections.map((s) => {
        const order = s.kind === "body" ? ++bodyIdx : s.kind === "intro" ? 0 : 99;
        const paras = paragraphs(texts[s.id] ?? s.content ?? "");
        const t = totals[s.id];
        return (
          <section key={s.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2 border-b border-line pb-1">
              <h3 className="text-base font-semibold">
                <span className="font-mono text-sm text-muted">{displayCode(s, order)}</span> · {s.title}
                {s.is_climax && <span className="ml-1 text-accent">★</span>}
              </h3>
              <span className="text-xs tabular-nums text-faint">
                {t?.words ?? 0}w · {formatDuration(t?.seconds ?? 0)}
              </span>
              <span className="flex-1" />
              <button type="button" className={BTN_SM} onClick={() => onEdit(s.id)}>
                Edit
              </button>
            </div>
            {paras.length ? (
              paras.map((p) => (
                <p key={p.idx} className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  {p.text}
                </p>
              ))
            ) : (
              <p className="text-sm italic text-faint">{s.kind === "intro" ? "Not written yet — the intro is often written last." : "Empty."}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
