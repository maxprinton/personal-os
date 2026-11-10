// /templates/copies/<id> — one working copy: versions, upload a new version, edit text/CSV/Mermaid here.
import Link from "next/link";
import CopyDetail, { type CopyProfileInfo } from "@/components/file-templates/CopyDetail";
import CopiesMigration from "@/components/file-templates/CopiesMigration";
import { BASE } from "@/lib/file-templates/constants";
import { copiesReady, loadCopy, loadProject, outdatedKeys } from "@/lib/file-templates/db";
import { sortVersions } from "@/lib/file-templates/query";

export default async function CopyPage({ params }: { params: Promise<{ id: string }> }) {
  const { missing } = await copiesReady();
  if (missing) return <CopiesMigration />;
  const { id } = await params;
  const copy = await loadCopy(id);
  if (!copy) {
    return (
      <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">
        This working copy does not exist or was deleted. <Link href={`${BASE}/copies`} className="text-accent hover:underline">Back to working copies</Link>.
      </p>
    );
  }
  let profile: CopyProfileInfo = null;
  if (copy.project_id) {
    const project = await loadProject(copy.project_id);
    if (project) {
      const latest = sortVersions(copy.tm_files ?? [])[0];
      const filledAt = copy.filled_at ? Date.parse(copy.filled_at) : 0;
      profile = {
        projectId: project.id,
        projectName: project.name,
        outdated: outdatedKeys(copy, project),
        editedAfterFill: !!latest && filledAt > 0 && Date.parse(latest.created_at) > filledAt + 60_000,
        canRefresh: !!copy.source_file_id,
      };
    }
  }
  return <CopyDetail copy={copy} profile={profile} />;
}
