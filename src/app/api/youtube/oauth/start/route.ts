// GET /api/youtube/oauth/start[?next=/youtube/v/V012/publish] → Google consent screen (offline access).
// A random `state` goes in a short-lived httpOnly cookie and is checked in the callback (CSRF protection).
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authUrl, oauthConfigured, redirectUri, safeNext, STATE_COOKIE } from "@/lib/youtube/server/yt-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const back = (q: string) => NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}${q}`, url.origin));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  if (!oauthConfigured()) return back("google=not_configured");
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(state, redirectUri(url.origin)));
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, next, uid: user.id }), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/api/youtube/oauth",
    maxAge: 600,
  });
  return res;
}
