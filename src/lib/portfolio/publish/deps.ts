// Portfolio publishing — builds the engine's dependencies for the signed-in user. SERVER only.
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Deps } from "./engine";
import { adminMediaStore } from "./storage";

const hostOf = (u: string | undefined) => {
  try {
    return u ? new URL(u.startsWith("http") ? u : `https://${u}`).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/** Host names of this (private) app, so links back to it are never published. */
export async function osHosts(): Promise<string[]> {
  const h = await headers();
  const hosts = [h.get("x-forwarded-host"), h.get("host"), process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL, process.env.NEXT_PUBLIC_SITE_URL, process.env.SITE_URL, process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .map((x) => hostOf(x ?? undefined))
    .filter((x): x is string => !!x);
  return [...new Set(hosts)];
}

export async function publishDeps(): Promise<{ ok: true; deps: Deps } | { ok: false; error: string }> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out. Sign in again." };
  const store = adminMediaStore();
  if (!store) return { ok: false, error: "Publishing needs SUPABASE_SECRET_KEY on the server (to copy images to the public site). Add it in Vercel → Environment Variables." };
  return { ok: true, deps: { db, store, userId: user.id, osHosts: await osHosts() } };
}
