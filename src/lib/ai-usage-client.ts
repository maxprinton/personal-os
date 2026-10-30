"use client";
// Shows the AI usage line ("✨ 1,840 tokens · today 23.4K of 200K tokens · …") in a small toast
// (components/AiUsageToast.tsx, mounted once in the layout).
export const AI_USAGE_EVENT = "pos-ai-usage";
export function showAiUsage(line?: string | null) {
  if (line && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AI_USAGE_EVENT, { detail: line }));
}
