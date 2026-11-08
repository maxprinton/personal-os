"use client";
// Publish controls of one language of a slot: "Preview & publish" (dialog with the page as visitors will see it, the
// warnings and a confirm), "Unpublish", and the version history (last 10) with Restore.
import "katex/dist/katex.min.css";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { historyAction, previewAction, publishAction, rollbackAction, unpublishAction } from "@/app/portfolio-publish-actions";
import { COLOR_NAMES } from "@/lib/editor/colors";
import type { HistoryItem, PreviewData } from "@/lib/portfolio/publish/preview";
import type { Warning } from "@/lib/portfolio/publish/warnings";
import { BTN_DANGER, BTN_PLAIN, BTN_PRIMARY } from "./ui";

const LEVEL_STYLE: Record<Warning["level"], string> = {
  error: "border-danger bg-danger-soft text-danger",
  warning: "border-warning bg-warning-soft text-warning",
  info: "border-line bg-subtle text-muted",
};
const LEVEL_LABEL: Record<Warning["level"], string> = { error: "Must fix", warning: "Check", info: "FYI" };

const colors = COLOR_NAMES.filter((c) => c !== "default")
  .map((c) => `.pf-preview .n-color-${c}{color:var(--n-${c})}.pf-preview .n-color-${c}_bg{background:var(--n-${c}-bg)}`)
  .join("");
const CSS = `.pf-preview{font-size:15px;line-height:1.65;overflow-wrap:anywhere}
.pf-preview h1,.pf-preview h2,.pf-preview h3,.pf-preview h4{font-weight:700;margin:1.2em 0 .4em;line-height:1.25}
.pf-preview h1{font-size:1.7em}.pf-preview h2{font-size:1.4em}.pf-preview h3{font-size:1.15em}
.pf-preview p,.pf-preview ul,.pf-preview ol,.pf-preview pre,.pf-preview figure,.pf-preview table{margin:.6em 0}
.pf-preview ul{list-style:disc;padding-left:1.4em}.pf-preview ol{list-style:decimal;padding-left:1.4em}
.pf-preview a{text-decoration:underline;color:var(--accent,#2563eb)}
.pf-preview img{max-width:100%;height:auto;border-radius:6px}
.pf-preview blockquote{border-left:3px solid var(--line-strong,#aaa);padding-left:.9em;opacity:.85}
.pf-preview code{background:rgba(127,127,127,.15);padding:.1em .3em;border-radius:4px;font-size:.9em}
.pf-preview pre{background:rgba(127,127,127,.12);padding:.8em;border-radius:8px;overflow:auto}.pf-preview pre code{background:none;padding:0}
.pf-preview hr{margin:1.2em 0;border-color:rgba(127,127,127,.3)}
.pf-preview figcaption{font-size:.85em;opacity:.7;margin-top:.3em}
.pf-preview .n-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr));gap:.5em}.pf-preview .n-gallery .n-figure{margin:0}.pf-preview .n-gallery img{width:100%;aspect-ratio:4/3;object-fit:cover}
.pf-preview .n-align-center{text-align:center}.pf-preview .n-align-right{text-align:right}
.pf-preview .n-callout{display:flex;gap:.7em;padding:.8em 1em;border-radius:8px;background:rgba(127,127,127,.12)}
.pf-preview .n-callout-body{flex:1;min-width:0}.pf-preview .n-callout-body>:first-child{margin-top:0}
.pf-preview .n-columns{display:flex;gap:1.2em}.pf-preview .n-column{min-width:0}
.pf-preview .n-toggle{margin:.6em 0}.pf-preview .n-toggle>summary{cursor:pointer;font-weight:600}
.pf-preview .n-table{overflow:auto}.pf-preview table{border-collapse:collapse}.pf-preview th,.pf-preview td{border:1px solid rgba(127,127,127,.35);padding:.35em .6em}
.pf-preview .n-embed iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:8px}
.pf-preview .n-bookmark a{display:block;border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:.6em .8em;text-decoration:none;color:inherit}
.pf-preview .n-bookmark span,.pf-preview .n-bookmark small{display:block;opacity:.7}
.pf-preview .n-math{overflow:auto}
.pf-preview mark.n-flag{background:#ffd0d0;color:#7a0b0b;outline:2px solid #d1242f;border-radius:3px}
${colors}`;

function Warnings({ list }: { list: Warning[] }) {
  if (!list.length) return <p className="text-sm text-success">No problems found.</p>;
  return (
    <ul className="space-y-1.5">
      {list.map((w) => (
        <li key={w.code} className={`rounded-md border px-3 py-2 text-sm ${LEVEL_STYLE[w.level]}`}>
          <span className="mr-2 text-xs font-semibold uppercase">{LEVEL_LABEL[w.level]}</span>
          {w.message}
          {w.detail && (
            <ul className="mt-1 list-disc pl-5 text-xs opacity-80">
              {w.detail.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

const SITE_NOTE = { updated: "The site was told to refresh.", skipped: "The site will pick it up within a few minutes.", failed: "Saved, but the site could not be reached; it will refresh by itself soon." } as const;

export default function PublishPanel({ slotId, lang, live, changed }: { slotId: string; lang: string; live: boolean; changed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, startBusy] = useTransition();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [problem, setProblem] = useState<{ error: string; warnings?: Warning[] } | null>(null);
  const [sure, setSure] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [hist, setHist] = useState<HistoryItem[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setOpen(true);
    setLoading(true);
    setPreview(null);
    setProblem(null);
    setSure(false);
    setDone(null);
    const r = await previewAction(slotId, lang);
    setLoading(false);
    if (r.ok) setPreview(r.preview);
    else setProblem({ error: r.error, warnings: r.warnings });
  };
  const close = () => {
    setOpen(false);
    if (done) router.refresh();
  };
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, done]);

  const go = () =>
    startBusy(async () => {
      if (!preview) return;
      const r = await publishAction(slotId, lang, sure, preview.hash);
      if (r.ok) setDone(`Published as version ${r.version} → ${r.path}. ${SITE_NOTE[r.site]}`);
      else if (r.changed) {
        setProblem({ error: r.error, warnings: r.warnings });
        setPreview(null);
      } else setProblem({ error: r.error, warnings: r.warnings });
    });

  const off = () =>
    startBusy(async () => {
      if (!window.confirm("Take this page offline? Visitors will no longer see it. You can publish it again later.")) return;
      const r = await unpublishAction(slotId, lang);
      setMsg(r.ok ? "Unpublished." : r.error);
      if (r.ok) router.refresh();
    });

  const showHistory = async () => {
    if (hist) return setHist(null);
    const r = await historyAction(slotId, lang);
    if (r.ok) setHist(r.items);
    else setMsg(r.error);
  };
  const restore = (v: HistoryItem) =>
    startBusy(async () => {
      if (!window.confirm(`Make version ${v.version} the live page again? It is saved as a new version.`)) return;
      const r = await rollbackAction(slotId, lang, v.version);
      setMsg(r.ok ? (r.note ?? "Restored.") : r.error);
      if (r.ok) {
        setHist(null);
        router.refresh();
      }
    });

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={load}>
          {live ? (changed ? "Preview & update" : "Preview & republish") : "Preview & publish"}
        </button>
        {live && (
          <button type="button" className={BTN_DANGER} disabled={busy} onClick={off}>
            Unpublish
          </button>
        )}
        <button type="button" className={BTN_PLAIN} onClick={showHistory}>
          {hist ? "Hide history" : "History"}
        </button>
      </div>
      {msg && <p role="status" className="text-sm text-muted">{msg}</p>}

      {hist && (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {hist.length === 0 && <li className="px-3 py-2 text-muted">Nothing published yet.</li>}
          {hist.map((h) => (
            <li key={h.version} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="font-medium">v{h.version}</span>
              <span className="text-muted">{h.action === "publish" ? "Published" : h.action === "rollback" ? "Restored" : "Unpublished"}</span>
              <span className="text-xs text-muted">{new Date(h.created_at).toLocaleString()}</span>
              {h.warnings.warnings + h.warnings.errors > 0 && <span className="text-xs text-warning">{h.warnings.warnings + h.warnings.errors} warning(s)</span>}
              {h.current ? (
                <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">Live now</span>
              ) : (
                h.restorable && (
                  <button type="button" className={`${BTN_PLAIN} ml-auto !px-2 !py-1 text-xs`} disabled={busy} onClick={() => restore(h)}>
                    Restore
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Preview and publish" onClick={(e) => e.target === e.currentTarget && close()}>
          <style>{CSS}</style>
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h3 className="text-base font-semibold">{done ? "Done" : preview?.live ? "Preview & update" : "Preview & publish"} · {lang.toUpperCase()}</h3>
              <button type="button" className={BTN_PLAIN} onClick={close}>
                Close
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[1fr_300px]">
              <div className="min-w-0 border-b border-line p-4 md:border-b-0 md:border-r">
                {loading && <p className="text-sm text-muted">Building the page…</p>}
                {problem && !preview && (
                  <div className="space-y-3">
                    <p role="alert" className="text-sm text-danger">{problem.error}</p>
                    {problem.warnings && <Warnings list={problem.warnings} />}
                  </div>
                )}
                {preview && (
                  <article>
                    <p className="text-xs text-muted">{preview.path} · {preview.readingMinutes} min read</p>
                    <h2 className="mt-1 text-2xl font-bold">{preview.icon && !preview.icon.startsWith("http") ? `${preview.icon} ` : ""}{preview.title}</h2>
                    {preview.summary && <p className="mt-1 text-muted">{preview.summary}</p>}
                    {preview.cover && /^https?:/.test(preview.cover) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview.cover.split("#")[0]} alt="" className="mt-3 max-h-56 w-full rounded-lg object-cover" />
                    )}
                    <div className="pf-preview mt-3" dangerouslySetInnerHTML={{ __html: preview.html }} />
                  </article>
                )}
              </div>

              <aside className="space-y-3 p-4">
                {done ? (
                  <p role="status" className="text-sm text-success">{done}</p>
                ) : (
                  preview && (
                    <>
                      <Warnings list={preview.warnings} />
                      {problem && <p role="alert" className="text-sm text-danger">{problem.error}</p>}
                      {preview.needsConfirm && !preview.blocked && (
                        <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" className="mt-1" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                          <span>I reviewed the warnings and want to publish anyway.</span>
                        </label>
                      )}
                      <button type="button" className={`${BTN_PRIMARY} w-full`} disabled={busy || preview.blocked || (preview.needsConfirm && !sure)} onClick={go}>
                        {busy ? "Publishing…" : preview.live ? "Publish update" : "Publish"}
                      </button>
                      {preview.blocked && <p className="text-xs text-muted">Fix the items marked “Must fix” in the note, then open this preview again.</p>}
                      <p className="text-xs text-muted">Nothing is public until you press Publish. Words you marked as never public are highlighted in red in the preview.</p>
                    </>
                  )
                )}
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
