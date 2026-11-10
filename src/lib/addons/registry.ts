// Add-ons: mini apps built into Personal OS (like the apps of a phone).
// They are defined here, in code — nothing is installed, switched on/off or removed by the user.
// The user can only search, filter, open them and pin a few as favorites in the main menu.
// To add a new add-on: build its page (e.g. src/app/<id>/page.tsx) and add one entry to ADDONS.
// An add-on is isolated: it connects to the rest of the app only where its own code says so.

import type { IconName } from "@/components/ui/Icon";

export type AddonType = "work" | "creative" | "learning" | "tools";

export const ADDON_TYPES: Record<AddonType, { label: string; hint: string }> = {
  work: { label: "Work & income", hint: "Jobs, clients, hours and pay" },
  creative: { label: "Creative", hint: "Content, videos and publishing" },
  learning: { label: "Learning & goals", hint: "Courses, goals and milestones" },
  tools: { label: "Tools", hint: "Utilities and connections to other services" },
};

export type Addon = {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  href: string;
  type: AddonType;
  /** Keyboard shortcut after "g" (works whether or not it is pinned). */
  key?: string;
  /** Extra words the library search understands. */
  keywords?: string[];
  /** Outside services it talks to (shown in the library). */
  connects?: string[];
};

export const ADDONS: Addon[] = [
  {
    id: "teaching",
    name: "Teaching",
    description: "Your classes, hours and pay, the monthly Excel report and the class videos you still owe.",
    icon: "teaching",
    href: "/teaching",
    type: "work",
    key: "w",
    keywords: ["work", "trabajo", "classes", "clases", "hours", "horas", "esl", "videos", "excel", "report", "teacher"],
    connects: ["Telegram (/teaching, video reminders)"],
  },
  {
    id: "youtube",
    name: "YouTube Pipeline",
    description: "Every video from idea to 90-day follow-up: idea bank, package, research, script, shots, editing, music, publishing and A/B tests.",
    icon: "video",
    href: "/youtube",
    type: "creative",
    key: "y",
    keywords: ["youtube", "video", "videos", "channel", "canal", "script", "guion", "thumbnail", "miniatura", "shorts", "ideas", "content", "contenido", "publish", "music"],
    connects: ["YouTube Data API", "Google sign-in (publishing, analytics)", "Telegram (yt: ideas, /youtube, check-ins)", "Notes", "AI (Groq)", "Music Lab"],
  },
  {
    id: "music-lab",
    name: "Music Lab",
    description: "Make your own background music by rules (no AI): mood, key, tempo and an energy curve. Free tracks, or loaded from a YouTube video's outline.",
    icon: "music",
    href: "/music-lab",
    type: "creative",
    key: "m",
    keywords: ["music", "musica", "música", "audio", "song", "track", "pista", "background", "fondo", "wav", "beat", "soundtrack"],
    connects: ["YouTube Pipeline (video energy curves, music list)"],
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description: "Your public website in English and Spanish. Write each page as a normal note, then publish it with one button: About, Now, projects, articles and videos.",
    icon: "globe",
    href: "/portfolio",
    type: "creative",
    key: "p",
    keywords: ["portfolio", "portafolio", "website", "sitio", "web", "publish", "publicar", "blog", "projects", "proyectos", "about", "now", "case study", "contact", "contacto"],
    connects: ["Notes", "Public website (Vercel)", "Telegram (contact messages)", "YouTube Pipeline (published videos)"],
  },
  {
    id: "templates",
    name: "Template Manager",
    description: "Your library of project-management templates (Word, Excel, PowerPoint, Mermaid) in English and Spanish: find the right one by phase and approach, see when to use it, download it.",
    icon: "template",
    href: "/templates",
    type: "tools",
    key: "l",
    keywords: ["templates", "plantillas", "project management", "gestion de proyectos", "charter", "acta", "risk", "riesgos", "wbs", "edt", "gantt", "raci", "scrum", "six sigma", "dmaic", "prince2", "pmbok", "excel", "word", "pdf", "library", "biblioteca"],
    connects: ["Private file storage (your own folder)"],
  },
];

/** How many add-ons fit in the main menu. */
export const MAX_FAVORITES = 4;
export const DEFAULT_FAVORITES = ["teaching"];

export function addonById(id: string) {
  return ADDONS.find((a) => a.id === id);
}

/** Valid ids only, no repeats, at most MAX_FAVORITES, in the order given. */
export function cleanFavorites(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && addonById(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

/** Pin or unpin. Returns null when the menu is already full. */
export function toggleFavorite(current: string[], id: string): string[] | null {
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (current.length >= MAX_FAVORITES) return null;
  return cleanFavorites([...current, id]);
}

function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Search by name, description, type and keywords (accents and case ignored); every word must match. */
export function searchAddons(list: Addon[], query: string, type: AddonType | "all" = "all") {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return list.filter((a) => {
    if (type !== "all" && a.type !== type) return false;
    if (!words.length) return true;
    const hay = fold([a.name, a.description, ADDON_TYPES[a.type].label, ...(a.keywords ?? [])].join(" "));
    return words.every((w) => hay.includes(w));
  });
}
