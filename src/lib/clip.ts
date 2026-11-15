// Web clipper support (the Coursera browser extension): personal key + saving a clipped page as a note.
// The extension sends `Authorization: Bearer <clip key>` (like the Android alarms app). Only the key's hash is stored.
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRemoteImage } from "@/lib/remote-image";
import { cleanTagName, nextColor } from "@/lib/notes-db/tag-ops";

export const MAX_CLIP_CHARS = 400_000;
export const MAX_CLIP_IMAGES = 40;

export function generateClipKey() {
  return `posclip_${randomBytes(24).toString("base64url")}`;
}

export function hashClipKey(key: string) {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** Finds the user that owns the key in `Authorization: Bearer …`. */
export async function clipUser(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const key = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!key) return { error: "Missing key", status: 401 } as const;
  const admin = createAdminClient();
  if (!admin) return { error: "Server not ready", status: 503 } as const;
  const { data, error } = await admin.from("user_settings").select("user_id").eq("clip_key_hash", hashClipKey(key)).maybeSingle();
  if (error) return { error: "Run migration 0070 (MIGRACION-0070-clip-key.sql) in Supabase first.", status: 503 } as const;
  if (!data) return { error: "Wrong key", status: 401 } as const;
  return { admin, userId: data.user_id as string } as const;
}

const IMG_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/** The same picture comes with different expiry/hmac every time: compare by address without the query. */
export const imageIdentity = (url: string) => url.split("?")[0].split("#")[0];

/**
 * Downloads every remote image of the Markdown into the user's private `note-files` bucket and swaps the links.
 * Images that can't be saved keep their original link (they may expire) and are counted in `failed`.
 */
export async function rehostMarkdownImages(
  admin: SupabaseClient,
  userId: string,
  markdown: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ markdown: string; saved: number; failed: number }> {
  const found = new Map<string, string>(); // identity -> first full url
  for (const m of markdown.matchAll(IMG_RE)) if (!found.has(imageIdentity(m[2]))) found.set(imageIdentity(m[2]), m[2]);
  const done = new Map<string, string>(); // identity -> our url
  let saved = 0;
  let failed = 0;
  const d = new Date();
  const folder = `${userId}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  for (const [identity, url] of [...found].slice(0, MAX_CLIP_IMAGES)) {
    const img = await fetchRemoteImage(url, fetchImpl);
    if ("error" in img) {
      failed++;
      continue;
    }
    const path = `${folder}/${crypto.randomUUID().slice(0, 8)}-${img.name}`;
    const up = await admin.storage.from("note-files").upload(path, img.bytes, { contentType: img.type, upsert: false, cacheControl: "31536000" });
    if (up.error) {
      failed++;
      continue;
    }
    done.set(identity, `/api/files/${path.split("/").map(encodeURIComponent).join("/")}`);
    saved++;
  }
  const out = markdown.replace(IMG_RE, (whole, alt: string, url: string) => {
    const mine = done.get(imageIdentity(url));
    return mine ? `![${alt}](${mine})` : whole;
  });
  failed += Math.max(0, found.size - MAX_CLIP_IMAGES);
  return { markdown: out, saved, failed };
}

/** Puts one tag (created if it doesn't exist) on a note. Case-insensitive; does nothing if it already has it. */
export async function tagNote(admin: SupabaseClient, userId: string, noteId: string, rawName: string) {
  const name = cleanTagName(rawName);
  if (!name) return;
  const { data: all } = await admin.from("tags").select("id,name").eq("user_id", userId).is("deleted_at", null);
  const list = (all ?? []) as { id: string; name: string }[];
  let tagId = list.find((t) => t.name.toLowerCase() === name.toLowerCase())?.id;
  if (!tagId) {
    const ins = await admin.from("tags").insert({ user_id: userId, name, color: nextColor(list.length) }).select("id").single();
    if (ins.error || !ins.data) return;
    tagId = ins.data.id as string;
  }
  const { data: has } = await admin
    .from("entity_tags")
    .select("id")
    .eq("user_id", userId)
    .eq("entity_type", "note")
    .eq("entity_id", noteId)
    .eq("tag_id", tagId)
    .is("deleted_at", null)
    .limit(1);
  if (has && has.length) return;
  await admin.from("entity_tags").insert({ user_id: userId, tag_id: tagId, entity_type: "note", entity_id: noteId });
}

// ---------- Template properties (Type, Status, Area, Source…) ----------
export type ClipProperty = { id: string; key: string; name: string; type: string; config: { options?: { id: string; name: string }[] } | null };
/** Property types a clip template may fill (the computed / relation ones can't be set from outside). */
export const SETTABLE_TYPES = new Set(["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone"]);

export const settableProperties = (all: ClipProperty[]) => all.filter((p) => SETTABLE_TYPES.has(p.type));

/**
 * Turns the template's values ({ type: "Aprendizaje", status: "inbox", source: "https://…" }, keyed by property key
 * or name) into notes.props ({ <property id>: stored value }). Options are matched by id or by name (any case);
 * anything unknown or invalid is skipped, never an error.
 */
export function resolveClipProps(properties: ClipProperty[], input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    const p = settableProperties(properties).find((x) => x.key === k || x.name.toLowerCase() === k.toLowerCase());
    if (!p) continue;
    const opts = p.config?.options ?? [];
    const pick = (v: unknown) => {
      const s = String(v ?? "").trim().toLowerCase();
      return s ? opts.find((o) => o.id.toLowerCase() === s || o.name.toLowerCase() === s)?.id : undefined;
    };
    switch (p.type) {
      case "select":
      case "status": {
        const id = pick(raw);
        if (id) out[p.id] = id;
        break;
      }
      case "multi_select": {
        const ids = (Array.isArray(raw) ? raw : [raw]).map(pick).filter((x): x is string => Boolean(x));
        if (ids.length) out[p.id] = [...new Set(ids)];
        break;
      }
      case "text":
      case "url":
      case "email":
      case "phone": {
        const t = typeof raw === "string" ? raw.trim().slice(0, 2000) : "";
        if (t) out[p.id] = t;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (raw !== "" && raw !== null && Number.isFinite(n)) out[p.id] = n;
        break;
      }
      case "checkbox":
        if (raw === true) out[p.id] = true;
        break;
      case "date":
        if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) out[p.id] = { start: raw };
        break;
    }
  }
  return out;
}

/** Clean list of tag names from the request (max 12). */
export function cleanTagList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of list) {
    const name = cleanTagName(r);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out.slice(0, 12);
}

export async function loadClipProperties(admin: SupabaseClient, userId: string): Promise<ClipProperty[]> {
  const { data } = await admin.from("note_properties").select("id,key,name,type,config").eq("user_id", userId).is("deleted_at", null).order("position");
  return (data ?? []) as ClipProperty[];
}
