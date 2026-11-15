"use client";

import { useState } from "react";
import { createClipKey, revokeClipKey } from "@/app/settings-actions";

/** Personal key for the Coursera browser extension. The key is shown once (only its hash is stored). */
export default function ClipKeyCard({ hasKey, createdAt, appUrl }: { hasKey: boolean; createdAt: string | null; appUrl: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"key" | "url" | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    const res = await createClipKey();
    setBusy(false);
    if (res.key) setKey(res.key);
    else setError(res.error ?? "Could not create the key.");
  }

  async function copy(text: string, what: "key" | "url") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* the text is selectable anyway */
    }
  }

  return (
    <section className="space-y-3 card p-5">
      <h2 className="font-medium">Coursera clipper (Chrome extension)</h2>
      <p className="text-sm text-muted">
        The extension saves the lesson you have open as two notes (the reading and the video transcript) that share a tag.
        Paste this address and key into the extension once.
      </p>
      <div className="space-y-1 text-sm">
        <p className="text-muted">App address</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-subtle px-2 py-1 font-mono text-sm break-all">{appUrl}</code>
          <button type="button" onClick={() => copy(appUrl, "url")} className="rounded-md border border-line px-2 py-1 text-xs">
            {copied === "url" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {key ? (
        <div className="space-y-2 rounded-md bg-subtle p-3 text-sm">
          <p className="font-medium">Your key (shown only now, copy it into the extension):</p>
          <code className="block rounded bg-surface px-2 py-1 font-mono text-sm break-all select-all">{key}</code>
          <button type="button" onClick={() => copy(key, "key")} className="rounded-md border border-line px-2 py-1 text-xs">
            {copied === "key" ? "Copied" : "Copy key"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {hasKey ? `A key is active (created ${createdAt ? new Date(createdAt).toLocaleDateString() : "earlier"}).` : "No key yet."}
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={make}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {hasKey || key ? "Make a new key (the old one stops working)" : "Create my key"}
        </button>
        {(hasKey || key) && (
          <form
            action={async () => {
              await revokeClipKey();
              setKey(null);
            }}
          >
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-danger">Turn the extension off</button>
          </form>
        )}
      </div>
    </section>
  );
}
