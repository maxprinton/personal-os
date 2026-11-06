"use client";
// Opening a note from a search (?find=words): every match in the page is highlighted, the first one
// scrolled into view, with a small bar: "3 of 12  ↑ ↓  ✕" (Enter / Shift+Enter in the bar too).
// Uses the browser's CSS Custom Highlight API (no change to the editor); without it, just scrolls.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { findMatches, parseQuery } from "@/lib/search/core";

type Hl = { new (...r: Range[]): unknown };
const HL = () => (typeof window !== "undefined" ? (window as unknown as { Highlight?: Hl }).Highlight : undefined);
const registry = () => (typeof CSS !== "undefined" ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined);

function collect(root: Element, words: string[]): Range[] {
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode()) && out.length < 500) {
    const text = node.nodeValue ?? "";
    for (const [a, b] of findMatches(text, words)) {
      const r = document.createRange();
      r.setStart(node, a);
      r.setEnd(node, b);
      out.push(r);
    }
  }
  return out;
}

export default function FindInNote() {
  const params = useSearchParams();
  const find = params.get("find") ?? "";
  const [ranges, setRanges] = useState<Range[]>([]);
  const [at, setAt] = useState(0);
  const [closed, setClosed] = useState(false);
  const tries = useRef(0);

  useEffect(() => {
    setClosed(false);
    setAt(0);
    tries.current = 0;
    const words = parseQuery(find).words;
    if (!words.length) return setRanges([]);
    let timer = 0;
    const scan = () => {
      const root = document.querySelector("main .ProseMirror") ?? document.querySelector("main");
      const found = root ? collect(root, words) : [];
      // The editor loads after the page: look again for a few seconds
      if (!found.length && tries.current++ < 20) timer = window.setTimeout(scan, 250);
      else setRanges(found);
    };
    timer = window.setTimeout(scan, 150);
    return () => window.clearTimeout(timer);
  }, [find]);

  useEffect(() => {
    const reg = registry();
    const H = HL();
    if (!reg || !H) return;
    if (closed || !ranges.length) {
      reg.delete("search-find");
      reg.delete("search-current");
      return;
    }
    reg.set("search-find", new H(...ranges));
    reg.set("search-current", new H(ranges[at]));
    return () => {
      reg.delete("search-find");
      reg.delete("search-current");
    };
  }, [ranges, at, closed]);

  useEffect(() => {
    const r = ranges[at];
    if (!r || closed) return;
    const el = r.startContainer.parentElement;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [ranges, at, closed]);

  if (!find || closed) return null;
  const step = (d: number) => ranges.length && setAt((i) => (i + d + ranges.length) % ranges.length);
  return (
    <div className="fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm shadow-lg lg:bottom-6" role="status">
      <span className="max-w-[40vw] truncate text-muted">“{find}”</span>
      <span className="tabular-nums text-fg">{ranges.length ? `${at + 1} of ${ranges.length}` : "not on this page"}</span>
      <button type="button" className="rounded px-1.5 hover:bg-subtle" aria-label="Previous match" onClick={() => step(-1)}>
        ↑
      </button>
      <button type="button" className="rounded px-1.5 hover:bg-subtle" aria-label="Next match" onClick={() => step(1)}>
        ↓
      </button>
      <button type="button" className="rounded px-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Close" onClick={() => setClosed(true)}>
        ✕
      </button>
    </div>
  );
}
