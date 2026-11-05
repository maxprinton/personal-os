// Shot list, filming mode, missing-shots backlog and teleprompter — pure helpers (Worker B; no React, no DB).
// Spec: youtube-outline-script-shotlist-spec §4, youtube-intro-spec (pickups), youtube-shorts-spec (VT shots).
import { SHOT_KINDS, SHOT_KIND_IDS, sectionCode } from "@/lib/youtube/constants";
import { shotFileName } from "@/lib/youtube/naming";
import type { ShotKind } from "@/lib/youtube/types";

/** Vertical shots (Shorts) are filmed together: phone on a second tripod. */
export const VERTICAL_SETUP = "Vertical · phone on 2nd tripod";
export const NO_SETUP = "No setup yet";
/** Stages where filming has started: a shot added now is a pickup (re-shoot session). */
export const PICKUP_STAGES = ["filming", "edit", "publish", "published"] as const;

export const kindLabel = (k: ShotKind) => SHOT_KINDS.find((x) => x.id === k)?.label ?? k;
export const isShotKind = (k: unknown): k is ShotKind => typeof k === "string" && (SHOT_KIND_IDS as string[]).includes(k);

type SetupLike = { kind: ShotKind; setup?: string | null; location?: string | null };

/** The filming group of a shot: "Desk · Home office", the vertical setup for VT shots, or "No setup yet". */
export function setupKey(s: SetupLike): string {
  if (s.kind === "VT") return VERTICAL_SETUP;
  const parts: string[] = [];
  for (const raw of [s.setup, s.location]) {
    const t = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (t && !parts.some((p) => p.toLowerCase() === t.toLowerCase())) parts.push(t);
  }
  return parts.length ? parts.join(" · ") : NO_SETUP;
}

export type SetupGroup<T> = { key: string; shots: T[]; done: number; total: number };

/**
 * Groups shots by setup (in the order the shots come, usually script order). "No setup yet" goes last,
 * the vertical setup just before it. Groups with nothing left to film go after the others.
 */
export function groupBySetup<T extends SetupLike & { done: boolean }>(shots: T[]): SetupGroup<T>[] {
  const map = new Map<string, T[]>();
  const names = new Map<string, string>(); // case-insensitive: "desk" joins "Desk" (first spelling wins)
  for (const s of shots) {
    const k0 = setupKey(s);
    const low = k0.toLowerCase();
    if (!names.has(low)) names.set(low, k0);
    const k = names.get(low)!;
    const list = map.get(k);
    if (list) list.push(s);
    else map.set(k, [s]);
  }
  const rank = (g: SetupGroup<T>) => (g.done === g.total ? 10 : 0) + (g.key === NO_SETUP ? 2 : g.key === VERTICAL_SETUP ? 1 : 0);
  return [...map.entries()]
    .map(([key, list]) => ({ key, shots: list, done: list.filter((s) => s.done).length, total: list.length }))
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map((x) => x.g);
}

/** Next free shot number inside a section (1, 2, 3…; numbers are never reused while the shot exists). */
export function nextShotNum(shots: { section_id: string | null; num: number | null }[], sectionId: string | null): number {
  return shots.filter((s) => s.section_id === sectionId).reduce((m, s) => Math.max(m, s.num ?? 0), 0) + 1;
}

type OrderShot = { section_id: string | null; para_hash: string | null; block_id: string | null; position: number; num?: number | null };
export type SectionOrder = { id: string; paragraphs: { idx: number; hash: string; blockId: string | null }[] };

/**
 * Script order: by section (as given), then by the line the shot covers (current text, else the same editor
 * block), then position. Shots of unknown sections go last.
 */
export function sortShots<T extends OrderShot>(shots: T[], sections: SectionOrder[]): T[] {
  const secIdx = new Map(sections.map((s, i) => [s.id, i]));
  const paraIdx = new Map<string, number>();
  for (const s of sections)
    for (const p of s.paragraphs) {
      if (!paraIdx.has(`${s.id}|h|${p.hash}`)) paraIdx.set(`${s.id}|h|${p.hash}`, p.idx);
      if (p.blockId && !paraIdx.has(`${s.id}|b|${p.blockId}`)) paraIdx.set(`${s.id}|b|${p.blockId}`, p.idx);
    }
  const lineOf = (s: T) => {
    if (!s.section_id) return 1e6;
    return (s.para_hash ? paraIdx.get(`${s.section_id}|h|${s.para_hash}`) : undefined) ?? (s.block_id ? paraIdx.get(`${s.section_id}|b|${s.block_id}`) : undefined) ?? 1e6;
  };
  return shots
    .map((s, i) => ({ s, i, sec: s.section_id ? secIdx.get(s.section_id) ?? 1e6 : 1e6, line: lineOf(s) }))
    .sort((a, b) => a.sec - b.sec || a.line - b.line || a.s.position - b.s.position || (a.s.num ?? 0) - (b.s.num ?? 0) || a.i - b.i)
    .map((x) => x.s);
}

/** "V012_S03-05_BR_T2" (+ ext) for one shot. */
export function shotName(code: string | null | undefined, sectionNum: number | null | undefined, shot: { num: number | null; kind: ShotKind }, take = 1, ext = ""): string {
  return shotFileName({ code, sectionNum, shotNum: shot.num, kind: shot.kind, take, ext });
}

/** "S03-05" — the short id of a shot on screen. */
export const shotTag = (sectionNum: number | null | undefined, num: number | null) => `${sectionCode(sectionNum)}-${num == null ? "??" : String(num).padStart(2, "0")}`;

/** "wide · eye level · slow push" */
export const cameraSummary = (s: { framing?: string | null; angle?: string | null; movement?: string | null }) =>
  [s.framing, s.angle, s.movement].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ");

/** "mug, notebook · soft window light · blue shirt" */
export const setupSummary = (s: { props?: string | null; lighting?: string | null; outfit?: string | null }) =>
  [s.props, s.lighting, s.outfit].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ");

/** Clean text field: trimmed, max `max` chars, empty → null. */
export function cleanText(v: unknown, max = 500): string | null {
  const t = String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
  return t ? t : null;
}
/** Seconds 0–3600 (null when empty / not a number). */
export function cleanSeconds(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(3600, Math.round(n * 10) / 10);
}

// ----- ✨ AI suggestions -------------------------------------------------------------------------------
export type AiLine = { key: string; section_id: string; para_hash: string; block_id: string | null; text: string; code: string };
export type ShotSuggestion = { key: string; section_id: string; para_hash: string; block_id: string | null; line_text: string; kind: ShotKind; description: string; duration_s: number | null };
/** Kinds the AI may suggest (A-roll already exists for every line). */
export const AI_KINDS: ShotKind[] = ["BR", "SC", "GR", "ST", "VT"];

/** The lines the AI sees: "[p3] S02 · text", cut so the whole list fits in `maxChars`. */
export function aiLinesText(lines: AiLine[], maxChars: number): string {
  const per = Math.max(80, Math.floor(maxChars / Math.max(1, lines.length)) - 16);
  let out = "";
  for (const l of lines) {
    const row = `[${l.key}] ${l.code} · ${l.text.replace(/\s+/g, " ").slice(0, per)}\n`;
    if (out.length + row.length > maxChars) break;
    out += row;
  }
  return out;
}

/**
 * Reads the AI answer {"shots":[{"p":"p3","kind":"BR","description":"…","duration_s":4}]}: only known lines,
 * only AI_KINDS, max 2 per line, no repeats of the same description on a line, max `limit` in total.
 */
export function parseAiShots(json: unknown, lines: AiLine[], existing: { para_hash: string | null; description: string | null }[] = [], limit = 40): ShotSuggestion[] {
  const arr = Array.isArray(json) ? json : Array.isArray((json as { shots?: unknown })?.shots) ? ((json as { shots: unknown[] }).shots as unknown[]) : [];
  const byKey = new Map(lines.map((l) => [l.key.toLowerCase(), l]));
  const seen = new Set(existing.filter((e) => e.para_hash && e.description).map((e) => `${e.para_hash}|${e.description!.trim().toLowerCase()}`));
  const perLine = new Map<string, number>();
  const out: ShotSuggestion[] = [];
  for (const raw of arr) {
    if (out.length >= limit) break;
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const key = String(r.p ?? r.line ?? r.key ?? "").replace(/[[\]\s]/g, "").toLowerCase();
    const line = byKey.get(key) ?? byKey.get(`p${key}`);
    if (!line) continue;
    const kind = String(r.kind ?? "").toUpperCase().trim();
    if (!(AI_KINDS as string[]).includes(kind)) continue;
    const description = String(r.description ?? r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!description) continue;
    const dupKey = `${line.para_hash}|${description.toLowerCase()}`;
    if (seen.has(dupKey)) continue;
    const n = perLine.get(line.para_hash) ?? 0;
    if (n >= 2) continue;
    seen.add(dupKey);
    perLine.set(line.para_hash, n + 1);
    const d = Number(r.duration_s ?? r.seconds);
    out.push({
      key: `${line.key}-${out.length}`,
      section_id: line.section_id,
      para_hash: line.para_hash,
      block_id: line.block_id,
      line_text: line.text.slice(0, 2000),
      kind: kind as ShotKind,
      description,
      duration_s: Number.isFinite(d) && d > 0 ? Math.min(60, Math.round(d)) : null,
    });
  }
  return out;
}

// ----- Backlog filters --------------------------------------------------------------------------------
export type BacklogFilter = { setup?: string | null; location?: string | null; kind?: ShotKind | null; video?: string | null; pickupsOnly?: boolean; q?: string | null };
type BacklogShot = SetupLike & { video_id: string; is_pickup: boolean; description?: string | null; line_text?: string | null };

/** Filters the missing-shots backlog (setup / location are matched case-insensitively). */
export function filterBacklog<T extends BacklogShot>(shots: T[], f: BacklogFilter): T[] {
  const low = (x: string | null | undefined) => String(x ?? "").trim().toLowerCase();
  const q = low(f.q);
  return shots.filter(
    (s) =>
      (!f.setup || low(setupKey(s)) === low(f.setup)) &&
      (!f.location || low(s.location) === low(f.location)) &&
      (!f.kind || s.kind === f.kind) &&
      (!f.video || s.video_id === f.video) &&
      (!f.pickupsOnly || s.is_pickup) &&
      (!q || low(s.description).includes(q) || low(s.line_text).includes(q) || low(s.setup).includes(q) || low(s.location).includes(q)),
  );
}

/** Distinct non-empty values (case-insensitive, first spelling wins), sorted. */
export function distinctValues(values: (string | null | undefined)[]): string[] {
  const m = new Map<string, string>();
  for (const v of values) {
    const t = String(v ?? "").replace(/\s+/g, " ").trim();
    if (t && !m.has(t.toLowerCase())) m.set(t.toLowerCase(), t);
  }
  return [...m.values()].sort((a, b) => a.localeCompare(b));
}
