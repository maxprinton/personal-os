"use client";
// The writing assistant for plain fields (tasks, calendar, finance, titles, quick capture): drop-in
// <WritingInput area="tasks" …/> / <WritingTextarea …/> with the same props as <input> / <textarea>.
// While the field has focus, a small bar under it shows the next-word suggestion (Tab or tap adds it)
// and how many problems it found (tap → suggestions, ignore, add to dictionary). Works with controlled
// and uncontrolled fields (it changes the value the way typing does). Nothing moves in the layout:
// the bar floats on top of the page.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { addGlossaryWord } from "@/app/writing-actions";
import { addKnownWord, checkWriting, ensureKnownWords, learnText, noteMistake, noteUnknown, onWritingChange, predictNext, suggestWriting, writingSettings, writingStatus } from "@/lib/writing/client";
import { predictOn, spellOn, type WritingArea } from "@/lib/writing/settings";
import type { Issue } from "@/lib/writing/types";
import type { Prediction } from "@/lib/writing/predict";

type El = HTMLInputElement | HTMLTextAreaElement;
const DELAY = 800;

/** Changes the value like typing does (React's onChange runs, uncontrolled fields keep it). */
function setNativeValue(el: El, value: string, caret?: number) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  if (caret !== undefined) el.setSelectionRange(caret, caret);
}

function useWriting(ref: React.RefObject<El | null>, area: WritingArea, multiline: boolean) {
  const [, force] = useState(0);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const ignored = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void ensureKnownWords();
    return onWritingChange(() => force((n) => n + 1));
  }, []);
  const spell = spellOn(writingSettings(), area);
  const predicting = predictOn(writingSettings(), area);

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 4, width: r.width });
  }, [ref]);

  const refresh = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const v = el.value;
    const end = el.selectionStart === el.selectionEnd && el.selectionEnd === v.length;
    setPred(predicting && end ? predictNext(v) : null);
    if (timer.current) clearTimeout(timer.current);
    if (!spell) return setIssues([]);
    timer.current = setTimeout(() => {
      void checkWriting(v).then((r) => {
        if (ref.current?.value !== v) return;
        // titles and short fields are fragments: no "capital letter" / "¿ ¡" nagging there
        const list = r.issues.filter((i) => (multiline || (i.kind !== "capital" && i.kind !== "punct")) && !ignored.current.has(i.word.toLocaleLowerCase()));
        setIssues(list);
        noteUnknown(list.filter((i) => i.kind === "spelling").map((i) => i.word));
      });
    }, DELAY);
  }, [ref, spell, predicting, multiline]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onInput = () => refresh();
    const onFocus = () => {
      setFocused(true);
      place();
      refresh();
    };
    const onBlur = () => {
      setTimeout(() => {
        if (document.activeElement === el) return;
        setFocused(false);
        setOpen(false);
        if (predicting && el.value.trim()) learnText(el.value);
      }, 150);
    };
    el.addEventListener("input", onInput);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    el.addEventListener("click", onInput);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("blur", onBlur);
      el.removeEventListener("click", onInput);
    };
  }, [ref, refresh, place, predicting]);

  useEffect(() => {
    if (!focused) return;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [focused, place]);

  const acceptPred = () => {
    const el = ref.current;
    if (!el || !pred) return false;
    const v = el.value;
    const next = v + pred.insert + " ";
    setNativeValue(el, next, next.length);
    setPred(null);
    el.focus();
    return true;
  };
  const replace = (i: Issue, text: string) => {
    const el = ref.current;
    if (!el) return;
    const v = el.value;
    if (v.slice(i.from, i.to) !== i.word) return;
    if (i.kind === "spelling") noteMistake(i.word, text);
    const next = v.slice(0, i.from) + text + v.slice(i.to);
    setNativeValue(el, next, i.from + text.length);
    el.focus();
  };
  const ignore = (i: Issue) => {
    ignored.current.add(i.word.toLocaleLowerCase());
    setIssues((l) => l.filter((x) => x !== i));
  };
  const addWord = (i: Issue) => {
    addKnownWord(i.word);
    void addGlossaryWord(i.word);
    setIssues((l) => l.filter((x) => x.word.toLocaleLowerCase() !== i.word.toLocaleLowerCase()));
  };
  const onKeyDown = (e: KeyboardEvent<El>) => {
    if (e.key === "Tab" && !e.shiftKey && pred && acceptPred()) e.preventDefault();
    else if (e.key === "Escape" && (pred || open)) {
      setPred(null);
      setOpen(false);
    }
  };

  const ready = writingStatus().loaded && (writingStatus().es || writingStatus().en);
  const show = focused && rect && (pred || issues.length);
  const bar = show
    ? createPortal(
        <div className="wf-bar" style={{ left: rect.left, top: rect.top, maxWidth: Math.max(220, rect.width) }} onMouseDown={(e) => e.preventDefault()}>
          {pred && (
            <button type="button" className="wf-pred" onClick={acceptPred} title="Tab to add">
              <span aria-hidden>⇥</span> {pred.word}
            </button>
          )}
          {issues.length > 0 && (
            <button type="button" className="wf-issues" onClick={() => setOpen((o) => !o)}>
              {issues.length} {issues.length === 1 ? "suggestion" : "suggestions"}
            </button>
          )}
          {open && issues.length > 0 && (
            <div className="wf-list">
              {issues.slice(0, 6).map((i) => (
                <IssueRow key={`${i.from}-${i.word}`} issue={i} onReplace={(t) => replace(i, t)} onIgnore={() => ignore(i)} onAdd={() => addWord(i)} />
              ))}
            </div>
          )}
        </div>,
        document.body,
      )
    : null;
  return { onKeyDown, bar, spellCheck: spell && ready ? false : undefined };
}

function IssueRow({ issue, onReplace, onIgnore, onAdd }: { issue: Issue; onReplace: (t: string) => void; onIgnore: () => void; onAdd: () => void }) {
  const spelling = issue.kind === "spelling";
  const [list, setList] = useState<string[] | null>(spelling && !issue.suggestions.length ? null : issue.suggestions);
  useEffect(() => {
    if (!spelling || issue.suggestions.length) return;
    let live = true;
    void suggestWriting(issue.word, issue.lang).then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, [spelling, issue]);
  const label = (s: string) => (s === "" ? "remove" : s === " " ? "one space" : s);
  return (
    <div className="wf-row">
      <p className="wf-msg">
        <b>{issue.word.trim() || "·"}</b> · {issue.message}
      </p>
      <div className="wf-actions">
        {(list ?? []).slice(0, 3).map((s, k) => (
          <button key={`${s}-${k}`} type="button" className="wf-fix" onClick={() => onReplace(s)}>
            {label(s)}
          </button>
        ))}
        {list === null && <span className="wf-faint">…</span>}
        <button type="button" className="wf-link" onClick={onIgnore}>
          Ignore
        </button>
        {spelling && (
          <button type="button" className="wf-link" onClick={onAdd}>
            Add to dictionary
          </button>
        )}
      </div>
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { area: WritingArea };
export const WritingInput = forwardRef<HTMLInputElement, InputProps>(function WritingInput({ area, onKeyDown, spellCheck, ...rest }, outer) {
  const ref = useRef<HTMLInputElement>(null);
  useImperativeHandle(outer, () => ref.current as HTMLInputElement);
  const w = useWriting(ref, area, false);
  return (
    <>
      <input
        {...rest}
        ref={ref}
        spellCheck={w.spellCheck ?? spellCheck}
        onKeyDown={(e) => {
          w.onKeyDown(e);
          if (!e.defaultPrevented) onKeyDown?.(e);
        }}
      />
      {w.bar}
    </>
  );
});

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { area: WritingArea };
export const WritingTextarea = forwardRef<HTMLTextAreaElement, AreaProps>(function WritingTextarea({ area, onKeyDown, spellCheck, ...rest }, outer) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(outer, () => ref.current as HTMLTextAreaElement);
  const w = useWriting(ref, area, true);
  return (
    <>
      <textarea
        {...rest}
        ref={ref}
        spellCheck={w.spellCheck ?? spellCheck}
        onKeyDown={(e) => {
          w.onKeyDown(e);
          if (!e.defaultPrevented) onKeyDown?.(e);
        }}
      />
      {w.bar}
    </>
  );
});
