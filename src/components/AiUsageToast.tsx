"use client";
// After every AI use in the web app: a small note in the corner with what it cost and what's left today.
import { useEffect, useState } from "react";
import { AI_USAGE_EVENT } from "@/lib/ai-usage-client";

export default function AiUsageToast() {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const on = (e: Event) => {
      setLine(String((e as CustomEvent<string>).detail ?? ""));
      if (t) clearTimeout(t);
      t = setTimeout(() => setLine(null), 6000);
    };
    window.addEventListener(AI_USAGE_EVENT, on);
    return () => {
      window.removeEventListener(AI_USAGE_EVENT, on);
      if (t) clearTimeout(t);
    };
  }, []);
  if (!line) return null;
  return (
    <div className="ai-usage-toast" role="status" onClick={() => setLine(null)}>
      {line}
    </div>
  );
}
