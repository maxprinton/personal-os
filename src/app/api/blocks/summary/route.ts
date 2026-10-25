import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { buildSummary, summaryCsv, summaryPdf, summaryText } from "@/lib/blocks-summary";

export const dynamic = "force-dynamic";

/** GET /api/blocks/summary?format=csv|pdf|txt → the blocks and their weekly times, as a download. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return new Response("Not signed in", { status: 401 });

  const format = new URL(req.url).searchParams.get("format") ?? "csv";
  const s = await buildSummary(supabase, userId);
  const name = `blocks-summary-${s.today}`;
  const headers = (type: string, ext: string) => ({
    "content-type": type,
    "content-disposition": `attachment; filename="${name}.${ext}"`,
    "cache-control": "no-store",
  });

  if (format === "pdf") return new Response(summaryPdf(s), { headers: headers("application/pdf", "pdf") });
  if (format === "txt") return new Response(summaryText(s), { headers: headers("text/plain; charset=utf-8", "txt") });
  return new Response(summaryCsv(s), { headers: headers("text/csv; charset=utf-8", "csv") });
}
