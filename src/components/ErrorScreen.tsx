"use client";

import { useEffect, useState } from "react";
import { isStaleBuildError, reloadOnce, repairAndReload } from "@/lib/recover";

type Props = {
  error: Error & { digest?: string };
  /** "Try again": render the page again. */
  retry: () => void;
  /** The whole app failed (no sidebar around this screen). */
  whole?: boolean;
};

/**
 * What you see when something breaks, instead of the bare "Application error" line:
 * a calm message, ways out (try again, reload, Today) and the technical details to copy.
 * If the app was just updated while this tab was open, it reloads itself into the new version.
 */
export default function ErrorScreen({ error, retry, whole = false }: Props) {
  const stale = isStaleBuildError(error);
  const [updating, setUpdating] = useState(stale);
  const [copied, setCopied] = useState(false);
  const [where, setWhere] = useState({ page: "", when: "", browser: "" });

  useEffect(() => {
    // Read only in the browser (keeps the first render identical on server and client)
    setWhere({ page: window.location.pathname + window.location.search, when: new Date().toLocaleString("en-US"), browser: navigator.userAgent });
    console.error(error);
    if (stale && !reloadOnce()) setUpdating(false); // already reloaded a moment ago: show the screen
  }, [error, stale]);

  const server = !!error.digest && /Server Components render/i.test(error.message);
  const details = [
    `Message: ${error.message || "(none)"}`,
    error.name && error.name !== "Error" ? `Type: ${error.name}` : "",
    error.digest ? `Digest: ${error.digest} (search it in Vercel → Logs)` : "",
    where.page ? `Page: ${where.page}` : "",
    where.when ? `When: ${where.when}` : "",
    where.browser ? `Browser: ${where.browser}` : "",
    error.stack ? `\n${error.stack.split("\n").slice(0, 8).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the details are still visible to select */
    }
  }

  if (updating) {
    return (
      <Frame whole={whole}>
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="animate-spin" aria-hidden>
            <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Updating to the new version…</h1>
        <p className="mt-2 text-sm text-muted">Personal OS was just updated while this page was open. One second.</p>
      </Frame>
    );
  }

  return (
    <Frame whole={whole}>
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft text-danger">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 8v5M12 16.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold tracking-tight">{whole ? "Personal OS couldn’t load" : "This page hit a problem"}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        {server
          ? "The server couldn’t prepare this page (often a brief connection issue with the database)."
          : "Something unexpected happened while showing this page."}{" "}
        Your data is safe: nothing was lost or changed.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => void repairAndReload()}
          title="Downloads the app again (clears its offline copy; your data stays)"
          className="rounded-md border border-edge bg-surface px-4 py-2 text-sm font-medium transition-colors hover:bg-subtle"
        >
          Repair &amp; reload
        </button>
        <a href="/" className="rounded-md px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-subtle hover:text-fg">
          Go to Today
        </a>
      </div>

      <details className="mt-8 rounded-lg border border-line bg-subtle/60 text-left">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-muted hover:text-fg">Technical details</summary>
        <div className="border-t border-line px-4 py-3">
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted">{details}</pre>
          <button type="button" onClick={() => void copy()} className="mt-3 rounded-md border border-edge bg-surface px-3 py-1.5 text-xs font-medium hover:bg-subtle">
            {copied ? "Copied ✓" : "Copy details"}
          </button>
          <p className="mt-2 text-xs text-faint">If it keeps happening, paste these details to Claude.</p>
        </div>
      </details>
    </Frame>
  );
}

function Frame({ children, whole }: { children: React.ReactNode; whole: boolean }) {
  return (
    <main className={`flex w-full items-center justify-center px-4 py-10 ${whole ? "min-h-dvh bg-app text-fg" : "min-h-[70dvh]"}`}>
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">{children}</div>
    </main>
  );
}
