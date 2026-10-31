// ✨ AI cover for one note: POST { noteId, idea?, save?, force? } → { ok, url, scene, ... } (see src/lib/cover-gen.ts)
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { makeCover } from "@/lib/cover-gen";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    const b = (await req.json().catch(() => null)) as { noteId?: string; idea?: string; save?: boolean; force?: boolean } | null;
    const r = await makeCover(sb, user.id, String(b?.noteId ?? ""), { idea: typeof b?.idea === "string" ? b.idea : undefined, save: !!b?.save, force: !!b?.force });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't make the cover." });
  }
}
