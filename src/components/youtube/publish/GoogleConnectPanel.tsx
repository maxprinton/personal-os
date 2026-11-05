"use client";
// YouTube → Settings · "YouTube API & Google" (Worker C). Mounted by /youtube/settings with the same props the
// Lead's placeholder had. Shows: API key status + today's quota, your channel link, and the Google sign-in
// (connect / reconnect / test / disconnect). Tokens never reach the browser: only the yt_oauth_status() summary.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OAUTH_TESTING_DAYS, YT_QUOTA } from "@/lib/youtube/constants";
import type { YtOauthStatus } from "@/lib/youtube/types";
import { disconnectGoogle, quotaStatus, resolveMyChannel, testGoogle } from "@/app/youtube-actions/api";

export type GoogleConnectPanelProps = {
  /** from getOauthStatus() — null = not connected (or migration 0036 missing) */
  status: YtOauthStatus | null;
  /** YOUTUBE_API_KEY is set on the server */
  apiKeySet: boolean;
  /** GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + YT_TOKEN_KEY are set on the server */
  oauthConfigured: boolean;
  channelUrl: string | null;
};

type Quota = Awaited<ReturnType<typeof quotaStatus>>["quota"];

const BTN = "rounded-md border border-line-strong px-2.5 py-1 text-sm text-fg hover:bg-subtle disabled:opacity-50";
const PRIMARY = "inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover";
const START = "/api/youtube/oauth/start?next=/youtube/settings";

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const daysLeft = (iso: string | null | undefined) => (iso ? Math.ceil((Date.parse(iso) + OAUTH_TESTING_DAYS * 86_400_000 - Date.now()) / 86_400_000) : null);

function Dot({ tone }: { tone: "ok" | "warn" | "off" | "bad" }) {
  const c = tone === "ok" ? "bg-success" : tone === "warn" ? "bg-warning" : tone === "bad" ? "bg-danger" : "bg-faint";
  return <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${c}`} aria-hidden />;
}

function Bar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, total)) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-accent"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function GoogleConnectPanel({ status, apiKeySet, oauthConfigured, channelUrl }: GoogleConnectPanelProps) {
  const router = useRouter();
  const [quota, setQuota] = useState<Quota>(null);
  const [msg, setMsg] = useState<{ error?: string; info?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    quotaStatus().then((r) => setQuota(r.quota)).catch(() => null);
    // Coming back from Google: ?google=connected|error|not_configured (&msg / &channel)
    const q = new URLSearchParams(window.location.search);
    const g = q.get("google");
    if (!g) return;
    if (g === "connected") setMsg({ info: `Google connected${q.get("channel") ? ` · ${q.get("channel")}` : ""}.` });
    else if (g === "not_configured") setMsg({ error: "Google sign-in is not set up on the server yet (ACTIVAR-GOOGLE-OAUTH.md)." });
    else setMsg({ error: q.get("msg") || "Google sign-in failed. Try again." });
    for (const k of ["google", "msg", "channel"]) q.delete(k);
    const rest = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, []);

  const act = (fn: () => Promise<{ ok?: boolean; error?: string; title?: string }>, ok: string | ((r: { title?: string }) => string)) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (r.error) setMsg({ error: r.error });
      else {
        setMsg({ info: typeof ok === "string" ? ok : ok(r) });
        router.refresh();
      }
      quotaStatus().then((q) => setQuota(q.quota)).catch(() => null);
    });

  const connected = !!status?.connected;
  const lost = !!status && !status.connected; // the row exists but the refresh token was dropped
  const left = connected ? daysLeft(status?.connected_at) : null;

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4 text-sm shadow-card">
      <div>
        <h3 className="font-semibold">YouTube API &amp; Google</h3>
        <p className="text-xs text-muted">The API key reads public numbers (outlier finder, watchlist, views). Google sign-in lets the app edit your own videos and read Analytics.</p>
      </div>

      {msg?.error ? <p className="text-xs text-danger" role="alert">{msg.error}</p> : null}
      {msg?.info ? <p className="text-xs text-success">{msg.info}</p> : null}

      {/* API key + quota */}
      <section className="space-y-2">
        <p>
          <Dot tone={apiKeySet ? "ok" : "warn"} />
          YouTube API key: <b className={apiKeySet ? "text-success" : "text-warning"}>{apiKeySet ? "set" : "not set"}</b>
        </p>
        {!apiKeySet ? (
          <p className="text-xs text-muted">
            Add <b>YOUTUBE_API_KEY</b> in Vercel → Settings → Environment Variables and redeploy. Step by step: <b>ACTIVAR-YOUTUBE-API.md</b> (in the PERSONAL OS folder).
          </p>
        ) : null}
        {quota ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted">
                Quota today: <b className="text-fg">{quota.units.toLocaleString()}</b> / {YT_QUOTA.dailyUnits.toLocaleString()} units
              </p>
              <Bar used={quota.units} total={YT_QUOTA.dailyUnits} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted">
                Searches today: <b className="text-fg">{quota.searchCalls}</b> / {YT_QUOTA.searchCallsPerDay}
              </p>
              <Bar used={quota.searchCalls} total={YT_QUOTA.searchCallsPerDay} />
            </div>
            <p className="text-xs text-faint sm:col-span-2">Resets at midnight Pacific time (quota day {quota.day}). Repeated searches come from the 24-hour cache for free.</p>
          </div>
        ) : null}
        <p className="text-xs text-muted">
          Your channel: {channelUrl ? <a href={channelUrl.startsWith("http") ? channelUrl : `https://www.youtube.com/${channelUrl}`} target="_blank" rel="noreferrer" className="text-fg underline">{channelUrl}</a> : <span className="text-warning">not set — add it above</span>}
          {channelUrl && apiKeySet ? (
            <button type="button" className={`${BTN} ml-2 text-xs`} disabled={pending} onClick={() => act(resolveMyChannel, (r) => `Found your channel: ${r.title ?? "OK"}.`)}>
              Check link
            </button>
          ) : null}
        </p>
      </section>

      {/* Google sign-in */}
      <section className="space-y-2 border-t border-line pt-3">
        <p>
          <Dot tone={connected ? "ok" : lost ? "bad" : "off"} />
          Google sign-in:{" "}
          <b className={connected ? "text-success" : lost ? "text-danger" : "text-muted"}>
            {connected ? `connected${status?.channel_title ? ` · ${status.channel_title}` : ""}` : lost ? "needs reconnecting" : oauthConfigured ? "not connected" : "not set up"}
          </b>
        </p>

        {!oauthConfigured ? (
          <p className="text-xs text-muted">
            To publish from here and read Analytics, add <b>GOOGLE_CLIENT_ID</b>, <b>GOOGLE_CLIENT_SECRET</b> and <b>YT_TOKEN_KEY</b> in Vercel. Step by step: <b>ACTIVAR-GOOGLE-OAUTH.md</b>. Everything else works without it.
          </p>
        ) : connected ? (
          <>
            <ul className="space-y-0.5 text-xs text-muted">
              <li>Connected: {when(status?.connected_at)} · last refresh: {when(status?.last_refresh_at)}</li>
              {left !== null ? (
                <li className={left <= 1 ? "text-warning" : undefined}>
                  While the Google app is in “Testing”, Google ends the sign-in about every {OAUTH_TESTING_DAYS} days{left > 0 ? ` (≈ ${left} day${left === 1 ? "" : "s"} left)` : " (any moment now)"}. You get a Telegram message when it is time to reconnect.
                </li>
              ) : null}
              {status?.scopes?.length ? <li>Permissions: {status.scopes.map((s) => s.split("/").pop()).join(", ")}</li> : null}
              {status?.last_error ? <li className="text-danger">Last problem: {status.last_error}</li> : null}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN} disabled={pending} onClick={() => act(testGoogle, "The connection works.")}>
                {pending ? "…" : "Test connection"}
              </button>
              <a href={START} className={BTN}>
                Reconnect
              </a>
              <button
                type="button"
                className={`${BTN} hover:text-danger`}
                disabled={pending}
                onClick={() => {
                  if (confirm("Disconnect Google? Publishing from here and Analytics stop until you connect again.")) act(disconnectGoogle, "Google disconnected.");
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            {lost && status?.last_error ? <p className="text-xs text-danger">{status.last_error}</p> : null}
            <p className="text-xs text-muted">Sign in with the Google account that owns your channel. Use an account listed as a test user in your Google Cloud app.</p>
            <div className="flex flex-wrap gap-2">
              <a href={START} className={PRIMARY}>
                {lost ? "Reconnect Google" : "Connect Google"}
              </a>
              {lost ? (
                <button type="button" className={BTN} disabled={pending} onClick={() => act(disconnectGoogle, "Old connection removed.")}>
                  Remove old connection
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
