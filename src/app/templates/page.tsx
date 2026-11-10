// /templates — the library: every template (not in the trash), searchable and grouped by phase.
import Library from "@/components/file-templates/Library";
import { loadTemplates } from "@/lib/file-templates/db";

export default async function TemplatesPage() {
  const templates = await loadTemplates();
  return <Library templates={templates.filter((t) => t.status !== "inbox")} />;
}
