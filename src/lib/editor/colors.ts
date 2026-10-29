// Notion's 10 colors. Text colors are "red", background colors "red_bg" (the names Notion's own
// Markdown uses). The CSS for each one lives in globals.css (.n-color-* / [data-color=*]).

export const COLOR_NAMES = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type ColorName = (typeof COLOR_NAMES)[number];
/** "red" (text) or "red_bg" (background); "default" = none. */
export type NotionColor = string;

export const COLOR_LABEL: Record<ColorName, string> = {
  default: "Default",
  gray: "Gray",
  brown: "Brown",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
};

/** Spanish names too, so "/rojo" works in the "/" menu. */
export const COLOR_ALIASES: Record<ColorName, string[]> = {
  default: ["default", "normal", "none", "sin color"],
  gray: ["grey", "gris"],
  brown: ["marron", "cafe"],
  orange: ["naranja"],
  yellow: ["amarillo"],
  green: ["verde"],
  blue: ["azul"],
  purple: ["morado", "violeta"],
  pink: ["rosa"],
  red: ["rojo"],
};

const VALID = new Set<string>([...COLOR_NAMES.filter((c) => c !== "default"), ...COLOR_NAMES.filter((c) => c !== "default").map((c) => `${c}_bg`)]);

/** Accepts "red", "red_bg", "red_background" (Notion API spelling); anything else → null. */
export function normalizeColor(raw: string | null | undefined): NotionColor | null {
  if (!raw) return null;
  const c = raw.trim().toLowerCase().replace(/_background$/, "_bg");
  return VALID.has(c) ? c : null;
}

export const isBackground = (c: string | null | undefined) => !!c && c.endsWith("_bg");

/** Swatch colors for menus (light / dark take the same CSS variables as the page). */
export const swatchVar = (c: ColorName, bg: boolean) => (c === "default" ? (bg ? "transparent" : "var(--n-text)") : `var(--n-${c}${bg ? "-bg" : ""})`);
