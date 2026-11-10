// /templates/<id> — one template: when to use it, its files and its properties.
import Link from "next/link";
import TemplateDetail from "@/components/file-templates/TemplateDetail";
import { BASE } from "@/lib/file-templates/constants";
import { copiesReady, loadCopies, loadFieldMaps, loadProjects, loadTemplate, profilesReady } from "@/lib/file-templates/db";

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
  const { missing } = await copiesReady();
  const all = missing ? [] : await loadCopies();
  const projects = [...new Set(all.map((c) => c.project).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b));
  const profiles = await profilesReady();
  const [list, maps] = profiles.missing ? [[], {}] : await Promise.all([loadProjects(), loadFieldMaps(t.id)]);
  return (
    <TemplateDetail
      t={t}
      copies={all.filter((c) => c.template_id === t.id)}
      projects={projects}
      copiesReady={!missing}
      profilesReady={!profiles.missing && !missing}
      profiles={list.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name }))}
      maps={Object.fromEntries(Object.entries(maps).map(([k, m]) => [k, { confirmed: m.confirmed, count: m.items.filter((it) => it.field).length }]))}
    />
  );
}
