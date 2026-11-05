// Server only — Google OAuth 2.0 (web server flow, offline access) for the user's own channel:
// publishing metadata (videos.update, thumbnails.set, playlistItems.insert, captions.insert), A/B swaps and
// YouTube Analytics. Tokens are ENCRYPTED (AES-GCM, YT_TOKEN_KEY) and stored ONLY in yt_oauth through the
// admin client (the browser can never read that table). Unverified app in "Testing" → Google ends the
// consent after ~7 days: then the refresh fails, we mark it and ask to "Reconnect Google" (page + Telegram).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { OAUTH_TESTING_DAYS, REMINDER_KINDS } from "@/lib/youtube/constants";
import { decryptToken, encryptToken, tokenKey } from "@/lib/youtube/server/token-crypto";
import { ytFetch } from "@/lib/youtube/server/yt-data";
import type { ApiChannelItem, ApiList } from "@/lib/youtube/outliers";
import type { YtOauth } from "@/lib/youtube/types";

export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";
export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/yt-analytics.readonly"] as const;
export const CALLBACK_PATH = "/api/youtube/oauth/callback";
export const STATE_COOKIE = "yt_oauth_state";
export const RECONNECT_MESSAGE = "Google sign-in expired (unverified apps must reconnect about every 7 days). Reconnect Google in YouTube → Settings.";

export function oauthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim() && tokenKey());
}

/** Only local /youtube paths may be the place to come back to after the consent screen. */
export function safeNext(next: string | null | undefined) {
  return next && /^\/youtube(\/[\w\-./?=&%]*)?$/.test(next) && !next.includes("//") ? next : "/youtube/settings";
}

/** The redirect URI registered in Google Cloud (GOOGLE_REDIRECT_URI overrides; else this site's origin). */
export function redirectUri(origin: string) {
  return process.env.GOOGLE_REDIRECT_URI?.trim() || `${origin.replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

export function authUrl(state: string, redirect: string) {
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!.trim());
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", YT_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline"); // → refresh token
  u.searchParams.set("prompt", "consent"); // always give a refresh token (also on reconnect)
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export type TokenAnswer = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string; id_token?: string; error?: string; error_description?: string };

async function tokenCall(params: Record<string, string>): Promise<TokenAnswer> {
  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), ...params }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = ((await res.json().catch(() => ({}))) ?? {}) as TokenAnswer;
    if (!res.ok && !j.error) j.error = `http_${res.status}`;
    return j;
  } catch {
    return { error: "network", error_description: "Could not reach Google." };
  }
}

export const exchangeCode = (code: string, redirect: string) => tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirect });
export const refreshAccess = (refreshToken: string) => tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });

function admin(): SupabaseClient {
  const a = createAdminClient();
  if (!a) throw new Error("SUPABASE_SECRET_KEY is missing in Vercel.");
  return a;
}

/** Saves a fresh connection (after the callback). Reads the channel with the new token (1 unit). */
export async function saveConnection(userId: string, t: TokenAnswer): Promise<{ channelTitle: string | null; error?: string }> {
  const key = tokenKey();
  if (!key) return { channelTitle: null, error: "YT_TOKEN_KEY is missing in Vercel." };
  if (!t.access_token) return { channelTitle: null, error: t.error_description || t.error || "Google gave no access token." };
  const a = admin();
  const { data: prev } = await a.from("yt_oauth").select("refresh_token_enc").eq("user_id", userId).maybeSingle();
  const refreshEnc = t.refresh_token ? encryptToken(t.refresh_token, key) : ((prev?.refresh_token_enc as string | null) ?? null);
  if (!refreshEnc) return { channelTitle: null, error: "Google gave no refresh token. Remove the app's access at myaccount.google.com/permissions and connect again." };
  let channelId: string | null = null;
  let channelTitle: string | null = null;
  try {
    const j = await ytFetch<ApiList<ApiChannelItem>>({ sb: a, userId }, "channels", { part: "snippet", mine: true }, { cost: "channelsList", token: t.access_token });
    channelId = j.items?.[0]?.id ?? null;
    channelTitle = j.items?.[0]?.snippet?.title ?? null;
  } catch {
    // the channel name is nice to have
  }
  const now = new Date().toISOString();
  const { error } = await a.from("yt_oauth").upsert(
    {
      user_id: userId,
      channel_id: channelId,
      channel_title: channelTitle,
      access_token_enc: encryptToken(t.access_token, key),
      refresh_token_enc: refreshEnc,
      expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      scopes: (t.scope ?? YT_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
      connected_at: now,
      last_refresh_at: now,
      last_error: null,
    },
    { onConflict: "user_id" },
  );
  if (error) return { channelTitle, error: error.message.includes("yt_oauth") ? "Run MIGRACION-0031-youtube.sql in Supabase first." : error.message };
  return { channelTitle };
}

export type AccessResult = { token: string; channelId: string | null } | { token: null; error: string; reconnect: boolean };

/**
 * A valid access token for the user (refreshing it when it has < 2 min left). Never sent to the browser.
 * On "invalid_grant" (consent ended / revoked) the connection is marked lost and a Telegram notice goes out.
 */
export async function getAccessToken(userId: string, sb?: SupabaseClient): Promise<AccessResult> {
  if (!oauthConfigured()) return { token: null, error: "Google sign-in is not set up (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YT_TOKEN_KEY — see ACTIVAR-GOOGLE-OAUTH.md).", reconnect: false };
  const key = tokenKey()!;
  const a = sb ?? admin();
  const { data, error } = await a.from("yt_oauth").select("*").eq("user_id", userId).maybeSingle();
  if (error || !data) return { token: null, error: "Google is not connected. Connect it in YouTube → Settings.", reconnect: true };
  const row = data as YtOauth;
  if (!row.refresh_token_enc) return { token: null, error: RECONNECT_MESSAGE, reconnect: true };
  const access = decryptToken(row.access_token_enc, key);
  if (access && row.expires_at && Date.parse(row.expires_at) - Date.now() > 120_000) return { token: access, channelId: row.channel_id };
  const refresh = decryptToken(row.refresh_token_enc, key);
  if (!refresh) {
    await a.from("yt_oauth").update({ last_error: "The token key changed (YT_TOKEN_KEY). Reconnect Google.", refresh_token_enc: null, access_token_enc: null }).eq("user_id", userId);
    return { token: null, error: "The token key changed (YT_TOKEN_KEY). Reconnect Google.", reconnect: true };
  }
  const t = await refreshAccess(refresh);
  if (!t.access_token) {
    const lost = t.error === "invalid_grant" || t.error === "unauthorized_client";
    await a
      .from("yt_oauth")
      .update({ last_error: lost ? RECONNECT_MESSAGE : `Refresh failed: ${t.error_description || t.error}`, ...(lost ? { refresh_token_enc: null, access_token_enc: null } : {}) })
      .eq("user_id", userId);
    if (lost) await noticeLost(a, userId).catch(() => null);
    return { token: null, error: lost ? RECONNECT_MESSAGE : "Google did not answer. Try again in a minute.", reconnect: lost };
  }
  await a
    .from("yt_oauth")
    .update({
      access_token_enc: encryptToken(t.access_token, key),
      ...(t.refresh_token ? { refresh_token_enc: encryptToken(t.refresh_token, key) } : {}),
      expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      last_refresh_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("user_id", userId);
  return { token: t.access_token, channelId: row.channel_id };
}

/** Disconnect: revoke at Google (best effort) and delete the row. */
export async function disconnect(userId: string) {
  const a = admin();
  const key = tokenKey();
  const { data } = await a.from("yt_oauth").select("refresh_token_enc,access_token_enc").eq("user_id", userId).maybeSingle();
  const tok = key ? decryptToken((data?.refresh_token_enc as string | null) ?? null, key) ?? decryptToken((data?.access_token_enc as string | null) ?? null, key) : null;
  if (tok) await fetch(`${GOOGLE_REVOKE}?token=${encodeURIComponent(tok)}`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => null);
  await a.from("yt_oauth").delete().eq("user_id", userId);
}

/** When the consent of an unverified app runs out (~7 days after connecting). */
export function expectedExpiry(connectedAt: string | null | undefined) {
  if (!connectedAt) return null;
  return new Date(Date.parse(connectedAt) + OAUTH_TESTING_DAYS * 86_400_000).toISOString();
}

/** Telegram notice "Reconnect Google" (once a day at most). */
export async function noticeLost(a: SupabaseClient, userId: string) {
  const { claim } = await import("@/lib/reminders");
  const { send } = await import("@/lib/bot/tg");
  const { reconnectText } = await import("@/lib/bot/youtube-nudges");
  const { botToken } = await import("@/lib/telegram");
  if (!botToken()) return false;
  const { data } = await a.from("user_settings").select("telegram_chat_id").eq("user_id", userId).maybeSingle();
  const chat = data?.telegram_chat_id as number | null | undefined;
  if (!chat) return false;
  if (!(await claim(a, userId, REMINDER_KINDS.oauth, `lost:${new Date().toISOString().slice(0, 10)}`))) return false;
  await send(chat, reconnectText("lost"));
  return true;
}
