import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listItems, loadSettings } from "@/lib/backlog/data";
import { verifyDueItems } from "@/lib/backlog/board";
import { itemCode } from "@/lib/backlog/rules";

/** Today: one line when something has been in real use long enough to be asked "did it work?". Silent otherwise. */
export default async function VerifyDueLine({ supabase, userId }: { supabase: SupabaseClient; userId: string }) {
  try {
    const { items, missing } = await listItems(supabase, userId);
    if (missing || !items.length) return null;
    const settings = await loadSettings(supabase, userId);
    const due = verifyDueItems(items, new Date(), settings.verify_days);
    if (!due.length) return null;
    return (
      <p className="rounded-lg border border-line bg-accent-soft px-3 py-2 text-sm">
        Did it work in real use?{" "}
        <Link href="/backlog" className="font-medium underline">
          {due.map((i) => itemCode(i.number)).join(", ")}
        </Link>
      </p>
    );
  } catch {
    return null;
  }
}
