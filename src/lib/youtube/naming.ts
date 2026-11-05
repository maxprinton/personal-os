// YouTube add-on — file & folder naming convention (pure; Worker B). Spec: youtube-files-and-music-spec §1.
//   Folder per video:   "V012 - <short idea name>/01_Footage/A-roll …"
//   Shot file:          V012_S03-05_BR_T2.mp4   (video · section · shot · kind · take)
//   Other files:        V012_X_MU_<desc>.wav · V012_X_SFX_<desc>.wav · V012_X_ST_<desc>.mp4
//   Exports / thumbs:   V012_EXP_rough_2026-11-04.mp4 · V012_THUMB_A.png
// Only letters, numbers, "_" and "-" inside a name part.
import { SHOT_KINDS, SHOT_KIND_IDS, sectionCode } from "@/lib/youtube/constants";
import type { ShotKind } from "@/lib/youtube/types";

/** Placeholder while the idea has no V-number yet. */
export const NO_CODE = "VXXX";

/** "Café con leche!" → "Cafe-con-leche" (letters, numbers, _ and - only; max `max` chars). */
export function safePart(s: string, max = 40): string {
  const out = String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return out.slice(0, max).replace(/[-_]+$/g, "");
}

/** "clip.final.MP4" → { base: "clip.final", ext: ".MP4" } (ext "" when none). */
export function splitExt(name: string): { base: string; ext: string } {
  const n = String(name ?? "");
  const i = n.lastIndexOf(".");
  if (i <= 0 || i === n.length - 1 || /[\\/\s]/.test(n.slice(i + 1))) return { base: n, ext: "" };
  return { base: n.slice(0, i), ext: n.slice(i) };
}

const pad = (n: number, w = 2) => String(Math.max(0, Math.floor(n))).padStart(w, "0");
const codeOf = (code: string | null | undefined) => (code && /^V\d{3,}$/i.test(code) ? code.toUpperCase() : NO_CODE);
const extOf = (ext: string | undefined) => (!ext ? "" : ext.startsWith(".") ? ext : `.${ext}`);

export type ShotNameInput = { code: string | null | undefined; sectionNum: number | null | undefined; shotNum: number | null | undefined; kind: ShotKind; take?: number; ext?: string };

/** "V012_S03-05_BR" (no take). */
export function shotBaseName(i: Omit<ShotNameInput, "take" | "ext">): string {
  return `${codeOf(i.code)}_${sectionCode(i.sectionNum)}-${i.shotNum == null ? "??" : pad(i.shotNum)}_${i.kind}`;
}

/** "V012_S03-05_BR_T2.mp4" — the suggested file name of one take of a shot. */
export function shotFileName(i: ShotNameInput): string {
  return `${shotBaseName(i)}_T${Math.max(1, Math.floor(i.take ?? 1))}${extOf(i.ext)}`;
}

/** Kind of file outside the shot list (X = no section). */
export type ExtraKind = "MU" | "SFX" | "ST" | "VO" | "GR";
/** "V012_X_MU_full.wav" */
export function extraFileName(code: string | null | undefined, kind: ExtraKind, desc: string, ext = ".wav"): string {
  return `${codeOf(code)}_X_${kind}_${safePart(desc) || "untitled"}${extOf(ext)}`;
}
/** Music Lab free track (no video): "ML_<name>.wav" / "ML_<name>_<stem>.wav" */
export const labFileName = (name: string, stem?: string) => `ML_${safePart(stem ? `${name}_${stem}` : name) || "track"}.wav`;
/** Music Lab track: "V012_X_MU_<part>.wav" */
export const musicFileName = (code: string | null | undefined, part: string, stem?: string) =>
  extraFileName(code, "MU", stem ? `${part}_${stem}` : part, ".wav");

/** "V012_EXP_rough_2026-11-04.mp4" */
export function exportFileName(code: string | null | undefined, label: string, date: string, ext = ".mp4"): string {
  return `${codeOf(code)}_EXP_${safePart(label) || "cut"}_${safePart(date)}${extOf(ext)}`;
}
/** "V012_THUMB_A.png" */
export const thumbFileName = (code: string | null | undefined, label: string, ext = ".png") => `${codeOf(code)}_THUMB_${safePart(label) || "A"}${extOf(ext)}`;

/** Folder of a video, same on the PC and on Drive: "V012 - Learn Spanish 30 days" (Windows-safe). */
export function videoFolderName(code: string | null | undefined, ideaName: string): string {
  const name = String(ideaName ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/[\s.]+$/g, "");
  return name ? `${codeOf(code)} - ${name}` : codeOf(code);
}

/** Sub-folder where a shot kind's files go ("01_Footage/B-roll"). */
export const shotFolder = (kind: ShotKind) => SHOT_KINDS.find((k) => k.id === kind)?.folder ?? "01_Footage";

export type ParsedShotName = { code: string; sectionNum: number; shotNum: number; kind: ShotKind; take: number; ext: string };

/**
 * Reads a file name that follows the convention (case-insensitive, any extension, also with " (1)" copies):
 * "V012_S03-05_BR_T2.mp4" → { code V012, sectionNum 3, shotNum 5, kind BR, take 2 }. null = not our convention.
 */
export function parseShotFileName(name: string): ParsedShotName | null {
  const { base, ext } = splitExt(String(name ?? "").trim().split(/[\\/]/).pop() ?? "");
  const m = /^(V\d{3,})_S(\d{1,2})-(\d{1,3})_([A-Za-z]{2})(?:_T(\d{1,3}))?\b/i.exec(base);
  if (!m) return null;
  const kind = m[4].toUpperCase() as ShotKind;
  if (!SHOT_KIND_IDS.includes(kind)) return null;
  return { code: m[1].toUpperCase(), sectionNum: Number(m[2]), shotNum: Number(m[3]), kind, take: m[5] ? Math.max(1, Number(m[5])) : 1, ext };
}

/** True when the whole base name (without extension) only uses letters, numbers, "_" and "-". */
export const isSafeFileName = (name: string) => /^[A-Za-z0-9_-]+$/.test(splitExt(name).base);
