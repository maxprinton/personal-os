"use client";
// Small pieces shared by the template components: a page icon (emoji or image), the text of an error.
import "./templates.css";

/** A page icon: an emoji, or an image (uploaded / link). */
export function TplIcon({ icon, fallback = "📄" }: { icon: string | null | undefined; fallback?: string }) {
  const i = (icon ?? "").trim();
  if (i && /^(https?:|\/)/.test(i)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={i} alt="" className="tpl-icon-img" />;
  }
  return <>{i || fallback}</>;
}

/** The error of a server action result, or of a thrown error. */
export function errText(r: unknown, fallback = "Something went wrong. Try again.") {
  if (r && typeof r === "object" && "error" in r && typeof (r as { error: unknown }).error === "string") return (r as { error: string }).error;
  if (r instanceof Error && r.message) return r.message;
  return fallback;
}

/**
 * A template's name for menus, never empty: its title without the {{variables}} and the dashes left
 * around them ("Diario — {{fecha}}" → "Diario", "Reunión — " → "Reunión").
 */
export function tplTitle(t: { title: string }) {
  const s = (t.title ?? "")
    .replace(/\{\{\s*[a-z_]+\s*\}\}/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s—–\-·:|,]+|[\s—–\-·:|,]+$/g, "")
    .replace(/\s*([—–\-·:|])\s*([—–\-·:|])\s*/g, " $1 ")
    .replace(/\s+([:,])/g, "$1")
    .trim();
  return s || t.title.trim() || "Untitled template";
}

/**
 * Before an action that reads the page from the database: blur the editor so its pending autosave
 * goes out first (server actions run one after another), then a moment for it to start.
 */
export async function settleEditor() {
  if (typeof document === "undefined") return;
  (document.activeElement as HTMLElement | null)?.blur?.();
  await new Promise((r) => setTimeout(r, 60));
}
