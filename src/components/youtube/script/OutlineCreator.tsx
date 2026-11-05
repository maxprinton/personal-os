"use client";
// First step of the Script tab: pick an outline template (built-in per format, yours, or Hook · Body · Payoff for Shorts).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createOutline, deleteOutlineTemplate } from "@/app/youtube-actions/script";
import { FORMATS, OUTLINE_TEMPLATES, SHORT_SECTIONS } from "@/lib/youtube/constants";
import type { OutlineTemplateSection, VideoFormat, YtKind, YtOutlineTemplate } from "@/lib/youtube/types";
import { BOX, BTN_SM, Msg, PRIMARY } from "./ui";

type Choice = { builtin: VideoFormat | "short" } | { templateId: string };

function Preview({ sections }: { sections: OutlineTemplateSection[] }) {
  return (
    <ol className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted">
      {sections.map((s, i) => (
        <li key={i} className={`rounded border px-1.5 py-0.5 ${s.is_climax ? "border-accent text-accent" : "border-line"}`}>
          {s.is_climax ? "★ " : ""}
          {s.title}
        </li>
      ))}
    </ol>
  );
}

export default function OutlineCreator({ videoId, kind, formats, templates }: { videoId: string; kind: YtKind; formats: string[]; templates: YtOutlineTemplate[] }) {
  const router = useRouter();
  const first = (FORMATS.find((f) => formats.includes(f.id))?.id ?? "tutorial") as VideoFormat;
  const [pick, setPick] = useState<Choice>(kind === "short" ? { builtin: "short" } : { builtin: first });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isPicked = (p: Choice) => JSON.stringify(p) === JSON.stringify(pick);

  const create = () =>
    start(async () => {
      setErr(null);
      const r = await createOutline(videoId, pick);
      if (r.error) setErr(r.error);
      else router.refresh();
    });

  const option = (p: Choice, label: string, hint: string | null, sections: OutlineTemplateSection[], extra?: React.ReactNode) => (
    <label key={JSON.stringify(p)} className={`block cursor-pointer rounded-md border p-2.5 ${isPicked(p) ? "border-accent bg-accent-soft/40" : "border-line hover:bg-subtle"}`}>
      <span className="flex items-center gap-2">
        <input type="radio" name="tpl" checked={isPicked(p)} onChange={() => setPick(p)} />
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
        <span className="flex-1" />
        {extra}
      </span>
      <Preview sections={sections} />
    </label>
  );

  return (
    <div className={BOX}>
      <div>
        <h3 className="font-semibold">Start the outline</h3>
        <p className="text-sm text-muted">
          {kind === "short"
            ? "Shorts use three parts: Hook · Body · Payoff. You can add more parts after."
            : "Choice a template. The Intro (S00) and the Closing (S99) are always there; you choose and order the parts in between and mark one climax."}
        </p>
      </div>
      <div className="space-y-2">
        {kind === "short"
          ? option({ builtin: "short" }, "Short", "Hook · Body · Payoff", SHORT_SECTIONS)
          : FORMATS.map((f) => option({ builtin: f.id }, f.label, formats.includes(f.id) ? "your format" : null, OUTLINE_TEMPLATES[f.id]))}
        {kind !== "short" &&
          templates.map((t) =>
            option({ templateId: t.id }, t.name, `yours · ${t.format}`, t.sections ?? [], (
              <button
                type="button"
                className={BTN_SM}
                onClick={(e) => {
                  e.preventDefault();
                  if (!confirm(`Delete the template “${t.name}”?`)) return;
                  start(async () => {
                    const r = await deleteOutlineTemplate(t.id, videoId);
                    if (r.error) setErr(r.error);
                    else {
                      if (isPicked({ templateId: t.id })) setPick({ builtin: first });
                      router.refresh();
                    }
                  });
                }}
              >
                Delete
              </button>
            )),
          )}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className={PRIMARY} disabled={pending} onClick={create}>
          {pending ? "Creating…" : "Create outline"}
        </button>
        <Msg error={err} />
      </div>
    </div>
  );
}
