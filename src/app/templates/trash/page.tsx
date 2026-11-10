// /templates/trash — deleted templates (30 days). Opening it also deletes for good what is older than 30 days.
import TrashList from "@/components/file-templates/TrashList";
import { loadTemplates, purgeOldTrash, tmServer } from "@/lib/file-templates/db";

export default async function TemplatesTrashPage() {
  const { supabase, userId } = await tmServer();
  if (userId) await purgeOldTrash(supabase, userId);
  const items = await loadTemplates({ trash: true });
  return <TrashList items={items} />;
}
