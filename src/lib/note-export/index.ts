// Exporting and copying notes: one or many, in Markdown, PDF, Word, plain text, HTML or Mermaid.
// Everything happens in the browser (instant, works offline). Many notes = one file with all of them,
// or a ZIP with one file per note.
import { createZip, type ZipEntry } from "@/lib/zip";
import { noteTitle, type ExportNote } from "./model";
import { noteMarkdown, notesHtmlFragment, notesHtmlPage, notesMarkdown, notesMermaid, notesText } from "./text";
import { notesPdf } from "./pdf";
import { notesDocx } from "./docx";

export type { ExportNote } from "./model";

import { FORMATS, type CopyKind, type ExportFormat } from "./formats";

export { FORMATS, COPY_KINDS, type CopyKind, type ExportFormat } from "./formats";

const MIME: Record<ExportFormat, string> = {
  md: "text/markdown;charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain;charset=utf-8",
  html: "text/html;charset=utf-8",
  mmd: "text/plain;charset=utf-8",
};

/** A file name Windows, macOS and phones accept (accents are kept). */
export function fileName(title: string) {
  return (
    title
      .normalize("NFC")
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s.]+|[\s.]+$/g, "")
      .slice(0, 80)
      .trim() || "Untitled"
  );
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function render(notes: ExportNote[], format: ExportFormat): string | Uint8Array {
  switch (format) {
    case "md":
      return notesMarkdown(notes);
    case "pdf":
      return notesPdf(notes);
    case "docx":
      return notesDocx(notes);
    case "txt":
      return notesText(notes);
    case "html":
      return notesHtmlPage(notes);
    case "mmd":
      return notesMermaid(notes);
  }
}

export type ExportFile = { name: string; data: string | Uint8Array; mime: string };

/** zip: one file per note inside a .zip (only matters with 2+ notes). */
export function buildExport(notes: ExportNote[], format: ExportFormat, zip = false): ExportFile {
  const ext = FORMATS.find((f) => f.id === format)!.ext;
  if (notes.length === 1) return { name: `${fileName(noteTitle(notes[0]))}.${ext}`, data: render(notes, format), mime: MIME[format] };
  if (!zip) return { name: `Notes ${today()} (${notes.length}).${ext}`, data: render(notes, format), mime: MIME[format] };
  const used = new Set<string>();
  const entries: ZipEntry[] = notes.map((n) => {
    const base = fileName(noteTitle(n));
    let name = `${base}.${ext}`;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base} (${k}).${ext}`;
    used.add(name.toLowerCase());
    return { name, content: render([n], format) };
  });
  return { name: `Notes ${today()} (${notes.length} ${FORMATS.find((f) => f.id === format)!.label}).zip`, data: createZip(entries), mime: "application/zip" };
}

/** Starts the download in the browser (.txt gets a BOM so Windows Notepad reads accents right). */
export function downloadFile(f: ExportFile) {
  const part: BlobPart = typeof f.data === "string" ? (f.name.endsWith(".txt") ? "\ufeff" + f.data : f.data) : (f.data as Uint8Array<ArrayBuffer>);
  const url = URL.createObjectURL(new Blob([part], { type: f.mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---------- Clipboard ----------

/** What goes to the clipboard: always plain text; "rich" also carries HTML for apps that read it. */
export function buildCopy(notes: ExportNote[], kind: CopyKind): { text: string; html?: string } {
  switch (kind) {
    case "rich":
      return { text: notes.length === 1 ? noteMarkdown(notes[0]) : notesMarkdown(notes), html: notesHtmlFragment(notes) };
    case "md":
      return { text: notesMarkdown(notes) };
    case "txt":
      return { text: notesText(notes, false) };
    case "html":
      return { text: notesHtmlFragment(notes) };
    case "mmd":
      return { text: notesMermaid(notes) };
  }
}

/** Copies right away (call it from the click itself). */
export async function writeClipboard(c: { text: string; html?: string }): Promise<boolean> {
  try {
    if (c.html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([c.text], { type: "text/plain" }),
          "text/html": new Blob([c.html], { type: "text/html" }),
        }),
      ]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(c.text);
      return true;
    }
  } catch {
    // falls back below (old browsers, or http instead of https)
  }
  return legacyCopy(c);
}

function legacyCopy(c: { text: string; html?: string }) {
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData("text/plain", c.text);
    if (c.html) e.clipboardData?.setData("text/html", c.html);
    e.preventDefault();
  };
  const ta = document.createElement("textarea");
  ta.value = c.text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.addEventListener("copy", onCopy);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.removeEventListener("copy", onCopy);
  ta.remove();
  return ok;
}
