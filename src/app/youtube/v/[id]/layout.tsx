// One video: header (code, idea name, stage, kind) + stage tabs linking to the sub-routes (Lead).
import Link from "next/link";
import { notFound } from "next/navigation";
import { getVideo } from "@/lib/youtube/db";
import { BASE, SHORT_ROLES, stageLabel } from "@/lib/youtube/constants";
import { HideOnFullscreen, VideoTabs } from "@/components/youtube/shell/YtNav";
import MigrationPanel from "@/components/youtube/shell/MigrationPanel";

export default async function VideoLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { video, missing } = await getVideo(id);
  if (missing) return <MigrationPanel />;
  if (!video) notFound();
  const role = video.short_role ? SHORT_ROLES.find((r) => r.id === video.short_role)?.label : null;
  return (
    <div className="space-y-4">
      <HideOnFullscreen>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={BASE} className="text-sm text-muted hover:text-accent">
              ← Board
            </Link>
            <span className="rounded-md bg-subtle px-2 py-0.5 font-mono text-xs font-semibold text-muted" title={video.code ? "Video ID (permanent)" : "Gets a V-number when approved"}>
              {video.code ?? "Idea"}
            </span>
            <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.idea_name}</h2>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{stageLabel(video.stage)}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
              {video.kind === "short" ? `Short${role ? ` · ${role}` : ""}` : "Long"}
            </span>
          </div>
          <VideoTabs id={video.id} />
        </div>
      </HideOnFullscreen>
      {children}
    </div>
  );
}
