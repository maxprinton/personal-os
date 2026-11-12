"use client";

import { useEffect, useState } from "react";
import { createAlarmKey, revokeAlarmKey } from "@/app/settings-actions";

/** Personal key for the Android alarms app. The key is shown once (only its hash is stored). */
export default function AlarmKeyCard({ hasKey, createdAt, appUrl }: { hasKey: boolean; createdAt: string | null; appUrl: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"key" | "url" | null>(null);
  // Latest build of the phone app (written by the GitHub build into /downloads/version.json)
  const [build, setBuild] = useState<{ versionName: string; builtAt?: string } | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/downloads/version.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setBuild(j && typeof j.versionName === "string" ? j : null))
      .catch(() => alive && setBuild(null));
    return () => {
      alive = false;
    };
  }, []);

  async function make() {
    setBusy(true);
    setError(null);
    const res = await createAlarmKey();
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
      <h2 className="font-medium">Phone alarms (Android app)</h2>
      <p className="text-sm text-muted">
        The Personal OS Alarms app on your phone reads the blocks you marked with an Alarm (open a block → Phone alarm) and
        rings real alarms for them. Paste the address and this key into the app once.
      </p>
      <div className="space-y-2 rounded-md bg-subtle p-3 text-sm">
        <p className="font-medium">1. Get the app</p>
        {build ? (
          <>
            <p className="text-muted">
              Open this page on your phone and tap the button. Version {build.versionName}
              {build.builtAt ? `, built ${new Date(build.builtAt).toLocaleDateString()}` : ""}. Once installed, the app updates
              itself from here.
            </p>
            <a
              href="/downloads/personal-os-alarms.apk"
              download
              className="inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover"
            >
              Download the Android app (.apk)
            </a>
          </>
        ) : build === null ? (
          <p className="text-muted">
            The app has not been built yet. Upload the changes with SUBIR-CAMBIOS.cmd, wait for the green check in GitHub →
            Actions → &quot;Build Android alarms app&quot;, and the download button appears here.
          </p>
        ) : (
          <p className="text-muted">Looking for the latest build…</p>
        )}
      </div>
      <div className="space-y-1 text-sm">
        <p className="font-medium">2. Connect it</p>
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
          <p className="font-medium">Your key (shown only now, copy it into the app):</p>
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
              await revokeAlarmKey();
              setKey(null);
            }}
          >
            <button className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-danger">Turn the phone app off</button>
          </form>
        )}
      </div>
    </section>
  );
}
