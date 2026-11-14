import type { SupabaseClient } from "@supabase/supabase-js";
import { detectTests, listTests } from "@/lib/backlog/data";
import TestMissions from "@/components/backlog/TestMissions";

/** Today: up to 3 test missions (detected first) and the "did it work?" pop-up. Silent when none are open. */
export default async function TestsToday({ supabase, userId }: { supabase: SupabaseClient; userId: string }) {
  try {
    await detectTests(supabase, userId);
    const tests = await listTests(supabase, userId, { open: true });
    if (!tests.length) return null;
    const ordered = [...tests.filter((t) => t.status === "detected"), ...tests.filter((t) => t.status === "pending")];
    return <TestMissions tests={ordered} />;
  } catch {
    return null;
  }
}
