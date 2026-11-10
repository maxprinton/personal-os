// Template Manager add-on — pure helpers: search, filters, sorting, catalog import planning, file names.
// No server or browser imports, so the tests (scripts/test-file-templates.ts) can load this file directly.
import { FOLDER, GROUPS, LIBRARY_SOURCE, PHASES, TRASH_DAYS } from "./constants";
import type { About, CatalogEntry, CatalogRow, FileTemplate, Filters, Format, Group, Lang, Phase, SortKey } from "./types";

export const EMPTY_FILTERS: Filters = { q: "", phase: "all", grp: "all", format: "all", status: "all", favorites: false };

export function fold(s: string | null | undefined) {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The name to show in a language (Spanish falls back to English). */
export function displayName(t: Pick<FileTemplate, "name" | "name_es">, lang: Lang) {
  return lang === "es" && t.name_es ? t.name_es : t.name;
}

/** The "About" box in a language (falls back to the other language field by field). */
export function aboutIn(t: Pick<FileTemplate, "about">, lang: Lang): About {
  const a = t.about?.[lang] ?? {};
  const b = t.about?.[lang === "es" ? "en" : "es"] ?? {};
  const out: About = {};
  for (const k of ["best", "use", "skip", "value", "vars", "refs"] as const) {
    const v = a[k] || b[k];
    if (v) out[k] = v;
  }
  return out;
}

function haystack(t: FileTemplate) {
  const parts: (string | null | undefined)[] = [t.code, t.name, t.name_es, t.doc_type, t.source, t.notes, ...(t.tags ?? []), ...(t.approaches ?? [])];
  for (const lang of ["en", "es"] as const) {
    const a = t.about?.[lang];
    if (a) parts.push(a.best, a.use, a.skip, a.value, a.vars);
  }
  for (const f of t.tm_files ?? []) parts.push(f.file_name);
  return fold(parts.filter(Boolean).join(" "));
}

/** Every word must appear somewhere (name, code, tags, "About" text, file names), accents and case ignored. */
export function matchesQuery(t: FileTemplate, q: string) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = haystack(t);
  return words.every((w) => hay.includes(w));
}

export function filterTemplates(list: FileTemplate[], f: Filters) {
  return list.filter(
    (t) =>
      (f.phase === "all" || t.phase === f.phase) &&
      (f.grp === "all" || t.grp === f.grp) &&
      (f.format === "all" || t.format === f.format) &&
      (f.status === "all" || t.status === f.status) &&
      (!f.favorites || t.favorite) &&
      matchesQuery(t, f.q),
  );
}

const phaseIndex = (p: Phase | null) => (p ? PHASES.indexOf(p) : PHASES.length);
const groupIndex = (g: Group) => GROUPS.indexOf(g);

/** Natural code order: INI-02 before INI-10; templates without a code go last, by name. */
function codeCompare(a: FileTemplate, b: FileTemplate) {
  if (a.code && b.code) return a.code.localeCompare(b.code, undefined, { numeric: true });
  if (a.code) return -1;
  if (b.code) return 1;
  return a.name.localeCompare(b.name);
}

export function sortTemplates(list: FileTemplate[], sort: SortKey, lang: Lang = "en") {
  const out = [...list];
  if (sort === "name") out.sort((a, b) => displayName(a, lang).localeCompare(displayName(b, lang)));
  else if (sort === "recent") out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  else if (sort === "used") out.sort((a, b) => b.times_used - a.times_used || (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "") || codeCompare(a, b));
  else out.sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase) || groupIndex(a.grp) - groupIndex(b.grp) || codeCompare(a, b));
  return out;
}

/** Groups (already sorted) templates by phase, keeping the order; templates without a phase go to "none". */
export function groupByPhase(list: FileTemplate[]): { phase: Phase | null; items: FileTemplate[] }[] {
  const out: { phase: Phase | null; items: FileTemplate[] }[] = [];
  for (const t of list) {
    const last = out[out.length - 1];
    if (last && last.phase === t.phase) last.items.push(t);
    else out.push({ phase: t.phase, items: [t] });
  }
  return out;
}

const EXT_FORMAT: Record<string, Format> = {
  docx: "docx", doc: "docx", dotx: "docx", odt: "docx", rtf: "docx",
  xlsx: "xlsx", xls: "xlsx", xlsm: "xlsx", xltx: "xlsx", ods: "xlsx",
  pptx: "pptx", ppt: "pptx", potx: "pptx", odp: "pptx",
  pdf: "pdf", csv: "csv", tsv: "csv",
  md: "md", markdown: "md", txt: "md", mmd: "mermaid",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", avif: "image",
};

export function extOf(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export function formatFromName(name: string): Format {
  return EXT_FORMAT[extOf(name)] ?? "other";
}

/** "INI-04 Project Charter.docx" -> "Project Charter"; "risk_register-v2.xlsx" -> "risk register v2". */
export function nameFromFile(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/^[A-Z]{2,4}-\d{2}\s+/, "");
  return base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || name;
}

/** Storage-safe file name (no accents, no spaces), keeping the extension. */
export function safeName(name: string) {
  const clean = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return clean.slice(-90) || "file";
}

export function storagePath(userId: string, templateId: string, lang: Lang | null, fileName: string) {
  return `${userId}/${FOLDER}/${templateId}/${lang ?? "file"}-${safeName(fileName)}`;
}

/** /api/files link for a stored file (opens or, with download=true, downloads it). */
export function fileUrl(path: string, download = false) {
  return `/api/files/${path.split("/").map(encodeURIComponent).join("/")}${download ? "?download" : ""}`;
}

export function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Days left before a trashed template is deleted for good (0 = due now). */
export function trashDaysLeft(deletedAt: string, now = new Date()) {
  const ms = new Date(deletedAt).getTime() + TRASH_DAYS * 86400000 - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

// ------------------------------------------------------------------------------------------ catalog import

const asPhase = (p: string): Phase | null => ((PHASES as string[]).includes(p) ? (p as Phase) : null);
const asGroup = (g: string): Group => ((GROUPS as string[]).includes(g) ? (g as Group) : "other");
const asFormat = (f: string): Format => (["docx", "xlsx", "pptx", "pdf", "csv", "md", "mermaid", "note", "image", "link"].includes(f) ? (f as Format) : "other");

/** Validates catalog.json and turns each entry into the columns the import writes. */
export function catalogRows(json: unknown): { rows: CatalogRow[]; error?: string } {
  const list = (json as { templates?: unknown })?.templates;
  if (!Array.isArray(list)) return { rows: [], error: "catalog.json has no template list. Pick the Template Library folder itself." };
  const rows: CatalogRow[] = [];
  const seen = new Set<string>();
  for (const raw of list as CatalogEntry[]) {
    if (!raw || typeof raw.id !== "string" || !/^[A-Z0-9]{2,4}-\d{2}$/.test(raw.id) || typeof raw.name_en !== "string" || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const about = (l: "en" | "es"): About => {
      const a: About = {};
      for (const k of ["best", "use", "skip", "value", "vars"] as const) {
        const v = (raw as Record<string, unknown>)[`${k}_${l}`];
        if (typeof v === "string" && v.trim()) a[k] = v.trim();
      }
      if (Array.isArray(raw.references) && raw.references.length) a.refs = raw.references.filter((x) => typeof x === "string").join("; ");
      return a;
    };
    rows.push({
      code: raw.id,
      name: raw.name_en.trim(),
      name_es: typeof raw.name_es === "string" && raw.name_es.trim() ? raw.name_es.trim() : null,
      phase: asPhase(raw.phase),
      grp: asGroup(raw.group),
      format: asFormat(raw.format),
      approaches: Array.isArray(raw.approaches) ? raw.approaches.filter((x) => typeof x === "string") : [],
      about: { en: about("en"), es: about("es") },
      source: LIBRARY_SOURCE,
    });
  }
  return rows.length ? { rows } : { rows, error: "catalog.json has no valid templates." };
}

export type PlannedFile = { index: number; code: string; lang: Lang; path: string; name: string };

/** Which picked files belong to which library template: "<anything>/EN|ES/.../INI-04 Name.ext".
 *  Skips the index, readmes, catalog, generator code and anything that does not start with a known code. */
export function planImport(codes: string[], paths: string[]): { files: PlannedFile[]; skipped: string[] } {
  const known = new Set(codes);
  const files: PlannedFile[] = [];
  const skipped: string[] = [];
  paths.forEach((p, index) => {
    const parts = p.replace(/\\/g, "/").split("/");
    const name = parts[parts.length - 1] ?? "";
    const langDir = parts.find((x) => x === "EN" || x === "ES");
    const code = /^([A-Z0-9]{2,4}-\d{2})\s/.exec(name)?.[1];
    if (parts.includes("_generator") || name.startsWith(".") || !langDir || !code || !known.has(code)) {
      if (!/^(catalog\.(json|csv)|README\.md|LEEME\.md|Template Library Index\.xlsx)$/.test(name) && !parts.includes("_generator") && !name.startsWith(".")) skipped.push(p);
      return;
    }
    files.push({ index, code, lang: langDir === "ES" ? "es" : "en", path: p, name });
  });
  return { files, skipped };
}

/** Hex SHA-256 of bytes (Web Crypto; works in browsers and Node 18+). */
export async function sha256Hex(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------------------------------ edits

export type TemplatePatch = Partial<Pick<FileTemplate, "name" | "name_es" | "phase" | "grp" | "format" | "status" | "tags" | "favorite" | "rating" | "source" | "source_url" | "notes" | "doc_type" | "about">>;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const optStr = (v: unknown, max: number) => {
  if (v === null) return null;
  const s = str(v, max);
  return s === undefined ? undefined : s || null;
};

/** Keeps only valid, allowed fields from an edit (anything else is dropped). Returns null if nothing valid is left. */
export function cleanPatch(input: Record<string, unknown>): TemplatePatch | null {
  const p: TemplatePatch = {};
  if ("name" in input) {
    const n = str(input.name, 200);
    if (n) p.name = n;
  }
  if ("name_es" in input) { const v = optStr(input.name_es, 200); if (v !== undefined) p.name_es = v; }
  if ("phase" in input) {
    const v = input.phase;
    if (v === null || v === "") p.phase = null;
    else if (typeof v === "string" && (PHASES as string[]).includes(v)) p.phase = v as Phase;
  }
  if ("grp" in input && typeof input.grp === "string" && (GROUPS as string[]).includes(input.grp)) p.grp = input.grp as Group;
  if ("format" in input && typeof input.format === "string" && asFormat(input.format) === input.format) p.format = input.format as Format;
  if ("format" in input && input.format === "other") p.format = "other";
  if ("status" in input && (input.status === "inbox" || input.status === "reviewed" || input.status === "ready")) p.status = input.status;
  if ("favorite" in input && typeof input.favorite === "boolean") p.favorite = input.favorite;
  if ("rating" in input) {
    const r = input.rating;
    if (r === null || r === "" || r === 0) p.rating = null;
    else if (typeof r === "number" && Number.isInteger(r) && r >= 1 && r <= 5) p.rating = r;
  }
  if ("tags" in input) {
    const raw = Array.isArray(input.tags) ? input.tags : typeof input.tags === "string" ? input.tags.split(",") : null;
    if (raw) {
      const tags: string[] = [];
      for (const x of raw) {
        const t = typeof x === "string" ? x.trim().slice(0, 40) : "";
        if (t && !tags.some((y) => fold(y) === fold(t))) tags.push(t);
        if (tags.length >= 30) break;
      }
      p.tags = tags;
    }
  }
  if ("source" in input) { const v = optStr(input.source, 200); if (v !== undefined) p.source = v; }
  if ("doc_type" in input) { const v = optStr(input.doc_type, 80); if (v !== undefined) p.doc_type = v; }
  if ("notes" in input) { const v = optStr(input.notes, 5000); if (v !== undefined) p.notes = v; }
  if ("source_url" in input) {
    const v = optStr(input.source_url, 500);
    if (v === null) p.source_url = null;
    else if (v && /^https?:\/\/\S+$/i.test(v)) p.source_url = v;
  }
  if ("about" in input && input.about && typeof input.about === "object") {
    const about: { en?: About; es?: About } = {};
    for (const lang of ["en", "es"] as const) {
      const a = (input.about as Record<string, unknown>)[lang];
      if (!a || typeof a !== "object") continue;
      const clean: About = {};
      for (const k of ["best", "use", "skip", "value", "vars", "refs"] as const) {
        const v = str((a as Record<string, unknown>)[k], 2000);
        if (v) clean[k] = v;
      }
      about[lang] = clean;
    }
    p.about = about;
  }
  return Object.keys(p).length ? p : null;
}
