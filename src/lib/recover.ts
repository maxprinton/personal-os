// Recovering from "the app was updated while this tab was open" (the old page asks for files of the
// previous version, which no longer exist) and from a broken offline copy of an app file.

const PATTERNS = [
  /ChunkLoadError/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Failed to find Server Action/i,
  /reading 'call'/i, // webpack: a module of the new version is missing in the old page
  /Cannot find module '\.\/\d+/i,
  /Unexpected token '<'/i, // an app file came back as an HTML error page
];

/** True when the error comes from an outdated or broken copy of the app's files. */
export function isStaleBuildError(e: unknown) {
  const err = e as { name?: string; message?: string } | null | undefined;
  const text = `${err?.name ?? ""} ${err?.message ?? (typeof e === "string" ? e : "")}`;
  return PATTERNS.some((p) => p.test(text));
}

const KEY = "pos.reloadedAt";

/** Deletes the offline copies of the app's files (they download again; nothing of yours is in them). */
export async function clearAppCaches() {
  try {
    if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k);
  } catch {
    /* not available: nothing to clear */
  }
}

/**
 * Clears the offline copies and reloads, at most once every 30 s (so a real bug can never cause a
 * reload loop). Returns false when it already did that a moment ago.
 */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // no storage (private mode): still reload once
  }
  void clearAppCaches().finally(() => window.location.reload());
  return true;
}

/** "Repair": forget the service worker and every offline copy, then load the app fresh. */
export async function repairAndReload() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* ignore */
  }
  await clearAppCaches();
  window.location.reload();
}
