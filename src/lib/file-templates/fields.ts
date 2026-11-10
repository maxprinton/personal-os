// Template Manager, phase 3 — what a project profile holds and how its values become template text.
// Pure (no server or browser imports): used by the fill engine, the profile editor and the tests.
import type { Lang } from "./types";

/** A text value in English and/or Spanish. */
export type Bi = { en?: string; es?: string };

export type ProfileData = {
  scalars: Record<string, Bi>;
  lists: Record<string, Bi[]>;
  tables: Record<string, Record<string, Bi>[]>;
};

export type FieldKind = "text" | "long" | "date" | "money" | "list" | "table";
export type FieldGroup = "core" | "people" | "plan" | "auto";

export type ColumnDef = { key: string; label: Record<Lang, string>; kind?: "text" | "date"; aliases: string[] };

export type FieldDef = {
  key: string;
  label: Record<Lang, string>;
  group: FieldGroup;
  kind: FieldKind;
  /** Text that is usually different in English and Spanish (names, goals, plans). */
  bilingual?: boolean;
  /** Words that, written in a template, mean this field ("Project name", "Nombre del proyecto"...). */
  aliases: string[];
  /** Words near a table that point to this field ("Stakeholders", "Equipo"...). */
  context?: string[];
  columns?: ColumnDef[];
  hint?: Record<Lang, string>;
  /** The AI can draft it from the rest of the profile. */
  draftable?: boolean;
};

const c = (key: string, en: string, es: string, aliases: string[], kind?: "date"): ColumnDef => ({ key, label: { en, es }, aliases, kind });

export const FIELD_DEFS: FieldDef[] = [
  // ---------------------------------------------------------------- core
  { key: "project_name", label: { en: "Project name", es: "Nombre del proyecto" }, group: "core", kind: "text", bilingual: true,
    aliases: ["project name", "project title", "name of project", "nombre del proyecto", "titulo del proyecto", "proyecto", "project", "insert project name"] },
  { key: "project_code", label: { en: "Project code", es: "Código del proyecto" }, group: "core", kind: "text",
    aliases: ["project code", "project id", "project number", "project no", "codigo del proyecto", "codigo", "id del proyecto"] },
  { key: "project_goal", label: { en: "Goal (one line)", es: "Objetivo (una línea)" }, group: "core", kind: "long", bilingual: true, draftable: true,
    aliases: ["project goal", "goal", "goal statement", "project objective", "purpose", "objetivo del proyecto", "objetivo general", "proposito"],
    hint: { en: "One measurable sentence: what changes, by how much, by when.", es: "Una oración medible: qué cambia, cuánto y para cuándo." } },
  { key: "organization", label: { en: "Organization", es: "Organización" }, group: "core", kind: "text",
    aliases: ["organization", "organisation", "company", "department", "agency", "organizacion", "empresa", "departamento", "institucion", "insert department name"] },
  { key: "sponsor", label: { en: "Sponsor", es: "Patrocinador/a" }, group: "core", kind: "text",
    aliases: ["sponsor", "project sponsor", "executive sponsor", "patrocinador", "patrocinadora", "patrocinador del proyecto"] },
  { key: "project_manager", label: { en: "Project manager", es: "Director/a del proyecto" }, group: "core", kind: "text",
    aliases: ["project manager", "pm", "project lead", "director del proyecto", "directora del proyecto", "gerente del proyecto", "jefe de proyecto", "lider del proyecto"] },
  { key: "customer", label: { en: "Customer / end user", es: "Cliente / usuario final" }, group: "core", kind: "text", bilingual: true,
    aliases: ["customer", "client", "end user", "end users", "cliente", "usuario final", "usuarios"] },
  { key: "approach", label: { en: "Delivery approach", es: "Enfoque de entrega" }, group: "core", kind: "text", bilingual: true,
    aliases: ["approach", "delivery approach", "methodology", "method", "enfoque", "metodologia", "enfoque de entrega"] },
  { key: "start_date", label: { en: "Start date", es: "Fecha de inicio" }, group: "core", kind: "date",
    aliases: ["start date", "project start", "start", "fecha de inicio", "inicio", "inicio del proyecto"] },
  { key: "end_date", label: { en: "End date", es: "Fecha de fin" }, group: "core", kind: "date",
    aliases: ["end date", "finish date", "completion date", "due date", "project end", "fecha de fin", "fecha de finalizacion", "fecha de cierre", "fin"] },
  { key: "budget", label: { en: "Budget", es: "Presupuesto" }, group: "core", kind: "money",
    aliases: ["budget", "total budget", "summary budget", "budget summary", "resumen del presupuesto", "approved budget", "estimated budget", "presupuesto", "presupuesto total", "presupuesto aprobado"],
    hint: { en: "With currency, e.g. USD 12,000", es: "Con moneda, p. ej. USD 12.000" } },
  { key: "prepared_by", label: { en: "Prepared by", es: "Elaborado por" }, group: "core", kind: "text",
    aliases: ["prepared by", "author", "written by", "submitted by", "elaborado por", "preparado por", "autor", "redactado por"] },
  // ---------------------------------------------------------------- automatic
  { key: "date", label: { en: "Today's date", es: "Fecha de hoy" }, group: "auto", kind: "date", aliases: ["date", "fecha", "today", "hoy", "mm dd yyyy", "dd mm yyyy", "issue date"] },
  { key: "version", label: { en: "Document version", es: "Versión del documento" }, group: "auto", kind: "text", aliases: ["version", "version number", "document version", "numero de version"] },
  // ---------------------------------------------------------------- people
  { key: "team", label: { en: "Team", es: "Equipo" }, group: "people", kind: "table", context: ["team", "equipo", "members", "integrantes", "roles"],
    aliases: ["team", "team members", "team and roles", "roles and responsibilities", "project team", "equipo", "integrantes del equipo", "equipo y roles", "roles y responsabilidades", "equipo del proyecto"],
    columns: [c("name", "Name", "Nombre", ["name", "team member", "member", "nombre", "integrante", "person", "persona"]),
              c("role", "Role", "Rol", ["role", "rol", "responsibility", "responsabilidad", "position", "cargo"]),
              c("email", "Email", "Correo", ["email", "e mail", "contact", "correo", "contacto"])] },
  { key: "stakeholders", label: { en: "Stakeholders", es: "Interesados" }, group: "people", kind: "table", context: ["stakeholder", "interesad", "involucrad"],
    aliases: ["stakeholders", "key stakeholders", "interesados", "interesados clave"],
    columns: [c("name", "Name / group", "Nombre / grupo", ["name group", "stakeholder", "name", "nombre grupo", "interesado", "nombre"]),
              c("role", "Role / organization", "Rol / organización", ["role organization", "role or interest", "role", "rol organizacion", "rol o interes", "rol"]),
              c("interest", "Interest", "Interés", ["interest in the project", "interest", "interes en el proyecto", "interes"]),
              c("influence", "Influence", "Influencia", ["influence", "influencia"])] },
  // ---------------------------------------------------------------- plan
  { key: "objectives", label: { en: "Objectives", es: "Objetivos" }, group: "plan", kind: "table", draftable: true, context: ["objective", "objetivo"],
    aliases: ["objectives", "project objectives", "objetivos"],
    columns: [c("objective", "Objective", "Objetivo", ["objective", "objetivo"]),
              c("measure", "Measure of success", "Medida de éxito", ["measure of success", "measure", "metric", "kpi", "medida de exito", "medida", "metrica"]),
              c("target", "Target", "Meta", ["target", "meta"]),
              c("due", "By when", "Para cuándo", ["by when", "due", "due date", "para cuando"], "date")] },
  { key: "scope_in", label: { en: "In scope", es: "Dentro del alcance" }, group: "plan", kind: "list", bilingual: true, draftable: true,
    aliases: ["in scope", "scope", "included", "inclusions", "dentro del alcance", "dentro", "incluido", "alcance"] },
  { key: "scope_out", label: { en: "Out of scope", es: "Fuera del alcance" }, group: "plan", kind: "list", bilingual: true, draftable: true,
    aliases: ["out of scope", "excluded", "exclusions", "not in scope", "fuera del alcance", "fuera", "excluido", "exclusiones"] },
  { key: "milestones", label: { en: "Milestones", es: "Hitos" }, group: "plan", kind: "table", draftable: true, context: ["milestone", "hito", "schedule", "cronograma"],
    aliases: ["milestones", "key milestones", "summary milestones", "hitos", "hitos resumidos"],
    columns: [c("name", "Milestone", "Hito", ["milestone", "task milestone", "hito", "tarea hito", "deliverable", "entregable"]),
              c("date", "Date", "Fecha", ["target date", "date", "due", "end", "finish", "start", "baseline date", "fecha objetivo", "fecha", "fin", "inicio"], "date")] },
  { key: "risks", label: { en: "Top risks", es: "Riesgos principales" }, group: "plan", kind: "table", draftable: true, context: ["risk", "riesgo"],
    aliases: ["risks", "high level risks", "key risks", "riesgos de alto nivel", "riesgos clave", "top risks", "riesgos", "riesgos principales"],
    columns: [c("risk", "Risk", "Riesgo", ["risk", "risk description", "riesgo", "descripcion del riesgo", "risk issue"]),
              c("owner", "Owner", "Responsable", ["owner", "risk owner", "responsable"]),
              c("response", "Response", "Respuesta", ["response actions", "mitigation", "mitigation actions", "response plan", "acciones de respuesta", "mitigacion", "plan de respuesta"])] },
  { key: "success_criteria", label: { en: "Success criteria", es: "Criterios de éxito" }, group: "plan", kind: "list", bilingual: true, draftable: true,
    aliases: ["success criteria", "acceptance criteria", "success measures", "measures of success", "criterios de exito", "criterios de aceptacion", "medidas de exito"] },
  { key: "assumptions", label: { en: "Assumptions", es: "Supuestos" }, group: "plan", kind: "list", bilingual: true, draftable: true,
    aliases: ["assumptions", "assumption", "supuestos", "supuesto"] },
  { key: "constraints", label: { en: "Constraints", es: "Restricciones" }, group: "plan", kind: "list", bilingual: true, draftable: true,
    aliases: ["constraints", "constraint", "restricciones", "restriccion"] },
];

export const FIELD = Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f])) as Record<string, FieldDef>;
export const SCALAR_KEYS = FIELD_DEFS.filter((f) => f.kind !== "list" && f.kind !== "table").map((f) => f.key);
export const LIST_KEYS = FIELD_DEFS.filter((f) => f.kind === "list").map((f) => f.key);
export const TABLE_KEYS = FIELD_DEFS.filter((f) => f.kind === "table").map((f) => f.key);
/** Fields kept in "My details" and copied into every new profile. */
export const DEFAULT_KEYS = ["organization", "project_manager", "prepared_by", "sponsor", "approach"];

export function fold(s: string | null | undefined) {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** "Interest (1-5)" -> "interest"; "Risk (cause → event → effect)" -> "risk"; "Name:" -> "name". */
export function cleanLabel(s: string) {
  return fold(s.replace(/\([^)]*\)/g, " ").replace(/[:：*]+\s*$/, ""));
}

/** Headers like "Power (1-5)" are scores, never filled with text. */
export function isScaleHeader(s: string) {
  return /\(\s*\d+\s*[-–]\s*\d+\s*[^)]*\)/.test(s);
}

/** Which field a label means (exact alias after cleaning), or null. */
export function fieldForLabel(label: string): string | null {
  const l = cleanLabel(label);
  if (!l || l.length > 40) return null;
  for (const f of FIELD_DEFS) if (f.kind !== "table" && f.aliases.includes(l)) return f.key;
  return null;
}

export function emptyProfile(): ProfileData {
  return { scalars: {}, lists: {}, tables: {} };
}

/** Accepts anything (from the database or a form) and returns a clean profile. */
export function cleanProfile(input: unknown): ProfileData {
  const out = emptyProfile();
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const bi = (v: unknown, max = 2000): Bi | null => {
    if (typeof v === "string") return v.trim() ? { en: v.trim().slice(0, max) } : null;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const r: Bi = {};
    if (typeof o.en === "string" && o.en.trim()) r.en = o.en.trim().slice(0, max);
    if (typeof o.es === "string" && o.es.trim()) r.es = o.es.trim().slice(0, max);
    return r.en || r.es ? r : null;
  };
  const scalars = (src.scalars ?? {}) as Record<string, unknown>;
  for (const k of SCALAR_KEYS) {
    const v = bi(scalars[k], FIELD[k].kind === "long" ? 2000 : 300);
    if (v) out.scalars[k] = v;
  }
  const lists = (src.lists ?? {}) as Record<string, unknown>;
  for (const k of LIST_KEYS) {
    const arr = Array.isArray(lists[k]) ? (lists[k] as unknown[]) : [];
    const items = arr.map((x) => bi(x, 500)).filter((x): x is Bi => !!x).slice(0, 50);
    if (items.length) out.lists[k] = items;
  }
  const tables = (src.tables ?? {}) as Record<string, unknown>;
  for (const k of TABLE_KEYS) {
    const arr = Array.isArray(tables[k]) ? (tables[k] as unknown[]) : [];
    const rows: Record<string, Bi>[] = [];
    for (const r of arr.slice(0, 100)) {
      if (!r || typeof r !== "object") continue;
      const row: Record<string, Bi> = {};
      for (const col of FIELD[k].columns ?? []) {
        const v = bi((r as Record<string, unknown>)[col.key], 500);
        if (v) row[col.key] = v;
      }
      if (Object.keys(row).length) rows.push(row);
    }
    if (rows.length) out.tables[k] = rows;
  }
  return out;
}

/** The value in a language, falling back to the other one. */
export function pick(v: Bi | undefined, lang: Lang) {
  if (!v) return "";
  return (lang === "es" ? v.es || v.en : v.en || v.es) ?? "";
}

/** Everything a template can receive, already in one language. */
export type Values = {
  lang?: Lang;
  scalars: Record<string, string>;
  lists: Record<string, string[]>;
  tables: Record<string, Record<string, string>[]>;
};

export function resolveValues(p: ProfileData, lang: Lang, opts: { today?: string; version?: string; answers?: Record<string, string> } = {}): Values {
  const scalars: Record<string, string> = {};
  for (const k of SCALAR_KEYS) {
    const v = pick(p.scalars[k], lang);
    if (v) scalars[k] = v;
  }
  scalars.date = opts.today ?? new Date().toISOString().slice(0, 10);
  scalars.version = scalars.version || opts.version || "1.0";
  for (const [k, v] of Object.entries(opts.answers ?? {})) if (v && v.trim()) scalars[k] = v.trim();
  const lists: Record<string, string[]> = {};
  for (const k of LIST_KEYS) {
    const items = (p.lists[k] ?? []).map((x) => pick(x, lang)).filter(Boolean);
    if (items.length) lists[k] = items;
  }
  const tables: Record<string, Record<string, string>[]> = {};
  for (const k of TABLE_KEYS) {
    const rows = (p.tables[k] ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([ck, v]) => [ck, pick(v, lang)]).filter(([, v]) => v)) as Record<string, string>).filter((r) => Object.keys(r).length);
    if (rows.length) tables[k] = rows;
  }
  return { lang, scalars, lists, tables };
}

/** A field as one piece of text (lists become bullet lines, tables become "a — b" lines). */
export function valueText(v: Values, key: string): string {
  if (v.scalars[key]) return v.scalars[key];
  if (v.lists[key]) return v.lists[key].map((x) => `• ${x}`).join("\n");
  if (v.tables[key]) {
    const cols = FIELD[key]?.columns ?? [];
    return v.tables[key].map((r) => cols.map((col) => r[col.key]).filter(Boolean).join(" — ")).join("\n");
  }
  return "";
}

/** A flat snapshot of what a fill used (to spot copies that are out of date after a profile change). */
export function snapshot(v: Values, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of [...new Set(keys)].sort()) if (k !== "date" && k !== "version") out[k] = valueText(v, k.startsWith("ask:") ? "" : k) || (k.startsWith("ask:") ? v.scalars[k] ?? "" : "");
  return out;
}

/** Which keys of an old snapshot now have a different value. */
export function changedKeys(old: Record<string, string> | null | undefined, now: Record<string, string>) {
  if (!old) return [];
  return Object.keys(old).filter((k) => !k.startsWith("ask:") && (old[k] ?? "") !== (now[k] ?? ""));
}

export function labelOf(key: string, lang: Lang = "en") {
  if (key.startsWith("ask:")) return key.slice(4);
  return FIELD[key]?.label[lang] ?? key;
}

/** Which fields a section heading means: "9. High-level risks" -> [risks]; "Assumptions and constraints" ->
 *  [assumptions, constraints]; "Scope" -> [scope_in, scope_out]. Null when any part is unknown. */
export function fieldsForHeading(heading: string): string[] | null {
  const text = heading.replace(/^\s*(?:\d+(?:\.\d+)*\.?|[A-Z]\.|[ivx]+\.)\s+/i, "");
  const l = cleanLabel(text);
  if (!l || l.length > 50) return null;
  const one = (x: string) => FIELD_DEFS.find((f) => f.group !== "auto" && f.aliases.includes(x))?.key ?? null;
  if (l === "scope" || l === "alcance" || l === "scope and deliverables" || l === "alcance y entregables") return ["scope_in", "scope_out"];
  const whole = one(l);
  if (whole) return [whole];
  const parts = l.split(/\s+(?:and|y|e)\s+|\s*&\s*/).filter(Boolean);
  if (parts.length < 2) return null;
  const keys = parts.map(one);
  return keys.every(Boolean) ? [...new Set(keys as string[])] : null;
}

/** The text a section gets: one field as is; several fields each under its own label. */
export function sectionText(v: Values, fields: string[]): string {
  if (fields.length === 1) return valueText(v, fields[0]);
  const lang = v.lang ?? "en";
  return fields
    .map((k) => [k, valueText(v, k)] as const)
    .filter(([, t]) => t)
    .map(([k, t]) => `${labelOf(k, lang)}:\n${t}`)
    .join("\n");
}

// ------------------------------------------------------------------------------------------ editing helpers

/** Does this value change with the language? (Names, emails, dates and money don't.) */
export function isBilingual(key: string, col?: string) {
  const f = FIELD[key];
  if (!f) return false;
  if (f.kind === "table") {
    const c = f.columns?.find((x) => x.key === col);
    return !!c && c.kind !== "date" && !["name", "email", "owner"].includes(c.key);
  }
  return !!f.bilingual || f.kind === "list";
}

/** The slot a value is written to: its language for bilingual values, English (shared) for the rest. */
export const slotOf = (key: string, lang: Lang, col?: string): Lang => (isBilingual(key, col) ? lang : "en");

/** A new profile: the shared details of "My details" (organization, you as project manager...) plus a name. */
export function newProfile(defaults: ProfileData | null, name: string, lang: Lang = "en"): ProfileData {
  const p = emptyProfile();
  for (const k of DEFAULT_KEYS) if (defaults?.scalars[k]) p.scalars[k] = { ...defaults.scalars[k] };
  if (name.trim()) p.scalars.project_name = { [lang]: name.trim().slice(0, 300) };
  return p;
}

/** Answers typed while making a copy, written into a profile (lists: one item per line). Returns a new profile. */
export function withAnswers(p: ProfileData, lang: Lang, answers: Record<string, string>): ProfileData {
  const out: ProfileData = JSON.parse(JSON.stringify(p));
  for (const [k, raw] of Object.entries(answers)) {
    const v = String(raw ?? "").trim();
    const f = FIELD[k];
    if (!v || !f || f.group === "auto") continue;
    if (f.kind === "list") out.lists[k] = v.split("\n").map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).slice(0, 50).map((x) => ({ [slotOf(k, lang)]: x.slice(0, 500) }));
    else if (f.kind !== "table") out.scalars[k] = { ...(out.scalars[k] ?? {}), [slotOf(k, lang)]: v.slice(0, f.kind === "long" ? 2000 : 300) };
  }
  return cleanProfile(out);
}

/** Fields a fill needs that have no value yet (date and version are always there). */
export function missingFields(keys: string[], v: Values) {
  return [...new Set(keys)].filter((k) => !k.startsWith("ask:") && k !== "date" && k !== "version" && !valueText(v, k));
}

/** How full a profile is, for the list ("8 of 14 core fields"). */
export function profileFill(p: ProfileData) {
  const core = FIELD_DEFS.filter((f) => f.group === "core");
  const filled = core.filter((f) => p.scalars[f.key]?.en || p.scalars[f.key]?.es).length;
  const plan = FIELD_DEFS.filter((f) => f.group !== "core" && f.group !== "auto").filter((f) => (f.kind === "list" ? p.lists[f.key]?.length : p.tables[f.key]?.length)).length;
  return { core: filled, coreTotal: core.length, lists: plan };
}

/** Is any bilingual value written in only one language? (Shown as a hint in the editor.) */
export function missingLang(p: ProfileData, lang: Lang): string[] {
  const other: Lang = lang === "en" ? "es" : "en";
  const out: string[] = [];
  for (const [k, v] of Object.entries(p.scalars)) if (isBilingual(k) && v[other] && !v[lang]) out.push(k);
  for (const [k, items] of Object.entries(p.lists)) if (items.some((x) => x[other] && !x[lang])) out.push(k);
  for (const [k, rows] of Object.entries(p.tables)) if (rows.some((r) => Object.entries(r).some(([c, x]) => isBilingual(k, c) && x[other] && !x[lang]))) out.push(k);
  return out;
}
