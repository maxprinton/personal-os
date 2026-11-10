"use client";
// Template Manager add-on — browser helpers: upload a file to your private folder and remember view choices.
import { createClient } from "@/lib/supabase/client";
import { BUCKET, MAX_FILE } from "@/lib/file-templates/constants";
import { sha256Hex, storagePath } from "@/lib/file-templates/query";
import type { FileRow } from "@/app/file-template-actions";
import type { Lang } from "@/lib/file-templates/types";

let uidCache: string | null = null;
export async function myUserId() {
  if (uidCache) return uidCache;
  const { data } = await createClient().auth.getUser();
  uidCache = data.user?.id ?? null;
  return uidCache;
}

export async function fingerprint(file: File) {
  try {
    return await sha256Hex(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/** Uploads one file for a template and returns the row to save (or an error message). */
export async function uploadTemplateFile(file: File, templateId: string, lang: Lang | null, sha: string | null): Promise<{ row: FileRow } | { error: string }> {
  if (file.size > MAX_FILE) return { error: `${file.name} is larger than 50 MB.` };
  const uid = await myUserId();
  if (!uid) return { error: "You are signed out." };
  const path = storagePath(uid, templateId, lang, file.name);
  const { error } = await createClient().storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined, cacheControl: "3600" });
  if (error) return { error: `${file.name}: ${error.message}` };
  return { row: { template_id: templateId, lang, storage_path: path, file_name: file.name, mime: file.type || null, size: file.size, sha256: sha } };
}

/** Runs async jobs with a small concurrency limit, reporting progress. */
export async function runPool<T>(items: T[], limit: number, job: (item: T, i: number) => Promise<void>, onStep?: (done: number) => void) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await job(items[i], i);
      done++;
      onStep?.(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: just don't remember */
  }
}
