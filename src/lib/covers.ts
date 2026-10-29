// Page covers (gradients, colors or an image URL). Shared by the note page and the notes gallery.
import type React from "react";

export const COVERS: { id: string; css: string; label: string }[] = [
  { id: "gradient:1", label: "Sunset", css: "linear-gradient(120deg, #f6d365 0%, #fda085 100%)" },
  { id: "gradient:2", label: "Ocean", css: "linear-gradient(120deg, #89f7fe 0%, #66a6ff 100%)" },
  { id: "gradient:3", label: "Lavender", css: "linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)" },
  { id: "gradient:4", label: "Mint", css: "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)" },
  { id: "gradient:5", label: "Peach", css: "linear-gradient(120deg, #ffecd2 0%, #fcb69f 100%)" },
  { id: "gradient:6", label: "Night", css: "linear-gradient(120deg, #30cfd0 0%, #330867 100%)" },
  { id: "gradient:7", label: "Rose", css: "linear-gradient(120deg, #ff9a9e 0%, #fecfef 100%)" },
  { id: "gradient:8", label: "Dusk", css: "linear-gradient(120deg, #a18cd1 0%, #fbc2eb 100%)" },
  { id: "color:red", label: "Red", css: "#e16259" },
  { id: "color:yellow", label: "Yellow", css: "#dfab01" },
  { id: "color:blue", label: "Blue", css: "#0f7b6c" },
  { id: "color:navy", label: "Navy", css: "#2e3a59" },
  { id: "color:beige", label: "Beige", css: "#e6d5c3" },
  { id: "color:gray", label: "Gray", css: "#9b9a97" },
];

export function coverStyle(cover: string | null | undefined, y = 50): React.CSSProperties {
  if (!cover) return {};
  const g = COVERS.find((c) => c.id === cover);
  if (g) return { background: g.css };
  return { backgroundImage: `url("${cover.replace(/"/g, "%22")}")`, backgroundPosition: `center ${y}%` };
}
