// Template Manager, phase 3 — a PDF original with a 10% grid and your marked spots drawn on it (to place the spots
// of a flat PDF by eye). With &project=<id> it shows the PDF filled with that profile instead.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/file-templates/constants";
import { cleanProfile, resolveValues } from "@/lib/file-templates/fields";
import { cleanMap, type MapItem } from "@/lib/file-templates/fill/common";
import { fillPdf, pdfGrid } from "@/lib/file-templates/fill/pdf";

export const dynamic = "force-dynamic";
const isId = (s: string | null): s is string => !!s && /^[0-9a-f-]{36}$/i.test(s);

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const fileId = q.get("file");
  if (!isId(fileId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: f } = await supabase.from("tm_files").select("storage_path, file_name, lang").eq("id", fileId).eq("user_id", uid).maybeSingle();
  if (!f || !/\.pdf$/i.test(f.file_name as string)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: blob } = await supabase.storage.from(BUCKET).download(f.storage_path as string);
  if (!blob) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let items: MapItem[] = [];
  try {
    items = cleanMap(JSON.parse(Buffer.from(q.get("spots") ?? "", "base64url").toString("utf8") || "[]"));
  } catch {
    items = [];
  }
  if (!q.get("spots")) {
    const { data: map } = await supabase.from("tm_field_maps").select("items").eq("file_id", fileId).eq("user_id", uid).maybeSingle();
    items = (map?.items ?? []) as MapItem[];
  }
  let out: Uint8Array;
  try {
    const project = q.get("project");
    if (isId(project)) {
      const { data: pr } = await supabase.from("tm_projects").select("data").eq("id", project).eq("user_id", uid).maybeSingle();
      const v = resolveValues(cleanProfile(pr?.data), f.lang === "es" ? "es" : "en");
      out = await fillPdf(bytes, items, v, { filled: 0, skipped: [] });
    } else {
      out = await pdfGrid(bytes, items.filter((it): it is Extract<MapItem, { kind: "pdf_spot" }> => it.kind === "pdf_spot"));
    }
  } catch {
    return NextResponse.json({ error: "This PDF could not be read." }, { status: 422 });
  }
  return new NextResponse(Buffer.from(out), { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=preview.pdf", "cache-control": "private, no-store" } });
}
