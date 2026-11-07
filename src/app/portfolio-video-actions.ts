"use server";
// Portfolio add-on, Phase 5 — server actions for the Videos screen.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/app/actions";
import { BASE } from "@/lib/portfolio/constants";
import { notifySite } from "@/lib/portfolio/publish/notify";
import { adminMediaStore } from "@/lib/portfolio/publish/storage";
import { addVideo, moveVideo, refreshVideos, removeVideo, setVideoFlag, type VideoDeps } from "@/lib/portfolio/videos";
import { hasApiKey } from "@/lib/youtube/server/yt-data";
import { uploadedInfo } from "@/lib/youtube/server/yt-publish";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const msg = (e: unknown): ActionState => ({ error: e instanceof Error ? e.message : "Something went wrong." });

async function deps(): Promise<VideoDeps> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  const store = adminMediaStore();
  if (!store) throw new Error("Videos need SUPABASE_SECRET_KEY on the server (to copy thumbnails to the public site). Add it in Vercel → Environment Variables.");
  const userId = user.id;
  return {
    sb,
    userId,
    store,
    durationOf: async (ytId) => (hasApiKey() ? (await uploadedInfo({ sb, userId }, null, ytId))?.durationS ?? null : null),
  };
}

/** Tell the public site to refresh the Videos page and the Home page of both languages (does nothing without the site settings). */
async function tellSite() {
  await notifySite([
    { lang: "en", paths: ["/videos", ""] },
    { lang: "es", paths: ["/videos", ""] },
  ]);
}
const done = async (): Promise<ActionState> => {
  revalidatePath(`${BASE}/videos`);
  revalidatePath(BASE);
  await tellSite();
  return { ok: true, at: Date.now() };
};

export async function addVideoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const r = await addVideo(await deps(), s(f, "id"));
    return r.ok ? await done() : { error: r.error };
  } catch (e) {
    return msg(e);
  }
}

export async function refreshVideoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const r = await refreshVideos(await deps(), s(f, "id") || undefined);
    if (!r.ok) return { error: r.error };
    const out = await done();
    return r.skipped ? { ...out, error: `${r.updated} updated. ${r.skipped} could not be refreshed (no longer a finished public video in the YouTube add-on).` } : out;
  } catch (e) {
    return msg(e);
  }
}

export async function removeVideoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const r = await removeVideo(await deps(), s(f, "id"));
    return r.ok ? await done() : { error: r.error };
  } catch (e) {
    return msg(e);
  }
}

export async function flagVideoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const flag = s(f, "flag");
    if (flag !== "is_live" && flag !== "featured") return { error: "Unknown option." };
    const d = await deps();
    const r = await setVideoFlag(d, s(f, "id"), flag, s(f, "value") === "1");
    return r.ok ? await done() : { error: r.error };
  } catch (e) {
    return msg(e);
  }
}

export async function moveVideoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const dir = s(f, "dir");
    if (dir !== "up" && dir !== "down") return { error: "Unknown direction." };
    const r = await moveVideo(await deps(), s(f, "id"), dir);
    return r.ok ? await done() : { error: r.error };
  } catch (e) {
    return msg(e);
  }
}
