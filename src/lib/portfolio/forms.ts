// Portfolio add-on — turns form fields into clean slot data (pure functions, no database).
import { LANGS } from "@/lib/portfolio/constants";
import { cleanLangs } from "@/lib/portfolio/slots";
import type { SlotLangs, SlotMeta } from "@/lib/portfolio/types";

type Get = (name: string) => string;
const trim = (s: string) => s.replace(/\r\n?/g, "\n").trim();

const STATUSES = ["idea", "in_progress", "shipped", "paused"] as const;

/** "React, Next.js ,, Supabase" -> ["React","Next.js","Supabase"] (max 12, no repeats). */
export function parseStack(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const t = raw.trim().slice(0, 40);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

/** One link per line: "Label | https://…" (or just the address). Only http(s) links are kept. */
export function parseLinks(text: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  for (const line of trim(text).split("\n")) {
    if (!line.trim()) continue;
    const [a, b] = line.includes("|") ? line.split("|").map((x) => x.trim()) : ["", line.trim()];
    const url = (b ?? "").trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) continue;
    out.push({ label: (a || url.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0]).slice(0, 60), url: url.slice(0, 500) });
    if (out.length >= 8) break;
  }
  return out;
}

function year(v: string): number | null | "bad" {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : "bad";
}

/** Project metadata from the slot editor form. */
export function parseMeta(get: Get): { meta: SlotMeta } | { error: string } {
  const status = get("status");
  const from = year(get("year_from"));
  const to = year(get("year_to"));
  if (from === "bad" || to === "bad") return { error: "Years must be between 1990 and 2100." };
  if (from && to && to < from) return { error: "The end year is before the start year." };
  const video = get("video").trim();
  const ytId = video.match(/(?:v=|youtu\.be\/|embed\/|^)([A-Za-z0-9_-]{11})(?:[&?/]|$)/)?.[1] ?? "";
  if (video && !ytId) return { error: "Could not read that YouTube address." };
  const meta: SlotMeta = {};
  if ((STATUSES as readonly string[]).includes(status)) meta.status = status as SlotMeta["status"];
  if (from) meta.year_from = from;
  if (to) meta.year_to = to;
  const stack = parseStack(get("stack"));
  if (stack.length) meta.stack = stack;
  const links = parseLinks(get("links"));
  if (links.length) meta.links = links;
  if (ytId) meta.video = ytId;
  return { meta };
}

/** Per-language texts from fields named en_slug, en_summary, en_role, en_seo_title, en_seo_desc (and es_…). */
export function parseLangs(get: Get): SlotLangs {
  const raw: Record<string, Record<string, string>> = {};
  for (const lang of LANGS) {
    raw[lang] = {};
    for (const f of ["slug", "summary", "role", "seo_title", "seo_desc"]) raw[lang][f] = get(`${lang}_${f}`);
  }
  return cleanLangs(raw);
}

/** Never-public words: one per line or comma separated, lowercase, max 100. */
export function parseWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const t = raw.trim().toLowerCase().slice(0, 60);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 100) break;
  }
  return out;
}
