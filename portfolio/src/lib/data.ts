// Reads what was published from the OS. Only the columns the public (anon) role may read; never throws:
// without a database the site still builds and shows empty pages.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import type { Lang } from "./i18n";
import { cleanQuery, rank, snippet, termsOf } from "./search";
import { YT_ID, type VideoRow } from "./videos";

export type Kind = "home" | "about" | "now" | "uses" | "project" | "article";
export type Toc = { level: number; id: string; text: string };
export type PageMeta = {
  status?: "idea" | "in_progress" | "shipped" | "paused";
  year_from?: number;
  year_to?: number | null;
  stack?: string[];
  links?: { label: string; url: string }[];
  video?: string;
  role?: string | null;
  seo_title?: string | null;
  seo_desc?: string | null;
  show_toc?: boolean;
  previous_slugs?: string[];
};
export type PageRow = {
  slot_id: string;
  slot_key: string;
  kind: Kind;
  lang: Lang;
  slug: string;
  title: string;
  summary: string | null;
  icon: string | null;
  cover_url: string | null;
  body_html: string;
  toc: Toc[];
  meta: PageMeta;
  search_text: string;
  reading_minutes: number | null;
  featured: boolean;
  position: number;
  version: number;
  published_at: string | null;
  updated_at: string;
};
export type SiteRow = {
  name: string;
  tagline: Partial<Record<Lang, string>>;
  avatar_url: string | null;
  links: { label: string; url: string }[];
  nav: { label: Partial<Record<Lang, string>>; kind: string }[];
  default_lang: Lang;
  contact_enabled: boolean;
  analytics_enabled: boolean;
  social_image_url: string | null;
};

const PAGE_COLS = "slot_id,slot_key,kind,lang,slug,title,summary,icon,cover_url,body_html,toc,meta,search_text,reading_minutes,featured,position,version,published_at,updated_at";
const LIST_COLS = "slot_id,slot_key,kind,lang,slug,title,summary,icon,cover_url,meta,reading_minutes,featured,position,published_at,updated_at";
const SITE_COLS = "name,tagline,avatar_url,links,nav,default_lang,contact_enabled,analytics_enabled,social_image_url";

export const SITE_DEFAULTS: SiteRow = {
  name: "Maximiliano Avila",
  tagline: { en: "I build tools for my own life, then teach what I learn.", es: "Construyo herramientas para mi propia vida y luego enseño lo que aprendo." },
  avatar_url: null,
  links: [],
  nav: [],
  default_lang: "en",
  contact_enabled: true,
  analytics_enabled: true,
  social_image_url: null,
};

let client: SupabaseClient | null | undefined;
function db(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return client;
}

export const getSite = cache(async (): Promise<SiteRow> => {
  const sb = db();
  if (!sb) return SITE_DEFAULTS;
  const { data } = await sb.from("portfolio_site").select(SITE_COLS).limit(1).maybeSingle();
  const s = data as Partial<SiteRow> | null;
  return s ? { ...SITE_DEFAULTS, ...s, name: s.name?.trim() || SITE_DEFAULTS.name, tagline: { ...SITE_DEFAULTS.tagline, ...(s.tagline ?? {}) } } : SITE_DEFAULTS;
});

/** One live page: by kind (and slug for projects / articles). */
export const getPage = cache(async (lang: Lang, kind: Kind, slug?: string): Promise<PageRow | null> => {
  const sb = db();
  if (!sb) return null;
  let q = sb.from("portfolio_pages").select(PAGE_COLS).eq("lang", lang).eq("kind", kind).eq("is_live", true);
  if (slug) q = q.eq("slug", slug);
  const { data } = await q.order("position", { ascending: true }).limit(1).maybeSingle();
  return (data as PageRow | null) ?? null;
});

export type ListItem = Omit<PageRow, "body_html" | "toc" | "search_text" | "version">;
/** Live pages of a kind, featured first, then by position. */
export const listPages = cache(async (lang: Lang, kind: Kind): Promise<ListItem[]> => {
  const sb = db();
  if (!sb) return [];
  const { data } = await sb.from("portfolio_pages").select(LIST_COLS).eq("lang", lang).eq("kind", kind).eq("is_live", true);
  return sortPages((data ?? []) as ListItem[], kind);
});

export function sortPages<T extends { featured: boolean; position: number; published_at: string | null }>(rows: T[], kind: Kind): T[] {
  return [...rows].sort((a, b) => {
    if (kind === "article") return (b.published_at ?? "").localeCompare(a.published_at ?? "");
    return Number(b.featured) - Number(a.featured) || a.position - b.position;
  });
}

/** Which pages exist in a language (to build the menu and sitemap). */
export const liveIndex = cache(async (lang: Lang): Promise<{ kind: Kind; slug: string; title: string; updated_at: string }[]> => {
  const sb = db();
  if (!sb) return [];
  const { data } = await sb.from("portfolio_pages").select("kind,slug,title,updated_at").eq("lang", lang).eq("is_live", true);
  return (data ?? []) as { kind: Kind; slug: string; title: string; updated_at: string }[];
});

/** The same page in every language (for hreflang and the language switch). */
export const alternates = cache(async (slotId: string): Promise<Partial<Record<Lang, { kind: Kind; slug: string }>>> => {
  const sb = db();
  if (!sb) return {};
  const { data } = await sb.from("portfolio_pages").select("lang,kind,slug").eq("slot_id", slotId).eq("is_live", true);
  const out: Partial<Record<Lang, { kind: Kind; slug: string }>> = {};
  for (const r of (data ?? []) as { lang: Lang; kind: Kind; slug: string }[]) out[r.lang] = { kind: r.kind, slug: r.slug };
  return out;
});

/** A page that used to live at this address (the slug was changed): where it lives now. */
export async function movedTo(lang: Lang, kind: Kind, oldSlug: string): Promise<string | null> {
  const sb = db();
  if (!sb) return null;
  const { data } = await sb.from("portfolio_pages").select("slug").eq("lang", lang).eq("kind", kind).eq("is_live", true).contains("meta", { previous_slugs: [oldSlug] }).limit(1).maybeSingle();
  return (data as { slug: string } | null)?.slug ?? null;
}

/** Slugs of live pages (for static generation). */
export async function liveSlugs(kind: Kind): Promise<{ lang: Lang; slug: string }[]> {
  const sb = db();
  if (!sb) return [];
  const { data } = await sb.from("portfolio_pages").select("lang,slug").eq("kind", kind).eq("is_live", true);
  return (data ?? []) as { lang: Lang; slug: string }[];
}

export type FeedRow = ListItem & { search_text: string };
/** Live articles with their text (for the RSS summary), newest first. */
export async function listArticlesForFeed(lang: Lang): Promise<FeedRow[]> {
  const sb = db();
  if (!sb) return [];
  const { data } = await sb.from("portfolio_pages").select(`${LIST_COLS},search_text`).eq("lang", lang).eq("kind", "article").eq("is_live", true);
  return sortPages((data ?? []) as FeedRow[], "article");
}

export type Hit = { kind: Kind; slug: string; title: string; icon: string | null; snippet: string };
/** Live pages of a language that contain every word of the (already cleaned) query in their title or text. */
export async function searchPages(lang: Lang, q: string): Promise<Hit[]> {
  const sb = db();
  const terms = termsOf(cleanQuery(q));
  if (!sb || !terms.length) return [];
  let query = sb.from("portfolio_pages").select("kind,slug,title,summary,icon,search_text").eq("lang", lang).eq("is_live", true);
  for (const w of terms) query = query.or(`title.ilike.*${w}*,search_text.ilike.*${w}*`);
  const { data } = await query.limit(40);
  const rows = ((data ?? []) as { kind: Kind; slug: string; title: string; summary: string | null; icon: string | null; search_text: string }[]).map((r) => ({
    ...r,
    text: r.search_text.startsWith(r.title) ? r.search_text.slice(r.title.length) : r.search_text,
  }));
  return rank(rows, terms)
    .slice(0, 20)
    .map((r) => ({ kind: r.kind, slug: r.slug, title: r.title, icon: r.icon, snippet: snippet(r.summary && terms.some((w) => r.summary!.toLowerCase().includes(w)) ? r.summary.trim() : r.text, terms) }));
}

const VIDEO_COLS = "id,youtube_video_id,title,description,thumb_url,duration_s,published_at,featured,position,is_live,updated_at";
/** Live videos in the order the owner chose (only rows with a valid YouTube id). */
export const listVideos = cache(async (): Promise<VideoRow[]> => {
  const sb = db();
  if (!sb) return [];
  const { data } = await sb.from("portfolio_videos").select(VIDEO_COLS).eq("is_live", true).order("position", { ascending: true });
  return ((data ?? []) as VideoRow[]).filter((v) => YT_ID.test(v.youtube_video_id));
});
