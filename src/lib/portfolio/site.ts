// Portfolio add-on — site settings (the single portfolio_site row). SERVER only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingPortfolio } from "@/lib/portfolio/errors";
import type { Lang } from "@/lib/portfolio/constants";

export type SiteSettings = {
  name: string;
  tagline: Partial<Record<Lang, string>>;
  avatar_url: string | null;
  links: { label: string; url: string }[];
  nav: { label: Partial<Record<Lang, string>>; kind: string }[];
  langs: Lang[];
  default_lang: Lang;
  contact_enabled: boolean;
  analytics_enabled: boolean;
  blocked_words: string[];
};

export const SITE_DEFAULTS: SiteSettings = {
  name: "Maximiliano Avila",
  tagline: { en: "I build tools for my own life, then teach what I learn.", es: "Construyo herramientas para mi propia vida y luego enseño lo que aprendo." },
  avatar_url: null,
  links: [],
  nav: [],
  langs: ["en", "es"],
  default_lang: "en",
  contact_enabled: true,
  analytics_enabled: true,
  blocked_words: [],
};

export async function loadSite(sb: SupabaseClient, userId: string): Promise<{ site: SiteSettings; saved: boolean; missing: boolean }> {
  const { data, error } = await sb.from("portfolio_site").select("*").eq("user_id", userId).maybeSingle();
  if (error) return { site: SITE_DEFAULTS, saved: false, missing: isMissingPortfolio(error) };
  if (!data) return { site: SITE_DEFAULTS, saved: false, missing: false };
  const r = data as Partial<SiteSettings> & { name: string | null };
  return {
    site: { ...SITE_DEFAULTS, ...r, name: r.name ?? SITE_DEFAULTS.name, tagline: { ...(r.tagline ?? {}) } },
    saved: true,
    missing: false,
  };
}

export async function saveSite(sb: SupabaseClient, userId: string, s: SiteSettings): Promise<string | null> {
  const { error } = await sb.from("portfolio_site").upsert({ user_id: userId, ...s }, { onConflict: "user_id" });
  return error ? error.message : null;
}
