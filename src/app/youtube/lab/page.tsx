// /youtube/lab — Research Laboratory overview (Worker A): every video's research, notes used by several
// videos, recurring topics, video ↔ video links, and the topic shelves (buckets outside any video).
import Link from "next/link";
import { hasAi } from "@/lib/ai";
import { ytServer } from "@/lib/youtube/db";
import { LINK_KINDS, stageLabel, videoHref } from "@/lib/youtube/constants";
import { labOverview, noteHref, recurringTerms } from "@/lib/youtube/research";
import { loadLab } from "@/components/youtube/research/load";
import ResearchLab from "@/components/youtube/research/ResearchLab";
import { labVideoLabel } from "@/components/youtube/research/shared";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { note: "notes", fragment: "quotes", quick: "quick", link: "links", reference: "refs" };

export default async function LabPage() {
  const lab = await loadLab();
  const { supabase } = await ytServer();
  const { data: topics } = await supabase.from("yt_videos").select("id,topic,tags").neq("stage", "archived").limit(1000);
  const topicById = new Map(((topics ?? []) as { id: string; topic: string | null; tags: string[] | null }[]).map((t) => [t.id, t]));
  const notesById = new Map(lab.notes.map((n) => [n.id, n]));
  const shelves = lab.buckets.filter((b) => b.video_id === null);
  const shelfIds = new Set(shelves.map((s) => s.id));
  const overview = labOverview(lab.cards, lab.videos);
  const recurring = recurringTerms(
    lab.videos.map((v) => {
      const noteIds = new Set(lab.cards.filter((c) => c.video_id === v.id && c.note_id).map((c) => c.note_id as string));
      const t = topicById.get(v.id);
      return {
        videoId: v.id,
        text: [v.idea_name, t?.topic ?? ""].join(" "),
        tags: [...(t?.tags ?? []), ...[...noteIds].flatMap((id) => notesById.get(id)?.tags ?? [])],
      };
    }),
    { min: 2, limit: 24 },
  );
  const byId = new Map(lab.videos.map((v) => [v.id, v]));
  const links = lab.links.filter((l) => byId.has(l.from_id) && byId.has(l.to_id));
  const kindLabel = (k: string) => LINK_KINDS.find((x) => x.id === k)?.label ?? k;
  const BOX = "space-y-2 rounded-lg border border-line bg-surface p-4 shadow-card";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Research Laboratory</h1>
        <p className="text-xs text-muted">All your video research in one place, the notes and topics that keep coming back, and your topic shelves.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={BOX}>
          <h2 className="text-sm font-semibold">Research by video</h2>
          {overview.perVideo.length ? (
            <ul className="divide-y divide-line">
              {overview.perVideo.map(({ video, cards, notes, byKind }) => (
                <li key={video.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <Link href={videoHref(video.id, "research")} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {labVideoLabel(video)}
                  </Link>
                  <span className="text-[11px] text-faint">{stageLabel(video.stage)}</span>
                  <span className="text-xs text-muted">
                    {cards} cards · {notes} notes
                  </span>
                  <span className="w-full text-[11px] text-faint">
                    {Object.entries(byKind)
                      .map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-faint">No research yet. Open a video → Research tab to start.</p>
          )}
          <p className="text-[11px] text-faint">{overview.shelfCards} card(s) on topic shelves.</p>
        </section>

        <section className={BOX}>
          <h2 className="text-sm font-semibold">Notes used in several videos</h2>
          {overview.shared.length ? (
            <ul className="space-y-1.5">
              {overview.shared.slice(0, 20).map((s) => (
                <li key={s.noteId} className="text-sm">
                  <Link href={noteHref(s.noteId)} className="font-medium hover:underline">
                    {notesById.get(s.noteId)?.title ?? "(deleted note)"}
                  </Link>
                  <span className="text-xs text-muted"> — used in </span>
                  {s.videos.map((v, i) => (
                    <span key={v.id} className="text-xs">
                      {i > 0 && ", "}
                      <Link href={videoHref(v.id, "research")} className="text-accent hover:underline">
                        {labVideoLabel(v)}
                      </Link>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-faint">No note is shared between videos yet.</p>
          )}
          <h2 className="pt-2 text-sm font-semibold">Recurring topics</h2>
          {recurring.length ? (
            <div className="flex flex-wrap gap-1.5">
              {recurring.map((r) => (
                <span key={`${r.tag}-${r.term}`} className={`rounded-full border px-2 py-0.5 text-xs ${r.tag ? "border-accent/40 text-accent" : "border-line text-muted"}`} title={`${r.videos} videos`}>
                  {r.tag ? "#" : ""}
                  {r.term} <span className="text-faint">×{r.videos}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-faint">Topics that show up in 2+ videos will appear here.</p>
          )}
        </section>
      </div>

      {links.length > 0 && (
        <section className={BOX}>
          <h2 className="text-sm font-semibold">Linked videos</h2>
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={videoHref(l.from_id, "research")} className="hover:underline">
                  {labVideoLabel(byId.get(l.from_id)!)}
                </Link>
                <span className="rounded bg-subtle px-1.5 text-[11px] text-muted">→ {kindLabel(l.kind)} →</span>
                <Link href={videoHref(l.to_id, "research")} className="hover:underline">
                  {labVideoLabel(byId.get(l.to_id)!)}
                </Link>
                {l.note && <span className="text-xs text-faint">{l.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold">Topic shelves</h2>
          <p className="text-xs text-muted">Permanent buckets outside any video (e.g. “ESL teaching tips”). Any video can copy cards from them in its Research tab.</p>
        </div>
        <ResearchLab
          videoId={null}
          terms={[]}
          notes={lab.notes}
          typeOptions={lab.typeOptions}
          areaOptions={lab.areaOptions}
          buckets={shelves}
          cards={lab.cards.filter((c) => shelfIds.has(c.bucket_id))}
          shelves={[]}
          shelfCards={[]}
          references={lab.references}
          usedIn={lab.usedIn}
          aiReady={hasAi()}
        />
      </section>
    </div>
  );
}
