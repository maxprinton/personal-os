// Browser side of the ✨ AI: asks /api/ai and draws the answer (Markdown) as a safe preview.
import { Marked } from "marked";
import type { AiRequest } from "@/lib/ai-notes";

export type AiResult = { text: string } | { error: string };

export async function askAi(req: AiRequest, signal?: AbortSignal): Promise<AiResult> {
  try {
    const res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal });
    const j = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
    if (j?.text) return { text: j.text };
    return { error: j?.error ?? (res.status === 401 ? "Sign in again." : `The AI couldn't answer (HTTP ${res.status}).`) };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { error: "Stopped." };
    return { error: "No connection. Try again." };
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
