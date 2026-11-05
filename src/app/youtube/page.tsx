// /youtube — the pipeline board (Worker A): new-idea box, WIP limit, idea bank by score, columns by stage
// with the next step of each video, Long/Short filter, parked (archived) ideas.
import Link from "next/link";
import Section from "@/components/ui/Section";
import NewIdeaBox from "@/components/youtube/board/NewIdeaBox";
import MoveMenu from "@/components/youtube/board/MoveMenu";
import { getYtSettings, listVideos, ytServer } from "@/lib/youtube/db";
import { BASE, BOARD_STAGES, IDEA_SOURCES, IDEA_STEPS, SHORT_ROLES, STAGES, stageInfo, videoHref } from "@/lib/youtube/constants";
import { gateStatus, nextStep, sortBank, wipStatus } from "@/lib/youtube/scoring";
import type { YtStage, YtVideo } from "@/lib/youtube/types";

export const dynamic = "force-dynamic";

type Filter = "all" | "long" | "short";

function daysSince(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
}

function KindBadge({ v }: { v: YtVideo }) {
  if (v.kind !== "short") return null;
  const role = SHORT_ROLES.find((r) => r.id === v.short_role)?.label;
  return <span className="rounded-full border border-line px-1.5 text-[10px] text-muted">Short{role ? ` · ${role}` : ""}</span>;
}

function ScoreBadge({ v }: { v: YtVideo }) {
  const g = gateStatus(v.gates);
  const rated = Object.keys(v.ratings ?? {}).length > 0;
  if (!rated && v.data_score == null) return <span className="w-9 shrink-0 text-center text-xs text-faint">—</span>;
  const tone = g === "fail" ? "bg-danger-soft text-danger" : v.priority >= 70 ? "bg-success-soft text-success" : v.priority >= 45 ? "bg-accent-soft text-accent" : "bg-subtle text-muted";
  return (
    <span className={`w-9 shrink-0 rounded-md px-1 py-0.5 text-center text-xs font-semibold tabular-nums ${tone}`} title={g === "fail" ? "A gate said no" : "Idea score (0–100)"}>
      {v.priority}
    </span>
  );
}

export default async function YoutubeBoard({ searchParams }: { searchParams: Promise<{ kind?: string; parked?: string }> }) {
  const sp = await searchParams;
  const filter: Filter = sp.kind === "long" || sp.kind === "short" ? sp.kind : "all";
  const showParked = sp.parked === "1";
  const [{ settings }, { videos: all, missing }] = await Promise.all([getYtSettings(), listVideos({ includeArchived: true })]);
  if (missing) return null; // the layout shows the migration panel

  // Counts for "next step": titles/thumbnails (package) and research cards
  const ids = all.filter((v) => v.stage === "package" || v.stage === "research").map((v) => v.id);
  const counts = new Map<string, { titles: number; thumbs: number; cards: number }>();
  if (ids.length) {
    const { supabase } = await ytServer();
    const [vars, cards] = await Promise.all([
      supabase.from("yt_variants").select("video_id,kind").in("video_id", ids).eq("archived", false),
      supabase.from("yt_cards").select("video_id").in("video_id", ids),
    ]);
    for (const r of (vars.data ?? []) as { video_id: string; kind: string }[]) {
      const c = counts.get(r.video_id) ?? { titles: 0, thumbs: 0, cards: 0 };
      if (r.kind === "title") c.titles++;
      else c.thumbs++;
      counts.set(r.video_id, c);
    }
    for (const r of (cards.data ?? []) as { video_id: string }[]) {
      const c = counts.get(r.video_id) ?? { titles: 0, thumbs: 0, cards: 0 };
      c.cards++;
      counts.set(r.video_id, c);
    }
  }

  // Shorts made from each long video (children by parent_id), shown on the parent's card.
  const shortsOf = new Map<string, number>();
  for (const v of all) if (v.kind === "short" && v.parent_id && v.stage !== "archived") shortsOf.set(v.parent_id, (shortsOf.get(v.parent_id) ?? 0) + 1);

  const wip = wipStatus(all.map((v) => v.stage), settings?.wip_limit);
  const shown = all.filter((v) => filter === "all" || v.kind === filter);
  const bank = sortBank(shown.filter((v) => v.stage === "bank" || v.stage === "idea"));
  const parked = shown.filter((v) => v.stage === "archived");
  const pipeline = BOARD_STAGES.filter((s) => s !== "bank" && s !== "idea");
  const byStage = new Map<YtStage, YtVideo[]>(pipeline.map((s) => [s, shown.filter((v) => v.stage === s)]));
  const href = (k: Filter, parkedOn = showParked) => {
    const q = new URLSearchParams();
    if (k !== "all") q.set("kind", k);
    if (parkedOn) q.set("parked", "1");
    const s = q.toString();
    return s ? `${BASE}?${s}` : BASE;
  };
  const sourceLabel = (s: string) => IDEA_SOURCES.find((x) => x.id === s)?.label ?? s;

  return (
    <div className="space-y-6">
      <NewIdeaBox />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className={`rounded-md px-2.5 py-1.5 text-sm ${wip.over ? "bg-warning-soft text-warning" : wip.atLimit ? "bg-accent-soft text-accent" : "bg-subtle text-muted"}`}
          role={wip.over ? "alert" : undefined}
        >
          🛠 In progress: <b className="tabular-nums">{wip.count}</b> / {wip.limit}
          {wip.over ? " — over your limit. Finish one before starting another." : wip.atLimit ? " — at your limit." : ""}
          <Link href={`${BASE}/settings`} className="ml-2 text-xs underline-offset-2 hover:underline">
            change
          </Link>
        </div>
        <nav aria-label="Filter" className="flex items-center gap-1 text-sm">
          {(["all", "long", "short"] as Filter[]).map((k) => (
            <Link key={k} href={href(k)} className={`rounded-md px-2.5 py-1 ${filter === k ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle"}`}>
              {k === "all" ? "All" : k === "long" ? "Long" : "Shorts"}
            </Link>
          ))}
          <Link href={href(filter, !showParked)} className={`ml-1 rounded-md px-2.5 py-1 ${showParked ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-subtle"}`}>
            Parked ({all.filter((v) => v.stage === "archived").length})
          </Link>
        </nav>
      </div>

      <Section title="Idea bank" count={bank.length}>
        {bank.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No ideas yet. Write one above, send “yt: …” to the Telegram bot, or turn a note into an idea.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            {bank.map((v) => {
              const g = gateStatus(v.gates);
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <ScoreBadge v={v} />
                  <div className="min-w-0 flex-1">
                    <Link href={videoHref(v.id, "idea")} className="block truncate text-sm font-medium hover:text-accent">
                      {v.idea_name}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span className={g === "fail" ? "text-danger" : ""}>{nextStep(v)}</span>
                      <span className="text-faint">· {v.stage === "idea" ? `Ideation · ${IDEA_STEPS.find((x) => x.id === v.step)?.label ?? v.step}` : "Bank"}</span>
                      {v.source !== "web" && <span className="text-faint">· from {sourceLabel(v.source)}</span>}
                      <KindBadge v={v} />
                    </p>
                  </div>
                  <MoveMenu id={v.id} stage={v.stage} compact />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Pipeline" count={pipeline.reduce((n, s) => n + (byStage.get(s)?.length ?? 0), 0)}>
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="flex flex-col gap-3 md:flex-row md:items-start">
            {pipeline.map((s) => {
              const list = byStage.get(s) ?? [];
              const info = stageInfo(s);
              return (
                <section key={s} aria-label={info.label} className="rounded-lg border border-line bg-subtle p-2 md:w-60 md:shrink-0">
                  <header className="mb-2 flex items-baseline justify-between gap-2 px-1">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{info.label}</h3>
                    <span className="text-xs tabular-nums text-faint">{list.length}</span>
                  </header>
                  {list.length === 0 ? (
                    <p className="px-1 pb-1 text-xs text-faint">{info.hint}</p>
                  ) : (
                    <ul className="space-y-2">
                      {list.map((v) => (
                        <li key={v.id} className="space-y-1.5 rounded-md border border-line bg-surface p-2 shadow-card">
                          <Link href={videoHref(v.id, info.tab)} className="block hover:text-accent">
                            <span className="mr-1 font-mono text-[11px] font-semibold text-muted">{v.code ?? "—"}</span>
                            <span className="text-sm font-medium">{v.idea_name}</span>
                          </Link>
                          <p className="text-xs text-accent">→ {nextStep(v, counts.get(v.id))}</p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                            <KindBadge v={v} />
                            <span title="Time in this stage">{daysSince(v.stage_changed_at)}</span>
                            {v.kind === "long" && (shortsOf.get(v.id) ?? 0) > 0 && (
                              <span className="rounded-full border border-line px-1.5" title="Shorts made from this video">
                                {shortsOf.get(v.id)} Short{shortsOf.get(v.id) === 1 ? "" : "s"}
                              </span>
                            )}
                            {v.kind === "long" && (v.stage === "publish" || v.stage === "published") && (
                              <Link href={`${videoHref(v.id, "publish")}#shorts`} className="rounded-full border border-line px-1.5 text-accent hover:bg-accent-soft" title="Make a Short from this video (Publish → Shorts from this video)">
                                + Short
                              </Link>
                            )}
                          </div>
                          <MoveMenu id={v.id} stage={v.stage} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </Section>

      {showParked && (
        <Section title="Parked" count={parked.length}>
          {parked.length === 0 ? (
            <p className="text-sm text-faint">Nothing parked.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {parked.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link href={videoHref(v.id, "idea")} className="block truncate text-sm hover:text-accent">
                      {v.code ? `${v.code} · ` : ""}
                      {v.idea_name}
                    </Link>
                    {v.archived_reason && <p className="text-xs text-muted">{v.archived_reason}</p>}
                  </div>
                  <MoveMenu id={v.id} stage={v.stage} compact />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      <p className="text-xs text-faint">
        Stages: {STAGES.filter((s) => s.id !== "archived").map((s) => s.label).join(" → ")}. Only 3 hard gates: Criteria to leave the bank, a climax before the script, intro Final + Filmed before publishing.
      </p>
    </div>
  );
}
