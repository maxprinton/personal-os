// /templates/projects/<id> — one project profile (or /templates/projects/me: "My details").
import Link from "next/link";
import ProfileEditor, { type ProjectCopy } from "@/components/file-templates/ProfileEditor";
import ProfilesMigration from "@/components/file-templates/ProfilesMigration";
import { BASE } from "@/lib/file-templates/constants";
import { copiesReady, loadCopies, loadDefaults, loadProject, outdatedKeys, profilesReady } from "@/lib/file-templates/db";
import { sortVersions } from "@/lib/file-templates/query";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { missing } = await profilesReady();
  if (missing) return <ProfilesMigration />;
  const { id } = await params;
  if (id === "me") return <ProfileEditor project={await loadDefaults()} defaults />;
  const project = await loadProject(id);
  if (!project || project.is_defaults) {
    return (
      <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">
        This project profile does not exist or was deleted. <Link href={`${BASE}/projects`} className="text-accent hover:underline">Back to projects</Link>.
      </p>
    );
  }
  const ready = await copiesReady();
  const copies: ProjectCopy[] = (ready.missing ? [] : await loadCopies())
    .filter((c) => c.project_id === project.id)
    .map((c) => {
      const versions = sortVersions(c.tm_files ?? []);
      const latest = versions[0];
      const filledAt = c.filled_at ? Date.parse(c.filled_at) : 0;
      return {
        id: c.id,
        title: c.title,
        template: c.tm_templates ? `${c.tm_templates.code ? `${c.tm_templates.code} ` : ""}${c.tm_templates.name}` : "Deleted template",
        version: latest?.version ?? 1,
        outdated: outdatedKeys(c, project),
        editedAfterFill: !!latest && filledAt > 0 && Date.parse(latest.created_at) > filledAt + 60_000,
        updated_at: c.updated_at,
      };
    });
  return <ProfileEditor project={project} copies={copies} />;
}
