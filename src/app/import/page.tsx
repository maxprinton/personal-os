import { createClient } from "@/lib/supabase/server";
import { BankImport, CalendarImport, NotesImport } from "@/components/ImportForms";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("accounts").select("id,name").is("deleted_at", null).order("created_at");
  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
          <p className="text-sm text-muted">
            Bring your history in. Imported items are marked as &quot;import&quot; and can be deleted like anything else.
          </p>
        </div>
        <NotesImport />
        <CalendarImport />
        <BankImport accounts={(data ?? []) as { id: string; name: string }[]} />
      </main>
    </>
  );
}
