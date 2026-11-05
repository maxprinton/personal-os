"use client";
// "Copy" button for every publish field (the manual fallback when Google is not connected).
import { useState } from "react";

export default function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      // Older browsers / no permission: select-and-copy fallback.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        setState(ok ? "ok" : "fail");
      } catch {
        setState("fail");
      }
    }
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!text}
      title={text ? `Copy ${text.length} characters` : "Nothing to copy"}
      className={className ?? "rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-fg disabled:opacity-40"}
    >
      {state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed" : label}
    </button>
  );
}
