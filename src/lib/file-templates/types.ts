// Template Manager add-on — types. "File templates" = project-management template files (Word, Excel...),
// kept apart from note templates (notes.is_template) on purpose.

export type Phase = "INI" | "PLN" | "EXE" | "MON" | "CLO";
export type Group = "base" | "scrum" | "kanban" | "lean" | "dmaic" | "dmadv" | "p2" | "wf" | "hyb" | "other";
export type Format = "docx" | "xlsx" | "pptx" | "pdf" | "csv" | "md" | "mermaid" | "note" | "image" | "link" | "other";
export type Status = "inbox" | "reviewed" | "ready";
export type Lang = "en" | "es";

export type About = { best?: string; use?: string; skip?: string; value?: string; vars?: string; refs?: string };

export type TemplateFile = {
  id: string;
  template_id: string;
  lang: Lang | null;
  role: "original" | "working_copy" | "preview";
  storage_path: string;
  file_name: string;
  mime: string | null;
  size: number;
  sha256: string | null;
  created_at: string;
  copy_id?: string | null;
  version?: number;
  note?: string | null;
};

export type FileTemplate = {
  id: string;
  code: string | null;
  name: string;
  name_es: string | null;
  phase: Phase | null;
  grp: Group;
  format: Format;
  approaches: string[];
  doc_type: string | null;
  tags: string[];
  status: Status;
  favorite: boolean;
  rating: number | null;
  source: string | null;
  source_url: string | null;
  about: { en?: About; es?: About };
  notes: string | null;
  times_used: number;
  last_used_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  tm_files?: TemplateFile[];
};

/** What the library catalog (catalog.json in the Template Library folder) says about one template. */
export type CatalogEntry = {
  id: string;
  format: string;
  phase: string;
  group: string;
  approaches?: string[];
  references?: string[];
  name_en: string;
  name_es?: string;
  best_en?: string; use_en?: string; skip_en?: string; value_en?: string; vars_en?: string;
  best_es?: string; use_es?: string; skip_es?: string; value_es?: string; vars_es?: string;
};

/** Columns the import writes for a library template (never status, tags, favorite or your notes). */
export type CatalogRow = {
  code: string;
  name: string;
  name_es: string | null;
  phase: Phase | null;
  grp: Group;
  format: Format;
  approaches: string[];
  about: { en: About; es: About };
  source: string;
};

export type Filters = {
  q: string;
  phase: Phase | "all";
  grp: Group | "all";
  format: Format | "all";
  status: Status | "all";
  favorites: boolean;
};

export type SortKey = "phase" | "name" | "recent" | "used";

export type CopyStatus = "active" | "done" | "archived";

/** A working copy: "this template, for this project". Versions are tm_files rows with role "working_copy". */
export type TmCopy = {
  id: string;
  template_id: string;
  title: string;
  project: string | null;
  lang: Lang | null;
  status: CopyStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  tm_files?: TemplateFile[];
  tm_templates?: { id: string; code: string | null; name: string; name_es: string | null; format: Format; phase: Phase | null } | null;
  // phase 3: filled from a project profile
  project_id?: string | null;
  source_file_id?: string | null;
  filled?: CopyFill | null;
  filled_at?: string | null;
};

/** What a fill used: the values (to spot a copy that is out of date after the profile changes) and the result. */
export type CopyFill = { lang: Lang; snapshot: Record<string, string>; filled: number; skipped: string[]; version: number; answers?: Record<string, string> };

/** A project profile (phase 3). `data` is a ProfileData (see fields.ts). */
export type TmProject = {
  id: string;
  name: string;
  code: string | null;
  is_defaults: boolean;
  data: import("./fields").ProfileData;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
