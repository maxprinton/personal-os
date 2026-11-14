import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listSteps } from "@/lib/backlog/data";

/** Today: one line when Claude is waiting on a step from the user (migration, upload, keys). Silent otherwise. */
export default async function StepsLine({ supabase, userId }: { supabase: SupabaseClient; userId: string }) {
  try {
    const pending = await listSteps(supabase, userId, { status: "pending", limit: 5 });
    if (!pending.length) return null;
    return (
      <p className="rounded-lg border border-line bg-accent-soft px-3 py-2 text-sm">
        Waiting on you:{" "}
        <Link href="/backlog" className="font-medium underline">
          {pending.length === 1 ? pending[0].title : `${pending.length} steps`}
        </Link>
      </p>
    );
  } catch {
    return null;
  }
}
