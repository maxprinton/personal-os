// A file of a note (image, PDF, audio…): checks it is yours and sends you to a short-lived signed link.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const key = path.map((p) => decodeURIComponent(p)).join("/");
  if (!key.startsWith(`${uid}/`) || key.includes("..")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const download = req.nextUrl.searchParams.has("download");
  const { data: signed, error } = await supabase.storage.from("note-files").createSignedUrl(key, 3600, download ? { download: true } : undefined);
  if (error || !signed?.signedUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const res = NextResponse.redirect(signed.signedUrl, 302);
  res.headers.set("Cache-Control", "private, max-age=3000");
  return res;
}
