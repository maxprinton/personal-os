// Video helpers (pure). The embed address is built only from a validated YouTube id, on the privacy-enhanced domain.
import type { Lang } from "./i18n";

export const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export type VideoRow = {
  id: string;
  youtube_video_id: string;
  title: Partial<Record<Lang, string>>;
  description: Partial<Record<Lang, string>>;
  thumb_url: string | null;
  duration_s: number | null;
  published_at: string | null;
  featured: boolean;
  position: number;
  is_live: boolean;
  updated_at: string;
};

export const embedUrl = (id: string) => (YT_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : null);
export const watchUrl = (id: string) => (YT_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null);

/** "12:34", or "1:02:03" for long videos; empty when unknown. */
export function fmtLength(s: number | null | undefined): string {
  if (!s || s < 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** ISO 8601 duration for structured data ("PT12M34S"). */
export function isoDuration(s: number | null | undefined): string | undefined {
  if (!s || s < 0) return undefined;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${sec || (!h && !m) ? `${sec}S` : ""}`;
}

/** The text in this language, or in the other one when it is missing. */
export function textOf(map: Partial<Record<Lang, string>> | null | undefined, lang: Lang): string {
  const other: Lang = lang === "en" ? "es" : "en";
  return (map?.[lang] ?? "").trim() || (map?.[other] ?? "").trim();
}

/** Video for the Home page: the first featured one in the owner's order, else the newest. */
export function pickLatest<T extends Pick<VideoRow, "featured" | "position" | "published_at">>(videos: T[]): T | null {
  if (!videos.length) return null;
  const featured = videos.filter((v) => v.featured).sort((a, b) => a.position - b.position);
  if (featured.length) return featured[0];
  return [...videos].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
}

export const thumbOf = (v: Pick<VideoRow, "thumb_url">): string | null => (v.thumb_url && /^https:\/\//.test(v.thumb_url) ? v.thumb_url : null);
