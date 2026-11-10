// /templates/<id> — one template: when to use it, its files and its properties.
import Link from "next/link";
import TemplateDetail from "@/components/file-templates/TemplateDetail";
import { BASE } from "@/lib/file-templates/constants";
import { loadTemplate } from "@/lib/file-templates/db";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await loadTemplate(id);
  if (!t) {
    return (
      <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">
        This template does not exist or was deleted. <Link href={BASE} className="text-accent hover:underline">Back to the library</Link>.
      </p>
    );
  }
  if (t.deleted_at) {
    return (
      <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">
        “{t.name}” is in the trash. <Link href={`${BASE}/trash`} className="text-accent hover:underline">Restore it from the Trash</Link>.
      </p>
    );
  }
  return <TemplateDetail t={t} />;
}
