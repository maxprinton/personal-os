// Browser side of the ✨ AI: asks /api/ai and draws the answer (Markdown) as a safe preview.
import { Marked } from "marked";
import type { AiRequest } from "@/lib/ai-notes";
import { showAiUsage } from "@/lib/ai-usage-client";

export type AiResult = { text: string; usage?: string | null } | { error: string };

/** Asks the AI. Never waits longer than `timeoutMs`: then it gives up with a message instead of hanging. */
export async function askAi(req: AiRequest, signal?: AbortSignal, timeoutMs = 70_000): Promise<AiResult> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const stop = () => ctrl.abort();
  signal?.addEventListener("abort", stop);
  try {
    const res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal: ctrl.signal });
    const j = (await res.json().catch(() => null)) as { text?: string; error?: string; usage?: string | null } | null;
    if (j?.text) {
      showAiUsage(j.usage);
      return { text: j.text, usage: j.usage ?? null };
    }
    if (j?.error) return { error: j.error };
    if (res.status === 401) return { error: "Sign in again." };
    if (res.status === 504) return { error: "The AI took too long. Try again." };
    return { error: `The AI couldn't answer (HTTP ${res.status}). Try again.` };
  } catch {
    if (timedOut) return { error: "The AI took too long. Try again." };
    if (ctrl.signal.aborted) return { error: "Stopped." };
    return { error: "No connection. Try again." };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = new Marked({
  gfm: true,
  // Raw HTML from the model is shown as text, never run
  renderer: { html: ({ text }) => esc(text) },
  walkTokens: (t) => {
    if ((t.type === "link" || t.type === "image") && /^\s*(javascript|data|vbscript):/i.test(t.href)) t.href = "#";
  },
});

export function previewHtml(markdown: string): string {
  try {
    return md.parse(markdown, { async: false }) as string;
  } catch {
    return `<p>${esc(markdown)}</p>`;
  }
}
