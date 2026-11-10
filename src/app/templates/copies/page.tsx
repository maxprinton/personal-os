// /templates/copies — every working copy (template + project), newest first.
import CopiesList from "@/components/file-templates/CopiesList";
import CopiesMigration from "@/components/file-templates/CopiesMigration";
import { copiesReady, loadCopies } from "@/lib/file-templates/db";

export default async function CopiesPage() {
  const { missing } = await copiesReady();
  if (missing) return <CopiesMigration />;
  return <CopiesList copies={await loadCopies()} />;
}
