// Dates shown on the site. Always UTC so the same day shows on the server and for every visitor.
import type { Lang } from "./i18n";

export function fmtDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "es" ? "es" : "en", { dateStyle: "long", timeZone: "UTC" }).format(d);
}
