// /templates/copies/<id> — one working copy: versions, upload a new version, edit text/CSV/Mermaid here.
import Link from "next/link";
import CopyDetail from "@/components/file-templates/CopyDetail";
import CopiesMigration from "@/components/file-templates/CopiesMigration";
import { BASE } from "@/lib/file-templates/constants";
import { copiesReady, loadCopy } from "@/lib/file-templates/db";

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
  return <CopyDetail copy={copy} />;
}
