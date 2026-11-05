// /youtube/v/[id]/follow-up — after publishing (Worker C): check-ins 48h/7d/30d/90d with "the usual",
// A/B (Test & compare log + 48 h swap), retention by section, comments to answer → ideas, ✨ post-mortem.
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai";
import { videoHref } from "@/lib/youtube/constants";
import { getOauthStatus, getVideo, ytServer } from "@/lib/youtube/db";
import { storedBaseline, loadFollowUp } from "@/lib/youtube/server/results";
import { hasApiKey } from "@/lib/youtube/server/yt-data";
import { activeTestCompare, openSwap, swapAdvice } from "@/lib/youtube/abtest";
import FollowUpView from "@/components/youtube/results/FollowUpView";

export const dynamic = "force-dynamic";

export default async function FollowUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { video, missing } = await getVideo(id);
  if (missing) return null;
  if (!video) notFound();
  const { supabase, userId } = await ytServer();
  if (!userId) return null;
  if (video.stage !== "published" || !video.published_at) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4 text-sm shadow-card">
        <p className="font-medium">Not published yet.</p>
        <p className="mt-1 text-muted">
          Follow-up starts when you press “Mark as published” in the{" "}
          <Link className="text-accent underline" href={videoHref(video.id, "publish")}>
            Publish
          </Link>{" "}
          tab. Then the app reads the numbers at 48 hours, 7, 30 and 90 days.
        </p>
      </div>
    );
  }
  const [d, oauth] = await Promise.all([loadFollowUp({ sb: supabase, userId }, video), getOauthStatus()]);
  const c48 = d.checkins.find((c) => c.kind === "48h");
  const advice =
    c48?.done_at && video.kind === "long"
      ? swapAdvice({ kind: video.kind, views48h: c48.metrics?.views ?? null, base: storedBaseline(c48.baseline, d.viewGoal), tests: d.tests, alternatives: d.pairs.filter((p) => !p.is_primary).length })
      : null;
  return (
    <FollowUpView
      video={{ id: video.id, kind: video.kind, code: video.code, idea_name: video.idea_name, published_at: video.published_at, ytId: d.ytId }}
      checkins={d.checkins.map((c) => ({ id: c.id, kind: c.kind, due_at: c.due_at, done_at: c.done_at, metrics: c.metrics ?? {}, baseline: c.baseline ?? {}, verdict: c.verdict, notes: c.notes }))}
      viewGoal={d.viewGoal}
      tests={d.tests.map((t) => ({ id: t.id, kind: t.kind, pair_ids: t.pair_ids ?? [], from_pair_id: t.from_pair_id, to_pair_id: t.to_pair_id, winner_pair_id: t.winner_pair_id, started_at: t.started_at, ended_at: t.ended_at, verdict: t.verdict, metrics_before: t.metrics_before ?? {}, metrics_after: t.metrics_after ?? {}, attrs: t.attrs ?? {}, notes: t.notes }))}
      pairs={d.pairs.map((p) => ({ id: p.id, label: p.label, is_primary: p.is_primary, title: p.title, image: p.image }))}
      testRunning={activeTestCompare(d.tests)}
      swapOpen={!!openSwap(d.tests)}
      advice={advice}
      retention={d.retention}
      retentionFrom={d.retentionFrom}
      sectionsEstimated={d.sectionsEstimated}
      durationS={d.durationS}
      history={d.history}
      comments={d.comments}
      postmortem={d.postmortem}
      connected={!!oauth?.connected}
      apiKey={hasApiKey()}
      ai={hasAi()}
    />
  );
}
