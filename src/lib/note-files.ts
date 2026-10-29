// Files added to notes (images, PDFs, audio…) go to the private "note-files" bucket in Supabase
// Storage, in a folder per user. Notes store "/api/files/<path>", which only opens for you.
import { createClient } from "@/lib/supabase/client";

const MAX = 50 * 1024 * 1024;

function safeName(name: string) {
  const clean = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(-80);
  return clean || "file";
}

export async function uploadNoteFile(file: File): Promise<{ url: string; name: string; size: number } | null> {
  if (file.size > MAX) return null;
  const sb = createClient();
  const { data } = await sb.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return null;
  const d = new Date();
  const id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8);
  const path = `${uid}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}/${id}-${safeName(file.name || "pasted.png")}`;
  const { error } = await sb.storage.from("note-files").upload(path, file, { contentType: file.type || undefined, upsert: false, cacheControl: "31536000" });
  if (error) {
    console.error("Upload failed", error);
    return null;
  }
  return { url: `/api/files/${path.split("/").map(encodeURIComponent).join("/")}`, name: file.name || "file", size: file.size };
}
