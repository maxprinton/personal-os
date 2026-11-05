// /youtube/v/[id]/publish — Publish step (Worker C): the package for YouTube (title, description with chapters,
// tags, languages, translations, playlists, schedule), Copy buttons, "Push to YouTube", captions from the
// script, the Studio checklist, "mark as published" (check-ins) and Shorts (children of a long / the Short path).
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai";
import { getOauthStatus, getVideo, ytServer } from "@/lib/youtube/db";
import { chaptersForVideo } from "@/lib/youtube/chapters";
import { stripSources } from "@/lib/youtube/outline";
import { captionTextFromSections } from "@/lib/youtube/publish-rules";
import { loadPublishData } from "@/lib/youtube/server/publish-data";
import { hasApiKey } from "@/lib/youtube/server/yt-data";
import { oauthConfigured } from "@/lib/youtube/server/yt-oauth";
import PublishWorkspace from "@/components/youtube/publish/PublishWorkspace";
import CaptionsPanel from "@/components/youtube/publish/CaptionsPanel";
import ShortsPanel from "@/components/youtube/shorts/ShortsPanel";
import ShortInfo from "@/components/youtube/shorts/ShortInfo";

export const dynamic = "force-dynamic";

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { video, missing } = await getVideo(id);
  if (missing) return null;
  if (!video) notFound();
  const { supabase, userId } = await ytServer();
  if (!userId) return null;
  const [d, oauth] = await Promise.all([loadPublishData(supabase, userId, video), getOauthStatus()]);
  const uploaded = (d.publish?.post_plan?.uploaded ?? null) as { duration_s?: number | null; privacy?: string | null; title?: string | null } | null;
  const durationS = uploaded?.duration_s ?? d.cutSeconds;
  const suggested = video.kind === "long" && d.sections.length ? chaptersForVideo(d.sections, { wpm: d.settings.words_per_min, durationS }) : null;
  const connected = !!oauth?.connected;
  const scriptCaption = captionTextFromSections(d.sections, stripSources);
  return (
    <div className="space-y-6">
      {video.kind === "short" && (
        <ShortInfo
          video={{ id: video.id, short_role: video.short_role, source_start_s: video.source_start_s, source_end_s: video.source_end_s, quick_notes: video.quick_notes, stage: video.stage }}
          parent={d.parent}
          hasScript={d.sections.some((s) => (s.content ?? "").trim())}
          captionsDone={!!d.publish?.captions_pushed}
          relatedDone={!!d.publish?.checklist?.related_video}
        />
      )}
      <PublishWorkspace
        video={{ id: video.id, kind: video.kind, code: video.code, idea_name: video.idea_name, stage: video.stage, youtube_video_id: d.publish?.youtube_video_id ?? video.youtube_video_id, published_at: video.published_at }}
        publish={d.publish ? { fields: d.publish.fields ?? {}, localizations: d.publish.localizations ?? {}, chapters: d.publish.chapters ?? [], playlists: d.publish.playlists ?? [], checklist: d.publish.checklist ?? {}, pinned_comment: d.publish.pinned_comment, push_log: d.publish.push_log ?? [], pushed_at: d.publish.pushed_at, post_plan: d.publish.post_plan ?? {} } : null}
        defaults={d.settings.publish_defaults}
        timezone={d.timezone}
        pairs={d.pairs}
        primary={d.primary}
        suggestedChapters={suggested ? { chapters: suggested.chapters, estimated: suggested.estimated, problems: suggested.check.problems } : null}
        introStatus={d.introStatus}
        music={d.music}
        watchNext={d.watchNext ? { id: d.watchNext.id, label: `${d.watchNext.code ?? "Idea"} · ${d.watchNext.idea_name}`, ytId: d.watchNext.youtube_video_id } : null}
        parent={d.parent ? { id: d.parent.id, label: `${d.parent.code ?? "Idea"} · ${d.parent.idea_name}`, ytId: d.parent.youtube_video_id } : null}
        durationS={durationS}
        uploaded={uploaded}
        checkins={d.checkins.map((c) => ({ kind: c.kind, due_at: c.due_at, done_at: c.done_at, verdict: c.verdict }))}
        google={{ configured: oauthConfigured(), connected, channel: oauth?.channel_title ?? null, error: oauth?.last_error ?? null }}
        apiKey={hasApiKey()}
        aiReady={hasAi()}
      />
      <CaptionsPanel
        videoId={video.id}
        linked={!!(d.publish?.youtube_video_id ?? video.youtube_video_id)}
        connected={connected}
        aiReady={hasAi()}
        captions={d.publish?.captions ?? {}}
        scriptText={scriptCaption}
        wpm={d.settings.words_per_min}
        cutSeconds={durationS}
      />
      {video.kind === "long" && (
        <ShortsPanel
          parent={{ id: video.id, idea_name: video.idea_name, published_at: video.published_at, youtube_video_id: video.youtube_video_id }}
          shorts={d.children}
          timezone={d.timezone}
          doubtfulIdeas={d.doubtfulIdeas}
          apiKey={hasApiKey()}
          durationS={durationS}
        />
      )}
    </div>
  );
}
