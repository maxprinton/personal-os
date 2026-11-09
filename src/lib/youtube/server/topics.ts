// Server only — topics: find-or-create, and the loader that joins topics, their ideas and the 30-day verdicts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { topicKey, topicNameFrom, topicStatus, type TopicIdea, type TopicStatus } from "@/lib/youtube/topics";

export type TopicRow = { id: string; name: string; name_key: string; notes: string | null; created_at: string };
export type TopicWithIdeas = TopicRow & { ideas: TopicIdea[]; status: TopicStatus };

/** Finds the topic with this name (same key) or creates it. `existed` tells which. */
export async function ensureTopic(sb: SupabaseClient, userId: string, raw: string): Promise<{ id: string; name: string; existed: boolean } | { error: string }> {
  const name = topicNameFrom(raw);
  const key = topicKey(name);
  if (!key) return { error: "Write the topic first." };
  const find = async () => (await sb.from("yt_topics").select("id,name").eq("user_id", userId).eq("name_key", key).maybeSingle()).data as { id: string; name: string } | null;
  const have = await find();
  if (have) return { ...have, existed: true };
  const { data, error } = await sb.from("yt_topics").insert({ user_id: userId, name, name_key: key }).select("id,name").single();
  if (error || !data) {
    if (error?.code === "23505") {
      const again = await find();
      if (again) return { ...again, existed: true };
    }
    return { error: error?.message ?? "Couldn't save the topic." };
  }
  return { ...(data as { id: string; name: string }), existed: false };
}

/** Every topic with its long and short ideas (verdict of the 30-day check-in included) and its status on the channel. */
export async function loadTopics(sb: SupabaseClient, userId: string): Promise<{ topics: TopicWithIdeas[]; channelVideos: number; missing: boolean; error?: string }> {
  const [t, v, pub] = await Promise.all([
    sb.from("yt_topics").select("id,name,name_key,notes,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1000),
    sb.from("yt_videos").select("id,code,idea_name,stage,kind,format,angle,published_at,topic_id").eq("user_id", userId).not("topic_id", "is", null).limit(3000),
    sb.from("yt_videos").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "long").not("published_at", "is", null),
  ]);
  const err = t.error ?? v.error;
  if (err) {
    const missing = err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204" || (err.message ?? "").includes("yt_topics");
    return { topics: [], channelVideos: 0, missing, error: err.message };
  }
  const vids = (v.data ?? []) as (TopicIdea & { topic_id: string })[];
  const ids = vids.filter((x) => x.published_at || x.stage === "published").map((x) => x.id);
  const verdicts = new Map<string, string>();
  if (ids.length) {
    const { data } = await sb.from("yt_checkins").select("video_id,verdict").eq("user_id", userId).eq("kind", "30d").not("done_at", "is", null).in("video_id", ids);
    for (const c of (data ?? []) as { video_id: string; verdict: string | null }[]) if (c.verdict) verdicts.set(c.video_id, c.verdict);
  }
  const by = new Map<string, TopicIdea[]>();
  for (const x of vids) {
    const list = by.get(x.topic_id) ?? [];
    list.push({ ...x, verdict30: verdicts.get(x.id) ?? null });
    by.set(x.topic_id, list);
  }
  const channelVideos = pub.count ?? 0;
  const topics = ((t.data ?? []) as TopicRow[]).map((row) => {
    const ideas = by.get(row.id) ?? [];
    return { ...row, ideas, status: topicStatus(ideas, channelVideos) };
  });
  return { topics, channelVideos, missing: false };
}

/** The topic of an existing video (for follow-ups and comment ideas: same topic, another format later). */
export async function topicIdOf(sb: SupabaseClient, userId: string, videoId: string): Promise<string | null> {
  const { data } = await sb.from("yt_videos").select("topic_id").eq("user_id", userId).eq("id", videoId).maybeSingle();
  return ((data as { topic_id?: string | null } | null)?.topic_id as string | null) ?? null;
}
