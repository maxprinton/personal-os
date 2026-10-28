// Names of the export formats and copy options (tiny, so menus can show them before the exporter loads).

export type ExportFormat = "md" | "pdf" | "docx" | "txt" | "html" | "mmd";

export const FORMATS: { id: ExportFormat; label: string; ext: string; hint: string }[] = [
  { id: "md", label: "Markdown", ext: "md", hint: "Obsidian, Notion, GitHub" },
  { id: "pdf", label: "PDF", ext: "pdf", hint: "Print or share" },
  { id: "docx", label: "Word", ext: "docx", hint: "Word, Google Docs" },
  { id: "txt", label: "Plain text", ext: "txt", hint: "No formatting" },
  { id: "html", label: "Web page", ext: "html", hint: "Opens in any browser" },
  { id: "mmd", label: "Mermaid", ext: "mmd", hint: "Mind map of the note" },
];

export type CopyKind = "rich" | "md" | "txt" | "html" | "mmd";

export const COPY_KINDS: { id: CopyKind; label: string; hint: string }[] = [
  { id: "rich", label: "Formatted", hint: "Keeps bold, lists and tables in Word, Docs or email" },
  { id: "md", label: "Markdown", hint: "Obsidian, Notion, ChatGPT…" },
  { id: "txt", label: "Plain text", hint: "No formatting at all" },
  { id: "html", label: "HTML code", hint: "For a web page" },
  { id: "mmd", label: "Mermaid", hint: "Mind map code" },
];
