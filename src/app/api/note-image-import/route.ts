// Saves a copy of an image from another website into your private "note-files" storage and returns the note link.
// Used by the editor when you paste text with images from a web page (those links usually expire after a day).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchRemoteImage } from "@/lib/remote-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof body.url !== "string" || body.url.length > 4000) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const img = await fetchRemoteImage(body.url);
  if ("error" in img) return NextResponse.json({ error: img.error }, { status: 422 });
  const d = new Date();
  const id = crypto.randomUUID().slice(0, 8);
  const path = `${uid}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}/${id}-${img.name}`;
  const { error } = await supabase.storage.from("note-files").upload(path, img.bytes, { contentType: img.type, upsert: false, cacheControl: "31536000" });
  if (error) return NextResponse.json({ error: "Couldn't store the image." }, { status: 500 });
  return NextResponse.json({ url: `/api/files/${path.split("/").map(encodeURIComponent).join("/")}`, name: img.name, size: img.bytes.byteLength });
}
