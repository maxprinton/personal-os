"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { isStaleBuildError, reloadOnce, repairAndReload } from "@/lib/recover";

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
};
type Editor = ComponentType<Props>;

let loading: Promise<Editor> | null = null;
/** Downloads the editor once; a failed download is forgotten so "Retry" really tries again. */
function loadEditor() {
  return (loading ??= import("@/components/editor/RichEditor")
    .then((m) => m.default as Editor)
    .catch((e) => {
      loading = null;
      throw e;
    }));
}

/**
 * The Notion-style editor, downloaded only when a note is shown. Until it is ready the note is
 * already visible (read-only), so a note never sits on a blank "Loading…". If the download is slow
 * or fails, it says so and offers Retry / Repair & reload instead of waiting forever.
 */
export default function LazyRichEditor(props: Props) {
  const [Comp, setComp] = useState<Editor | null>(null);
  const [state, setState] = useState<"loading" | "slow" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    const slow = setTimeout(() => alive && setState((s) => (s === "loading" ? "slow" : s)), 6000);
    loadEditor()
      .then((C) => {
        if (alive) setComp(() => C);
      })
      .catch((e) => {
        console.error("Editor failed to load", e);
        if (!alive) return;
        if (isStaleBuildError(e) && reloadOnce()) return;
        setState("failed");
      })
      .finally(() => clearTimeout(slow));
    return () => {
      alive = false;
      clearTimeout(slow);
    };
  }, [attempt]);

  const html = useMemo(() => (Comp ? "" : renderMarkdown(props.value || "")), [Comp, props.value]);
  if (Comp) return <Comp {...props} />;

  return (
    <div className={props.className}>
      {state !== "loading" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning-soft bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
          <span className="mr-auto">
            {state === "slow" ? "The editor is taking long to load. Your note is shown below (read-only)." : "The editor couldn’t load. Your note is shown below (read-only); nothing was lost."}
          </span>
          <button
            type="button"
            onClick={() => {
              loading = null;
              setAttempt((a) => a + 1);
            }}
            className="rounded-md border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-subtle"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => void repairAndReload()}
            className="rounded-md border border-edge bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:bg-subtle"
          >
            Repair &amp; reload
          </button>
        </div>
      )}
      <div
        className={`rich-prose ${state === "loading" ? "opacity-70" : ""}`}
        style={{ minHeight: props.minHeight ?? 96 }}
        aria-busy={state === "loading"}
        dangerouslySetInnerHTML={{ __html: html || `<p class="text-faint">${state === "loading" ? "Loading…" : "Empty note"}</p>` }}
      />
    </div>
  );
}
