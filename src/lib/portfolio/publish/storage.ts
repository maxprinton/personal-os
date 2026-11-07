// Portfolio publishing — the real media store (Supabase Storage, service key). SERVER only.
import { createAdminClient } from "@/lib/supabase/admin";
import type { MediaStore } from "./media";

export function adminMediaStore(): MediaStore | null {
  const admin = createAdminClient();
  if (!admin) return null;
  const priv = admin.storage.from("note-files");
  const pub = admin.storage.from("portfolio-media");
  return {
    publicBase: pub.getPublicUrl("x").data.publicUrl.slice(0, -1),
    async download(key) {
      const { data, error } = await priv.download(key);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
    async exists(path) {
      const i = path.lastIndexOf("/");
      const { data } = await pub.list(path.slice(0, i), { limit: 100, search: path.slice(i + 1) });
      return !!data?.some((f) => f.name === path.slice(i + 1));
    },
    async upload(path, bytes, type) {
      const { error } = await pub.upload(path, bytes, { contentType: type, upsert: false, cacheControl: "31536000" });
      return !error || /exists|duplicate/i.test(error.message);
    },
    async list(folder) {
      const { data } = await pub.list(folder, { limit: 1000 });
      return (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
    },
    async remove(paths) {
      for (let i = 0; i < paths.length; i += 100) await pub.remove(paths.slice(i, i + 100));
    },
  };
}
