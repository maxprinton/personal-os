// /templates/projects — project profiles: each project's details, kept once and filled into every template.
import ProjectsList, { type ProjectRow } from "@/components/file-templates/ProjectsList";
import ProfilesMigration from "@/components/file-templates/ProfilesMigration";
import { copiesReady, loadCopies, loadDefaults, loadProjects, outdatedKeys, profilesReady } from "@/lib/file-templates/db";
import { profileFill } from "@/lib/file-templates/fields";

export default async function ProjectsPage() {
  const { missing } = await profilesReady();
  if (missing) return <ProfilesMigration />;
  const [projects, defaults, ready] = await Promise.all([loadProjects(), loadDefaults(), copiesReady()]);
  const copies = ready.missing ? [] : await loadCopies();
  const rows: ProjectRow[] = projects.map((p) => {
    const mine = copies.filter((c) => c.project_id === p.id);
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      archived: p.archived,
      updated_at: p.updated_at,
      fill: profileFill(p.data),
      copies: mine.length,
      outdated: mine.filter((c) => outdatedKeys(c, p).length > 0).length,
      goal: p.data.scalars.project_goal?.en || p.data.scalars.project_goal?.es || "",
    };
  });
  const unlinked = [...new Set(copies.filter((c) => !c.project_id && c.project).map((c) => c.project as string))].filter((n) => !projects.some((p) => p.name.toLowerCase() === n.toLowerCase()));
  return <ProjectsList rows={rows} hasDefaults={!!defaults} unlinked={unlinked} />;
}
