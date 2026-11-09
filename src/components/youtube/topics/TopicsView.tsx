"use client";
// Topic list: status on your channel + a grid of formats (free / in progress / parked / published).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createIdeaInTopic } from "@/app/youtube-actions/ideas";
import { ANGLES, FORMATS, videoHref } from "@/lib/youtube/constants";
import { TOPIC_STATUS_INFO, formatGrid, type TopicStatus } from "@/lib/youtube/topics";
import type { TopicWithIdeas } from "@/lib/youtube/server/topics";

const BADGE: Record<TopicStatus, string> = {
  untested: "bg-subtle text-muted",
  testing: "bg-warning-soft text-warning",
  works: "bg-success-soft text-success",
  mixed: "bg-accent-soft text-accent",
  fails: "bg-danger-soft text-danger",
  insufficient: "bg-subtle text-muted",
};
const FILTERS: { id: "all" | TopicStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "untested", label: "Untested" },
  { id: "testing", label: "Testing" },
  { id: "works", label: "Works" },
  { id: "mixed", label: "Mixed" },
  { id: "fails", label: "Doesn't work" },
];

export default function TopicsView({ topics, channelVideos, error }: { topics: TopicWithIdeas[]; channelVideos: number; error: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | TopicStatus>("all");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = topics.filter((t) => filter === "all" || t.status === filter);
  const make = (topicId: string, format: string) =>
    start(async () => {
      setErr(null);
      const r = await createIdeaInTopic(topicId, format);
      if (r.error && !r.id) setErr(r.error);
      else if (r.id) router.push(videoHref(r.id, "idea"));
    });
  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-danger">{error}</p>}
      {err && <p className="text-xs text-danger" role="alert">{err}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === f.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-subtle"}`}>
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">
          {channelVideos} published long video{channelVideos === 1 ? "" : "s"} on your channel
          {channelVideos < 5 && " — verdicts start at 5"}
        </span>
      </div>
      {shown.length === 0 && <p className="text-sm text-muted">{topics.length ? "No topics with that status." : "No topics yet. Capture an idea in the board and its topic shows up here."}</p>}
      <ul className="space-y-3">
        {shown.map((t) => {
          const grid = formatGrid(FORMATS.map((f) => f.id), t.ideas);
          return (
            <li key={t.id} className="space-y-2 rounded-lg border border-line bg-surface p-3 shadow-card">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{t.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[t.status]}`} title={TOPIC_STATUS_INFO[t.status].hint}>
                  {TOPIC_STATUS_INFO[t.status].label}
                </span>
                <span className="text-xs text-faint">{t.ideas.filter((i) => i.kind !== "short").length} idea(s)</span>
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-3">
                {grid.map((c) => {
                  const f = FORMATS.find((x) => x.id === c.format)!;
                  const angle = ANGLES.find((a) => a.id === c.angle)?.label;
                  return (
                    <li key={c.format} className="rounded-md border border-line px-2 py-1.5 text-xs">
                      <p className="flex items-center justify-between gap-1">
                        <span className="font-semibold">{f.label}</span>
                        <span className={c.state === "free" ? "text-faint" : c.state === "published" ? "text-success" : c.state === "parked" ? "text-muted" : "text-warning"}>
                          {c.state === "free" ? "free" : c.state === "published" ? (c.verdict ? `published · ${c.verdict}` : "published") : c.state === "parked" ? "parked" : "in progress"}
                        </span>
                      </p>
                      {c.ideaId ? (
                        <Link href={videoHref(c.ideaId, "idea")} className="mt-0.5 line-clamp-2 text-muted hover:text-accent">
                          {c.label}
                          {angle ? ` · ${angle}` : ""}
                        </Link>
                      ) : (
                        <button type="button" disabled={pending} onClick={() => make(t.id, c.format)} className="mt-0.5 text-accent hover:underline disabled:opacity-50">
                          + Test in this format
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
