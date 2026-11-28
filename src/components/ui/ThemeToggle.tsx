"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { getThemePref, saveThemePref } from "@/app/theme-actions";

export type ThemePref = "auto" | "light" | "dark";

const KEY = "ui.theme";
/** Dark is the default. Whatever you pick last stays (this browser at once, every device via your settings). */
export const DEFAULT_THEME: ThemePref = "dark";
const CHANGED = "ui-theme-changed";

/** Inline script for <head>: applies the theme before the first paint (no white flash). */
export const themeScript = `(function(){try{var p=localStorage.getItem("${KEY}");if(p!=="auto"&&p!=="light"&&p!=="dark")p="${DEFAULT_THEME}";var d=p==="dark"||(p==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="dark";}})();`;

const clean = (v: unknown): ThemePref | null => (v === "auto" || v === "light" || v === "dark" ? v : null);

function readTheme(): ThemePref {
  try {
    return clean(localStorage.getItem(KEY)) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function remember(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // not remembered in this browser, still applied (and saved in your settings)
  }
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#12141c" : "#fbfcfe"));
}

/** Picks a theme: applies it, remembers it here, saves it in your settings and updates every toggle on screen. */
export function setThemePref(pref: ThemePref, { save = true } = {}) {
  remember(pref);
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent<ThemePref>(CHANGED, { detail: pref }));
  if (save) pushToSettings(pref);
}

/** "This browser's pick has not reached your settings yet" (the save failed, or the page reloaded first). */
const UNSAVED = "ui.theme.unsaved";

function markUnsaved(on: boolean) {
  try {
    if (on) localStorage.setItem(UNSAVED, "1");
    else localStorage.removeItem(UNSAVED);
  } catch {
    // nothing to mark
  }
}

function isUnsaved() {
  try {
    return localStorage.getItem(UNSAVED) === "1";
  } catch {
    return false;
  }
}

/** Saves the pick in your settings. Until that works, opening the app never lets the older saved value win. */
function pushToSettings(pref: ThemePref) {
  markUnsaved(true);
  void saveThemePref(pref)
    .then((r) => r.ok && markUnsaved(false))
    .catch(() => undefined);
}

/** Switches between dark and light (keyboard shortcut D). From Auto it goes to the opposite of what you see. */
export function toggleTheme() {
  setThemePref(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

/** What <html data-theme> should be right now for your pick. */
function expected(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return dark ? "dark" : "light";
}

/**
 * Mount once (AppShell): keeps "auto" in sync with the system, and on opening the app takes the theme
 * you picked last on any device (your settings). The first time, this browser's choice is saved there.
 */
export function useSystemThemeSync() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "auto") applyTheme("auto");
    };
    mq.addEventListener("change", onChange);

    // Guard: React wipes every attribute of <html> when it re-renders the page from scratch (after a
    // small rendering error), and without data-theme the page falls back to light. Put it back at once.
    const guard = new MutationObserver(() => {
      const pref = readTheme();
      if (document.documentElement.dataset.theme !== expected(pref)) applyTheme(pref);
    });
    guard.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let cancelled = false;
    void getThemePref()
      .then((server) => {
        if (cancelled) return;
        const local = readTheme();
        // A pick made here that never reached your settings wins over the older saved value.
        if (isUnsaved() || !server) pushToSettings(local);
        else if (server !== local) setThemePref(server, { save: false });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      guard.disconnect();
      mq.removeEventListener("change", onChange);
    };
  }, []);
}

const options: { value: ThemePref; label: string; icon: "monitor" | "sun" | "moon" }[] = [
  { value: "auto", label: "Auto", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

/** Segmented control: Auto / Light / Dark. `compact` shows icons only. */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [pref, setPref] = useState<ThemePref>(DEFAULT_THEME);
  useEffect(() => {
    setPref(readTheme());
    const onChanged = (e: Event) => {
      const p = clean((e as CustomEvent).detail);
      if (p) setPref(p);
    };
    window.addEventListener(CHANGED, onChanged);
    return () => window.removeEventListener(CHANGED, onChanged);
  }, []);

  return (
    <div role="radiogroup" aria-label="Theme" className="compact inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          title={o.value === "auto" ? o.label : `${o.label} (press D to switch dark/light)`}
          onClick={() => setThemePref(o.value)}
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
