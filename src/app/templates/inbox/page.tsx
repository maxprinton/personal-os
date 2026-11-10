// /templates/inbox — uploads waiting to be classified (status "inbox").
import Library from "@/components/file-templates/Library";
import { loadTemplates } from "@/lib/file-templates/db";

export default async function TemplatesInboxPage() {
  const templates = await loadTemplates();
  return <Library templates={templates.filter((t) => t.status === "inbox")} mode="inbox" />;
}
