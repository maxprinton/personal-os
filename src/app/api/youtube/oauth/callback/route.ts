// GET /api/youtube/oauth/callback?code=…&state=… — Google sends the user back here after the consent screen.
// Checks the state cookie, swaps the code for tokens, stores them ENCRYPTED in yt_oauth (admin client only)
// and goes back to the page that started it with ?google=connected (or ?google=error&msg=…).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode, oauthConfigured, redirectUri, safeNext, saveConnection, STATE_COOKIE } from "@/lib/youtube/server/yt-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: "You cancelled the Google sign-in (or your account is not in the app's test users list — see ACTIVAR-GOOGLE-OAUTH.md).",
  invalid_scope: "Google refused the requested permissions.",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  let saved: { state?: string; next?: string; uid?: string } = {};
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`).exec(cookie);
  try {
    saved = m ? JSON.parse(decodeURIComponent(m[1])) : {};
  } catch {
    saved = {};
  }
  const next = safeNext(saved.next);
  const back = (q: string) => {
    const r = NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}${q}`, url.origin));
    r.cookies.set(STATE_COOKIE, "", { path: "/api/youtube/oauth", maxAge: 0 });
    return r;
  };
  const fail = (msg: string) => back(`google=error&msg=${encodeURIComponent(msg.slice(0, 300))}`);

  const gErr = url.searchParams.get("error");
  if (gErr) return fail(GOOGLE_ERRORS[gErr] ?? `Google said: ${gErr}`);
  if (!oauthConfigured()) return back("google=not_configured");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !saved.state || state !== saved.state) return fail("The sign-in took too long or came from another tab. Press Connect again.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  if (saved.uid && saved.uid !== user.id) return fail("You signed in to Personal OS with another account meanwhile. Press Connect again.");

  const t = await exchangeCode(code, redirectUri(url.origin));
  if (!t.access_token) {
    const why = t.error === "redirect_uri_mismatch" ? "The redirect URI in Google Cloud does not match this site (ACTIVAR-GOOGLE-OAUTH.md, step 5)." : t.error_description || t.error || "Google gave no token.";
    return fail(why);
  }
  const res = await saveConnection(user.id, t);
  if (res.error) return fail(res.error);
  return back(`google=connected${res.channelTitle ? `&channel=${encodeURIComponent(res.channelTitle)}` : ""}`);
}
