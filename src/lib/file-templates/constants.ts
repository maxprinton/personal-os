// Template Manager add-on — labels and fixed values (pure, safe for client and tests).
import type { Format, Group, Lang, Phase, Status } from "./types";

export const BASE = "/templates";
export const MIGRATION_FILE = "MIGRACION-0052-template-manager.sql";
export const BUCKET = "note-files";
export const FOLDER = "templates"; // <uid>/templates/<template id>/...
export const MAX_FILE = 50 * 1024 * 1024; // the note-files bucket limit
export const TRASH_DAYS = 30;
export const LIBRARY_SOURCE = "Personal OS Template Library";

export const NAV = [
  { href: BASE, label: "Library" },
  { href: `${BASE}/inbox`, label: "Inbox" },
  { href: `${BASE}/import`, label: "Add templates" },
  { href: `${BASE}/trash`, label: "Trash" },
];

export const PHASES: Phase[] = ["INI", "PLN", "EXE", "MON", "CLO"];
export const PHASE_LABEL: Record<Phase, Record<Lang, string>> = {
  INI: { en: "Initiating", es: "Iniciación" },
  PLN: { en: "Planning", es: "Planificación" },
  EXE: { en: "Executing", es: "Ejecución" },
  MON: { en: "Monitoring and controlling", es: "Monitoreo y control" },
  CLO: { en: "Closing", es: "Cierre" },
};

export const GROUPS: Group[] = ["base", "scrum", "kanban", "lean", "dmaic", "dmadv", "p2", "wf", "hyb", "other"];
export const GROUP_LABEL: Record<Group, Record<Lang, string>> = {
  base: { en: "All approaches", es: "Todos los enfoques" },
  scrum: { en: "Scrum / agile", es: "Scrum / ágil" },
  kanban: { en: "Kanban", es: "Kanban" },
  lean: { en: "Lean", es: "Lean" },
  dmaic: { en: "Six Sigma DMAIC", es: "Six Sigma DMAIC" },
  dmadv: { en: "Six Sigma DMADV", es: "Six Sigma DMADV" },
  p2: { en: "PRINCE2", es: "PRINCE2" },
  wf: { en: "Waterfall", es: "Cascada" },
  hyb: { en: "Hybrid", es: "Híbrido" },
  other: { en: "Other / mine", es: "Otras / mías" },
};

export const FORMATS: Format[] = ["docx", "xlsx", "pptx", "pdf", "csv", "md", "mermaid", "note", "image", "link", "other"];
export const FORMAT_LABEL: Record<Format, string> = {
  docx: "Word", xlsx: "Excel", pptx: "PowerPoint", pdf: "PDF", csv: "CSV", md: "Markdown",
  mermaid: "Mermaid diagram", note: "Note", image: "Image", link: "Link", other: "Other",
};

export const STATUSES: Status[] = ["inbox", "reviewed", "ready"];
export const STATUS_LABEL: Record<Status, string> = { inbox: "Inbox", reviewed: "Reviewed", ready: "Ready to use" };

export const ABOUT_LABEL: Record<Lang, { best: string; use: string; skip: string; value: string; vars: string }> = {
  en: { best: "Best for", use: "Use it when", skip: "Skip it when", value: "Why it matters", vars: "Variations by approach" },
  es: { best: "Ideal para", use: "Úsala cuando", skip: "Omítela cuando", value: "Por qué importa", vars: "Variaciones por enfoque" },
};
