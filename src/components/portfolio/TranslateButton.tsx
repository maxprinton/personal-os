"use client";
// ✨ Translate this page into the other language: asks the AI, shows the result (nothing is saved yet), then Accept (a new
// linked draft note in the other language, ready to review) or Discard.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptTranslationAction, previewTranslationAction, type TranslatePreview } from "@/app/portfolio-translate-actions";
import { LANG_LABEL, type Lang } from "@/lib/portfolio/constants";
import { BTN_PLAIN, BTN_PRIMARY } from "./ui";

export default function TranslateButton({ slotId, from, to }: { slotId: string; from: Lang; to: Lang }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Extract<TranslatePreview, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const run = () =>
    start(async () => {
      setError(null);
      setOpen(true);
      const r = await previewTranslationAction(slotId, from);
      if (r.ok) setData(r);
      else {
        setData(null);
        setError(r.error);
      }
    });
  const close = () => {
    setOpen(false);
    setData(null);
    setError(null);
  };
  const accept = () =>
    start(async () => {
      if (!data) return;
      const r = await acceptTranslationAction(slotId, to, data.title, data.content);
      if (r.ok) {
        close();
        router.refresh();
      } else setError(r.error);
    });

  return (
    <>
      <button type="button" onClick={run} disabled={busy} className={BTN_PLAIN} title={`Draft the ${LANG_LABEL[to]} version with the AI. You review it before it is saved.`}>
        ✨ Translate to {LANG_LABEL[to]}
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`Translation to ${LANG_LABEL[to]}`} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-xl border border-line bg-surface shadow-card sm:rounded-xl">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">✨ {LANG_LABEL[from]} → {LANG_LABEL[to]}</h2>
              <button type="button" onClick={close} className="text-sm text-muted hover:text-fg" aria-label="Close">
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
              {busy && !data && !error && <p className="text-sm text-muted">Translating… this can take up to a minute for a long page.</p>}
              {error && (
                <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              {data && (
                <>
                  <p className="text-xs text-muted">
                    This is a draft. Nothing is saved until you press Accept. After that it appears as the {LANG_LABEL[to]} note of this page, still unpublished, so you can read and fix it in the editor.
                  </p>
                  <p className="text-base font-semibold">{data.title}</p>
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-line bg-subtle p-3 text-sm leading-relaxed">{data.content}</pre>
                  {data.usage && <p className="text-xs text-muted">{data.usage}</p>}
                </>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
              <button type="button" onClick={close} disabled={busy} className={BTN_PLAIN}>
                {data ? "Discard" : "Close"}
              </button>
              {data && (
                <button type="button" onClick={accept} disabled={busy} className={BTN_PRIMARY}>
                  Accept as {LANG_LABEL[to]} draft
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
