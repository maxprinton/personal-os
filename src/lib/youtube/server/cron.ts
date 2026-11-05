// YouTube add-on work done by the 5-minute cron (server only, Worker C):
//   1) due check-ins (48h/7d/30d/90d): read the numbers + Telegram nudge (reminder_log "ytcheck")
//   2) open before/after swaps whose "after" window is complete → verdict
//   3) public stats refresh (every ~6 h per user)
//   4) watched channels (weekly) → Telegram "new outliers" ("ytwatch")
//   5) weekly review on the chosen day/time ("ytweekly")
//   6) Google consent ending soon / lost → "Reconnect Google" ("ytoauth")
// Called ONCE per cron run from src/app/api/cron/reminders/route.ts, for all users. Keep the signature.
// Rules: the admin client skips RLS → every query filters by user_id; one user's error never stops the others;
// stops when `budgetMs` is spent; never throws.
import type { SupabaseClient } from "@supabase/supabase-js";
import { REMINDER_KINDS, videoLabel } from "@/lib/youtube/constants";
import { checkinLabel, dueCheckins, ratioText } from "@/lib/youtube/baseline";
import { swapAdvice } from "@/lib/youtube/abtest";
import { weeklyDue } from "@/lib/youtube/weekly";
import { localNow } from "@/lib/time";
import type { WeeklyReviewPrefs, YtCheckin, YtTest, YtVideo } from "@/lib/youtube/types";

export type YoutubeCronOpts = {
  /** TELEGRAM_BOT_TOKEN is set (messages can be sent) */
  botReady: boolean;
  /** time this function may use, in ms */
  budgetMs: number;
};
export type YoutubeCronResult = { sent: number; refreshed: number };

const MAX_CHECKINS_PER_RUN = 6;
const NUDGE_AFTER_FAIL_MS = 6 * 3600_000;

type UserCtx = { chat: number | null; tz: string };

export async function runYoutubeCron(admin: SupabaseClient, opts: YoutubeCronOpts): Promise<YoutubeCronResult> {
  const deadline = Date.now() + Math.max(1000, opts.budgetMs);
  const left = () => deadline - Date.now();
  const out: YoutubeCronResult = { sent: 0, refreshed: 0 };
  try {
    // Imported lazily so a problem in the YouTube code never breaks the rest of the cron at load time.
    const [{ claim }, tg, nudges, results, data, oauth, watch] = await Promise.all([
      import("@/lib/reminders"),
      import("@/lib/bot/tg"),
      import("@/lib/bot/youtube-nudges"),
      import("@/lib/youtube/server/results"),
      import("@/lib/youtube/server/yt-data"),
      import("@/lib/youtube/server/yt-oauth"),
      import("@/lib/youtube/server/watchlist"),
    ]);
    const users = new Map<string, UserCtx>();
    const userOf = async (userId: string): Promise<UserCtx> => {
      const had = users.get(userId);
      if (had) return had;
      const { data: us } = await admin.from("user_settings").select("timezone,telegram_chat_id").eq("user_id", userId).maybeSingle();
      const u = { chat: (us?.telegram_chat_id as number | null | undefined) ?? null, tz: (us?.timezone as string | undefined) || "America/Guayaquil" };
      users.set(userId, u);
      return u;
    };
    const sendTo = async (userId: string, kind: string, ref: string, text: string) => {
      if (!opts.botReady) return false;
      const u = await userOf(userId);
      if (!u.chat) return false;
      if (!(await claim(admin, userId, kind, ref))) return false;
      await tg.send(u.chat, text);
      out.sent++;
      return true;
    };
    const tokens = new Map<string, string | null>();
    const tokenOf = async (userId: string) => {
      if (tokens.has(userId)) return tokens.get(userId)!;
      let t: string | null = null;
      if (oauth.oauthConfigured()) {
        const { data: row } = await admin.from("yt_oauth").select("refresh_token_enc").eq("user_id", userId).maybeSingle();
        if (row?.refresh_token_enc) {
          const r = await oauth.getAccessToken(userId, admin).catch(() => null);
          t = r && r.token ? r.token : null;
        }
      }
      tokens.set(userId, t);
      return t;
    };
    const ctxOf = (userId: string) => ({ sb: admin, userId });

    // 1) Due check-ins --------------------------------------------------------------------------------
    const now = new Date();
    const { data: dueRows, error: dueErr } = await admin.from("yt_checkins").select("*").is("done_at", null).lte("due_at", now.toISOString()).order("due_at").limit(MAX_CHECKINS_PER_RUN * 3);
    if (dueErr) return out; // tables missing (migration not run) → nothing to do
    for (const ck of dueCheckins((dueRows ?? []) as YtCheckin[], now).slice(0, MAX_CHECKINS_PER_RUN)) {
      if (left() < 3000) break;
      try {
        const { data: vRow } = await admin.from("yt_videos").select("*").eq("user_id", ck.user_id).eq("id", ck.video_id).maybeSingle();
        const v = vRow as YtVideo | null;
        if (!v || v.stage === "archived") {
          await admin.from("yt_checkins").update({ done_at: now.toISOString(), verdict: "insufficient", notes: "Skipped (video archived)." }).eq("id", ck.id);
          continue;
        }
        let line: string | null = null;
        let verdict: string | null = null;
        let error: string | null = null;
        let extra: string | null = null;
        try {
          const r = await results.readCheckin(ctxOf(ck.user_id), ck, v, { token: await tokenOf(ck.user_id), now });
          line = r.line;
          verdict = r.verdict;
          if (ck.kind === "48h" && v.kind === "long") {
            const { data: tests } = await admin.from("yt_tests").select("kind,ended_at").eq("user_id", ck.user_id).eq("video_id", v.id);
            const { count } = await admin.from("yt_pairs").select("id", { count: "exact", head: true }).eq("user_id", ck.user_id).eq("video_id", v.id).eq("is_primary", false);
            const adv = swapAdvice({ kind: v.kind, views48h: r.metrics.views ?? null, base: r.base, tests: (tests ?? []) as Pick<YtTest, "kind" | "ended_at">[], alternatives: count ?? 0 });
            extra = adv.suggest ? `💡 ${adv.reason} Open Follow-up → Swap.` : adv.blocked === "no_baseline" && r.base.goal ? ratioText(r.metrics.views, r.base) : null;
          }
          if (r.notes.length) extra = [extra, ...r.notes].filter(Boolean).join("\n");
        } catch (e) {
          error = e instanceof Error ? e.message : "unknown error";
        }
        if (!error || Date.now() - Date.parse(ck.due_at) > NUDGE_AFTER_FAIL_MS) {
          const ok = await sendTo(ck.user_id, REMINDER_KINDS.checkin, ck.id, nudges.checkinText({ video: videoLabel(v), checkin: checkinLabel(ck.kind), line, verdict, videoId: v.id, extra, error }));
          if (ok) await admin.from("yt_checkins").update({ notified_at: new Date().toISOString() }).eq("id", ck.id);
        }
      } catch (e) {
        console.error("youtube cron check-in", ck.id, e);
      }
    }

    // 2) Open swaps ready to judge -------------------------------------------------------------------------
    if (left() > 4000) {
      const { data: swaps } = await admin.from("yt_tests").select("*").eq("kind", "swap").is("ended_at", null).limit(10);
      for (const t of (swaps ?? []) as YtTest[]) {
        if (left() < 3000) break;
        try {
          const { data: vRow } = await admin.from("yt_videos").select("*").eq("user_id", t.user_id).eq("id", t.video_id).maybeSingle();
          if (vRow) await results.measureSwap(ctxOf(t.user_id), t, vRow as YtVideo, { token: await tokenOf(t.user_id) });
        } catch (e) {
          console.error("youtube cron swap", t.id, e);
        }
      }
    }

    // 3) Stats refresh (one user at a time, every ~6 h each) ---------------------------------------------
    if (left() > 4000 && data.hasApiKey()) {
      const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
      const { data: pubs } = await admin.from("yt_videos").select("user_id").eq("stage", "published").gte("published_at", since).not("youtube_video_id", "is", null).limit(500);
      for (const userId of [...new Set(((pubs ?? []) as { user_id: string }[]).map((p) => p.user_id))]) {
        if (left() < 3000) break;
        try {
          out.refreshed += await results.refreshStats(ctxOf(userId));
        } catch (e) {
          console.error("youtube cron stats", userId, e);
        }
      }
    }

    // 4) Watched channels (each is due every WATCH_CHECK_DAYS) -----------------------------------------
    if (left() > 5000 && data.hasApiKey()) {
      const { data: wc } = await admin.from("yt_watch_channels").select("user_id").eq("active", true).limit(1000);
      for (const userId of [...new Set(((wc ?? []) as { user_id: string }[]).map((r) => r.user_id))]) {
        if (left() < 4000) break;
        try {
          const started = new Date().toISOString();
          const res = await watch.checkDueWatchChannels(ctxOf(userId), { deadline: deadline - 2500 });
          if (res.some((r) => r.found > 0)) {
            const { data: fresh } = await admin.from("yt_watch_outliers").select("title,outlier_score,channel_row_id").eq("user_id", userId).eq("status", "new").gte("found_at", started).limit(20);
            const titles = new Map(res.map((r) => [r.channelRowId, r.title]));
            const items = ((fresh ?? []) as { title: string; outlier_score: number | null; channel_row_id: string | null }[]).map((o) => ({
              title: o.title,
              score: o.outlier_score === null ? null : Math.round(o.outlier_score * 10) / 10,
              channel: o.channel_row_id ? titles.get(o.channel_row_id) ?? null : null,
            }));
            if (items.length) await sendTo(userId, REMINDER_KINDS.watch, started.slice(0, 16), nudges.watchText(items));
          }
        } catch (e) {
          console.error("youtube cron watchlist", userId, e);
        }
      }
    }

    // 5) Weekly review ----------------------------------------------------------------------------------
    if (left() > 4000) {
      const { data: sets } = await admin.from("yt_settings").select("user_id,weekly_review").limit(1000);
      for (const s of (sets ?? []) as { user_id: string; weekly_review: WeeklyReviewPrefs | null }[]) {
        if (left() < 3000) break;
        const prefs = s.weekly_review;
        if (!prefs || typeof prefs.day !== "number") continue;
        try {
          const u = await userOf(s.user_id);
          const local = localNow(u.tz);
          if (!weeklyDue(prefs, local)) continue;
          if (!(await claim(admin, s.user_id, REMINDER_KINDS.weekly, local.date))) continue;
          const canSend = opts.botReady && prefs.telegram && !!u.chat;
          const r = await results.runWeekly(ctxOf(s.user_id), { date: local.date, note: prefs.note, send: canSend ? (t) => tg.send(u.chat!, t) : null, appUrl: nudges.appUrl() });
          if (r.sent) out.sent++;
        } catch (e) {
          console.error("youtube cron weekly", s.user_id, e);
        }
      }
    }

    // 6) Google consent ending (unverified "Testing" apps: ~7 days) -----------------------------------
    if (left() > 1500 && opts.botReady) {
      const { data: rows } = await admin.from("yt_oauth").select("user_id,connected_at,refresh_token_enc").limit(1000);
      for (const r of (rows ?? []) as { user_id: string; connected_at: string | null; refresh_token_enc: string | null }[]) {
        if (left() < 1000) break;
        try {
          if (!r.refresh_token_enc) {
            if (r.connected_at) await sendTo(r.user_id, REMINDER_KINDS.oauth, `lost:${r.connected_at.slice(0, 10)}`, nudges.reconnectText("lost"));
            continue;
          }
          const exp = oauth.expectedExpiry(r.connected_at);
          if (!exp) continue;
          const ms = Date.parse(exp) - Date.now();
          if (ms > 0 && ms < 24 * 3600_000) await sendTo(r.user_id, REMINDER_KINDS.oauth, `soon:${(r.connected_at ?? "").slice(0, 10)}`, nudges.reconnectText("soon"));
        } catch (e) {
          console.error("youtube cron oauth", r.user_id, e);
        }
      }
    }
  } catch (e) {
    console.error("youtube cron", e);
  }
  return out;
}
