"use client";
// Runs a server action, shows its error, refreshes the page data on success (Worker B, Edit/Music).
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const run = useCallback(
    (fn: () => Promise<{ error?: string; ok?: boolean } | void>, okInfo?: string) =>
      new Promise<boolean>((resolve) => {
        setError(null);
        setInfo(null);
        start(async () => {
          try {
            const r = await fn();
            if (r && r.error) {
              setError(r.error);
              resolve(false);
              return;
            }
            if (okInfo) setInfo(okInfo);
            router.refresh();
            resolve(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
            resolve(false);
          }
        });
      }),
    [router],
  );
  return { run, pending, error, info, setError, setInfo };
}

/** Saves text as a file in the browser (Downloads folder). */
export function downloadText(name: string, text: string, type = "text/plain") {
  downloadBlob(name, new Blob([text], { type: `${type};charset=utf-8` }));
}
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
