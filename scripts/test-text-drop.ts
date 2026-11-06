// Dropping text files into a note: which files become a plain-text code block, and how their text is cleaned.
import { cleanFileText, isTextFile } from "@/lib/editor/paste";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}
const f = (name: string, type = "") => ({ name, type });

eq("txt by type", isTextFile(f("a.txt", "text/plain")), true);
eq("md without type", isTextFile(f("Notes.MD")), true);
eq("csv", isTextFile(f("data.csv", "text/csv")), true);
eq("json", isTextFile(f("x.json", "application/json")), true);
eq("tsx without type", isTextFile(f("Page.tsx")), true);
eq("python", isTextFile(f("run.py", "text/x-python")), true);
eq("srt subtitles", isTextFile(f("video.srt")), true);
eq("Dockerfile (no dot)", isTextFile(f("Dockerfile")), true);
eq("png is not text", isTextFile(f("a.png", "image/png")), false);
eq("pdf is not text", isTextFile(f("a.pdf", "application/pdf")), false);
eq("docx is not text", isTextFile(f("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")), false);
eq("zip is not text", isTextFile(f("a.zip", "application/zip")), false);
eq("windows line endings", cleanFileText("a\r\nb\rc"), "a\nb\nc");
eq("BOM removed", cleanFileText("﻿hello"), "hello");
eq("trailing newlines removed", cleanFileText("x\n\n\n"), "x");
eq("inner blank lines kept", cleanFileText("a\n\n  b"), "a\n\n  b");
eq("binary detected", cleanFileText("ab\u0000cd"), null);
eq("empty file", cleanFileText(""), "");

console.log(`\ntext-drop: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
