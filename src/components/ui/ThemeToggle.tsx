"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";

export type ThemePref = "auto" | "light" | "dark";

const KEY = "ui.theme";

/** Inline script for <head>: applies the theme before the first paint (no white flash in dark mode). */
export const themeScript = `(function(){try{var p=localStorage.getItem("${KEY}")||"auto";var d=p==="dark"||(p==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#0f1117" : "#f6f7fb"));
}

/** Keeps "auto" in sync when the system switches between light and dark. Mount once (AppShell). */
export function useSystemThemeSync() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "auto") applyTheme("auto");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
}

const options: { value: ThemePref; label: string; icon: "monitor" | "sun" | "moon" }[] = [
  { value: "auto", label: "Auto", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

/** Segmented control: Auto / Light / Dark. `compact` shows icons only. */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [pref, setPref] = useState<ThemePref>("auto");
  useEffect(() => setPref(readTheme()), []);

  function choose(p: ThemePref) {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      // not remembered, still applied
    }
    applyTheme(p);
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="compact inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          title={o.label}
          onClick={() => choose(o.value)}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            pref === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
          }`}
        >
          <Icon name={o.icon} size={14} />
          {!compact && o.label}
        </button>
      ))}
    </div>
  );
}
