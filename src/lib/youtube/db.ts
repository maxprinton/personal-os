// YouTube Pipeline add-on — shared SERVER loaders (Server Components and server actions only).
// Every loader uses the signed-in user's client (RLS "own rows"), and says `missing: true` instead of throwing
// when migration 0031 has not been run, so pages can show the "run the migration" panel.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/calendar/model";
import { DEFAULT_SCORE_WEIGHTS, DEFAULT_WEEKLY, DEFAULT_WIP_LIMIT, DEFAULT_WORDS_PER_MIN, FINDER_DEFAULTS } from "@/lib/youtube/constants";
import type { YtKind, YtOauthStatus, YtSettings, YtStage, YtVideo } from "@/lib/youtube/types";

type PgError = { code?: string; message?: string } | null | undefined;

/** True when the error means "this table/column/function does not exist yet" (migration not run). */
export function isMissingTable(error: PgError, what = "yt_") {
  if (!error) return false;
  const c = error.code ?? "";
  return c === "42P01" || c === "42703" || c === "42883" || c === "PGRST202" || c === "PGRST204" || c === "PGRST205" || (error.message ?? "").includes(what);
}

/** The signed-in user's client + id (userId null = signed out). Cached per request. */
export const ytServer = cache(async (): Promise<{ supabase: SupabaseClient; userId: string | null }> => {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  return { supabase, userId };
});

/** Settings with every default filled in (also when there is no row yet). */
export function defaultYtSettings(userId: string): YtSettings {
  const now = new Date().toISOString();
  return {
    user_id: userId,
    channel_url: null,
    channel_id: null,
    channel_title: null,
    channel_handle: null,
    view_goal: null,
    words_per_min: DEFAULT_WORDS_PER_MIN,
    wip_limit: DEFAULT_WIP_LIMIT,
    finder_filters: { ...FINDER_DEFAULTS },
    score_weights: { ...DEFAULT_SCORE_WEIGHTS },
    sonic_identity: {},
    weekly_review: { ...DEFAULT_WEEKLY },
    publish_defaults: {},
    footage_root: null,
    last_code: 0,
    created_at: now,
    updated_at: now,
  };
}

/** Merges a database row over the defaults (jsonb fields merged key by key). */
export function withSettingsDefaults(userId: string, row: Partial<YtSettings> | null | undefined): YtSettings {
  const d = defaultYtSettings(userId);
  if (!row) return d;
  return {
    ...d,
    ...row,
    finder_filters: { ...d.finder_filters, ...(row.finder_filters ?? {}) },
    score_weights: { ...d.score_weights, ...(row.score_weights ?? {}) },
    sonic_identity: { ...(row.sonic_identity ?? {}) },
    weekly_review: { ...d.weekly_review, ...(row.weekly_review ?? {}) },
    publish_defaults: { ...(row.publish_defaults ?? {}) },
    words_per_min: row.words_per_min ?? d.words_per_min,
    wip_limit: row.wip_limit ?? d.wip_limit,
  };
}

export const getYtSettings = cache(async (): Promise<{ settings: YtSettings | null; missing: boolean }> => {
  const { supabase, userId } = await ytServer();
  if (!userId) return { settings: null, missing: false };
  const { data, error } = await supabase.from("yt_settings").select("*").maybeSingle();
  if (error) return { settings: withSettingsDefaults(userId, null), missing: isMissingTable(error) };
  return { settings: withSettingsDefaults(userId, data as Partial<YtSettings> | null), missing: false };
});

/** One video by id (or by code "V012"). */
export const getVideo = cache(async (idOrCode: string): Promise<{ video: YtVideo | null; missing: boolean }> => {
  const { supabase, userId } = await ytServer();
  if (!userId) return { video: null, missing: false };
  const byCode = /^V\d{3,}$/i.test(idOrCode);
  if (!byCode && !/^[0-9a-f-]{36}$/i.test(idOrCode)) return { video: null, missing: false };
  const q = supabase.from("yt_videos").select("*");
  const { data, error } = await (byCode ? q.eq("code", idOrCode.toUpperCase()) : q.eq("id", idOrCode)).maybeSingle();
  if (error) return { video: null, missing: isMissingTable(error) };
  return { video: (data as YtVideo | null) ?? null, missing: false };
});

export type ListVideosOpts = {
  stages?: YtStage[];
  kind?: YtKind;
  /** default false: archived videos are left out unless asked (or stages includes "archived") */
  includeArchived?: boolean;
  parentId?: string;
  limit?: number;
};

/** Videos of the user, newest stage change first within the board order (position). */
export async function listVideos(opts: ListVideosOpts = {}): Promise<{ videos: YtVideo[]; missing: boolean }> {
  const { supabase, userId } = await ytServer();
  if (!userId) return { videos: [], missing: false };
  let q = supabase.from("yt_videos").select("*");
  if (opts.stages?.length) q = q.in("stage", opts.stages);
  else if (!opts.includeArchived) q = q.neq("stage", "archived");
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.parentId) q = q.eq("parent_id", opts.parentId);
  const { data, error } = await q.order("position").order("stage_changed_at", { ascending: false }).limit(opts.limit ?? 1000);
  if (error) return { videos: [], missing: isMissingTable(error) };
  return { videos: (data ?? []) as YtVideo[], missing: false };
}

/** Google connection (no tokens). null = not connected or migration 0036 missing. */
export async function getOauthStatus(): Promise<YtOauthStatus | null> {
  const { supabase, userId } = await ytServer();
  if (!userId) return null;
  const { data, error } = await supabase.rpc("yt_oauth_status");
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as YtOauthStatus | undefined;
  return row ?? null;
}

export { videoLabel } from "@/lib/youtube/constants";
