// YouTube add-on — bulk "Ingest" of camera/phone files (pure; Worker B). Spec: editing §1, files §1.
// 1) Paste the file list (plain names, `dir`, `dir /b`, PowerShell `ls`, full paths, Media Pool list).
// 2) Files already named by the convention are matched to their shot; the rest are assigned to shots in
//    order (the order you filmed) → new names V012_S03-05_BR_T2.mp4 with the next free take.
// 3) A Windows script renames them all at once (.bat for double-click, or .ps1), plus "Unmatched".
import { parseShotFileName, shotFileName, splitExt } from "@/lib/youtube/naming";
import type { ShotKind } from "@/lib/youtube/types";

const MEDIA_EXT = /\.(mp4|mov|m4v|mkv|avi|mts|m2ts|mxf|braw|r3d|3gp|webm|wav|mp3|m4a|aac|flac|aif|aiff|png|jpe?g|heic|webp|gif|tiff?|psd|svg)$/i;

/**
 * File names from pasted text, in order, without repeats. Understands:
 *  "C0001.MP4" · "D:\Cam\C0001.MP4" · `dir` lines ("04/11/2026  10:22 a. m.   123.456.789 C0001.MP4") ·
 *  PowerShell `ls` ("-a----  4/11/2026  10:22 AM  123456 C0001.MP4") · quoted names.
 * Folder lines, totals and headers are ignored. Only names with an extension are kept.
 */
export function parseFileList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let line of String(text ?? "").replace(/\r/g, "").split("\n")) {
    line = line.trim().replace(/^["']|["']$/g, "");
    if (!line) continue;
    if (/<DIR>|^Directory of|^Directorio de|^Volume|^El volumen|^Mode\s+LastWriteTime|^-{3,}|File\(s\)|Dir\(s\)|archivos?\b.*bytes|dirs?\b.*libres/i.test(line)) continue;
    let name = line;
    // dir / ls: the name is what follows the size column (a number, maybe with , . or spaces as thousands)
    const dirLine = /^(?:[-dlarhs]{4,6}\s+)?\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[aApP]\.?\s?[mM]\.?)?\s+(?:[\d.,\u00a0\u202f]+\s+)?(.+)$/.exec(line);
    if (dirLine) name = dirLine[1].trim();
    name = name.split(/[\\/]/).pop() ?? "";
    name = name.trim();
    if (!name || !/\.[A-Za-z0-9]{2,5}$/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
export const isMediaFile = (name: string) => MEDIA_EXT.test(name);

export type IngestShot = { id: string; sectionNum: number | null; num: number | null; kind: ShotKind; label?: string };
export type IngestRow = { original: string; shotId: string | null; take: number; newName: string | null; matchedBy: "name" | "order" | "manual" | null };
export type IngestPlan = { rows: IngestRow[]; unmatched: string[] };

/**
 * Builds the rename plan.
 * @param files       pasted names, in filming order
 * @param shots       the shots to fill, in the order they were filmed (usually: missing shots by setup)
 * @param code        the video's V-number
 * @param existingTakes highest take already registered per shot id (clips in the database)
 * @param manual      optional manual choice per file index: shot id, or "" = leave unmatched
 */
export function planIngest(files: string[], shots: IngestShot[], code: string | null, existingTakes: Record<string, number> = {}, manual: Record<number, string> = {}): IngestPlan {
  const takes: Record<string, number> = { ...existingTakes };
  const byKey = new Map(shots.map((s) => [`${s.sectionNum}-${s.num}`, s]));
  const byId = new Map(shots.map((s) => [s.id, s]));
  const rows: IngestRow[] = [];
  // auto order: files that are not already conventional go to shots one by one, skipping shots already taken by name
  const takenByName = new Set<string>();
  const parsed = files.map((f) => parseShotFileName(f));
  parsed.forEach((p) => {
    if (p && (!code || p.code === code.toUpperCase())) {
      const s = byKey.get(`${p.sectionNum}-${p.shotNum}`);
      if (s) takenByName.add(s.id);
    }
  });
  const queue = shots.filter((s) => !takenByName.has(s.id));
  let qi = 0;
  files.forEach((original, i) => {
    const { ext } = splitExt(original);
    let shot: IngestShot | undefined;
    let matchedBy: IngestRow["matchedBy"] = null;
    let take: number | null = null;
    if (i in manual) {
      shot = manual[i] ? byId.get(manual[i]) : undefined;
      matchedBy = shot ? "manual" : null;
    } else {
      const p = parsed[i];
      const s = p && (!code || p.code === code.toUpperCase()) ? byKey.get(`${p.sectionNum}-${p.shotNum}`) : undefined;
      if (s) {
        shot = s;
        matchedBy = "name";
        take = p!.take;
      } else if (qi < queue.length) {
        shot = queue[qi++];
        matchedBy = "order";
      }
    }
    if (!shot) {
      rows.push({ original, shotId: null, take: 0, newName: null, matchedBy: null });
      return;
    }
    const t = take ?? (takes[shot.id] ?? 0) + 1;
    takes[shot.id] = Math.max(takes[shot.id] ?? 0, t);
    rows.push({ original, shotId: shot.id, take: t, newName: shotFileName({ code, sectionNum: shot.sectionNum, shotNum: shot.num, kind: shot.kind, take: t, ext }), matchedBy });
  });
  // two files can't get the same new name: bump the take of repeats
  const used = new Set<string>();
  for (const r of rows) {
    if (!r.newName || !r.shotId) continue;
    while (used.has(r.newName.toLowerCase())) {
      const shot = byId.get(r.shotId)!;
      r.take += 1;
      takes[shot.id] = Math.max(takes[shot.id] ?? 0, r.take);
      r.newName = shotFileName({ code, sectionNum: shot.sectionNum, shotNum: shot.num, kind: shot.kind, take: r.take, ext: splitExt(r.original).ext });
    }
    used.add(r.newName.toLowerCase());
  }
  return { rows, unmatched: rows.filter((r) => !r.shotId).map((r) => r.original) };
}

/** Rows that really need renaming (new name differs). */
export const renameRows = (plan: IngestPlan) => plan.rows.filter((r) => r.newName && r.newName !== r.original);

const batQuote = (s: string) => `"${s.replace(/%/g, "%%").replace(/"/g, "")}"`;
/** Text safe inside a cmd `echo` (special characters escaped with ^, % doubled). */
const batEcho = (s: string) => s.replace(/%/g, "%%").replace(/([&|<>^()])/g, "^$1");
/**
 * Windows .bat (double-click inside the footage folder): renames each file if it is there and the new name
 * is free; prints what it did. CRLF line ends, UTF-8 code page. One simple `if` per line (no blocks), so
 * names with brackets or "&" can't break it.
 */
export function renameBat(plan: IngestPlan, title = "Rename clips"): string {
  const lines = ["@echo off", "chcp 65001 >nul", `title ${batEcho(title)}`, 'cd /d "%~dp0"', "echo Renaming files in %CD%", "echo."];
  for (const r of renameRows(plan)) {
    const a = batQuote(r.original);
    const b = batQuote(r.newName!);
    lines.push(
      `if not exist ${a} echo MISS ${batEcho(r.original)} not found`,
      `if exist ${a} if exist ${b} echo SKIP ${batEcho(r.newName!)} already exists`,
      `if exist ${a} if not exist ${b} ren ${a} ${b}`,
      `if exist ${b} if not exist ${a} echo OK   ${batEcho(r.original)} -^> ${batEcho(r.newName!)}`,
    );
  }
  lines.push("echo.", "echo Done.", "pause");
  return lines.join("\r\n") + "\r\n";
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** PowerShell .ps1 version (Right click → Run with PowerShell, inside the footage folder). */
export function renamePs1(plan: IngestPlan): string {
  const lines = ["# Renames camera files to the YouTube add-on names. Run it inside the footage folder.", "Set-Location -LiteralPath $PSScriptRoot", "$pairs = @("];
  const rows = renameRows(plan);
  rows.forEach((r, i) => lines.push(`  @(${psQuote(r.original)}, ${psQuote(r.newName!)})${i < rows.length - 1 ? "," : ""}`));
  lines.push(
    ")",
    "foreach ($p in $pairs) {",
    "  if (-not (Test-Path -LiteralPath $p[0])) { Write-Host \"MISS $($p[0]) not found\"; continue }",
    "  if (Test-Path -LiteralPath $p[1]) { Write-Host \"SKIP $($p[1]) already exists\"; continue }",
    "  Rename-Item -LiteralPath $p[0] -NewName $p[1]",
    "  Write-Host \"OK   $($p[0]) -> $($p[1])\"",
    "}",
    "Read-Host 'Done. Press Enter to close'",
  );
  return lines.join("\r\n") + "\r\n";
}

/** Plain "old → new" list (for PowerRename or by hand). */
export const renameList = (plan: IngestPlan) => renameRows(plan).map((r) => `${r.original}\t${r.newName}`).join("\n");
