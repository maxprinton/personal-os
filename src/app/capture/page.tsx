import QuickCapture from "@/components/QuickCapture";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const supabase = await createClient();
  const { data } = await supabase.from("accounts").select("id,name").is("deleted_at", null).order("created_at");
  const accounts = (data ?? []) as { id: string; name: string }[];
  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Quick capture</h1>
        <p className="text-sm text-muted">
          One box for tasks, notes and money. Works without internet: items wait on this device and sync later.
        </p>
        <QuickCapture autoFocus accounts={accounts} />
        <ul className="space-y-1 text-sm text-muted">
          <li><code>spent 12 on lunch</code> → expense (Food)</li>
          <li><code>received 1500 salary</code> → income</li>
          <li><code>task: call mom tomorrow</code> → task for tomorrow</li>
          <li><code>note: idea</code> + more lines → note</li>
          <li><code>spent 12 lunch from Pichincha</code> → expense on that account (or pick it in the dropdown)</li>
          <li><code>transfer 50 from cash to Pichincha</code> → move money between accounts</li>
          <li>Any short text → task for today</li>
        </ul>
      </main>
    </>
  );
}
