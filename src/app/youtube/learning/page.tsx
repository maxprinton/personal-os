// /youtube/learning (Worker C) — the learning library: every decided A/B test with the attributes of what won
// and what lost (thumbnail type, scroll stoppers, face, text, composition, title style), wins/losses per
// attribute, results per angle, and the calibration of the idea score (predicted vs real views).
import Link from "next/link";
import { CALIBRATION_MIN_VIDEOS, videoHref, videoLabel } from "@/lib/youtube/constants";
import { ytServer } from "@/lib/youtube/db";
import { loadLearning } from "@/lib/youtube/server/results";

export const metadata = { title: "Learning · YouTube · Personal OS" };
export const dynamic = "force-dynamic";

const BOX = "space-y-3 rounded-lg border border-line bg-surface p-4 shadow-card";
const VL: Record<string, string> = { winner: "Winner", same: "Same", inconclusive: "Inconclusive", no_clear_difference: "No clear difference" };

export default async function LearningPage() {
  const { supabase, userId } = await ytServer();
  if (!userId) return null;
  let d: Awaited<ReturnType<typeof loadLearning>>;
  try {
    d = await loadLearning({ sb: supabase, userId });
  } catch {
    return null; // the layout shows the migration panel
  }
  const vById = new Map(d.videos.map((v) => [v.id, v]));
  const cal = d.calibration;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Learning library</h2>
        <p className="text-sm text-muted">
          What wins on <b>your</b> channel. Each finished A/B test (Test & compare or a 48-hour swap) adds the attributes of the winning and losing title + thumbnail. Only attributes
          that were different between them count.
        </p>
      </div>

      {d.lessons.length > 0 && (
        <section className={BOX}>
          <h3 className="font-semibold">Lessons so far</h3>
          <ul className="list-disc pl-5 text-sm">
            {d.lessons.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      <section className={BOX}>
        <h3 className="font-semibold">Attributes: wins and losses</h3>
        {!d.table.length ? (
          <p className="text-sm text-muted">No finished tests yet. Log a Test & compare result or make a swap in a video’s Follow-up tab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-faint">
                <tr>
                  <th className="py-1 pr-3">Attribute</th>
                  <th className="pr-3">Wins</th>
                  <th className="pr-3">Losses</th>
                  <th className="pr-3">Ties</th>
                  <th className="pr-3">Win rate</th>
                  <th>Tests</th>
                </tr>
              </thead>
              <tbody>
                {d.table.map((r) => (
                  <tr key={r.attr} className="border-t border-line">
                    <td className="py-1 pr-3">{r.attr}</td>
                    <td className="pr-3 text-success">{r.wins}</td>
                    <td className="pr-3 text-danger">{r.losses}</td>
                    <td className="pr-3 text-muted">{r.ties}</td>
                    <td className="pr-3">{r.winRate === null ? "—" : `${Math.round(r.winRate * 100)} %`}</td>
                    <td>{r.tests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-faint">Few tests = weak lessons. Trust an attribute after 3+ decided tests.</p>
          </div>
        )}
      </section>

      <section className={BOX}>
        <h3 className="font-semibold">Tests</h3>
        {!d.rows.length ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-2">
            {d.rows.map((r) => {
              const v = vById.get(r.videoId);
              return (
                <li key={r.testId} className="rounded-md border border-line p-2 text-sm">
                  <p>
                    <Link className="font-medium text-accent underline" href={videoHref(r.videoId, "follow-up")}>
                      {v ? videoLabel(v) : "Video"}
                    </Link>{" "}
                    · {r.kind === "swap" ? "Swap" : "Test & compare"} · {VL[r.verdict] ?? r.verdict} · {r.at.slice(0, 10)}
                  </p>
                  {r.winner && (
                    <p className="text-xs">
                      <span className="text-success">{r.verdict === "winner" ? "Won" : "Pair"}: </span>
                      {r.winner.label} · {r.winner.title} <span className="text-faint">({r.winner.attrs.join(", ")})</span>
                    </p>
                  )}
                  {r.losers.map((l) => (
                    <p key={l.pairId} className="text-xs">
                      <span className={r.verdict === "winner" ? "text-danger" : "text-muted"}>{r.verdict === "winner" ? "Lost" : "Pair"}: </span>
                      {l.label} · {l.title} <span className="text-faint">({l.attrs.join(", ")})</span>
                    </p>
                  ))}
                  {r.angles && r.angles.length > 0 && <p className="text-xs text-faint">Angle: {r.angles.join(", ")}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={BOX}>
        <h3 className="font-semibold">Angles vs results</h3>
        {!d.angles.length ? (
          <p className="text-sm text-muted">Appears when published videos have check-ins with a verdict (needs {5} past videos for “the usual”).</p>
        ) : (
          <ul className="text-sm">
            {d.angles.map((a) => (
              <li key={a.angle}>
                <b>{a.angle}</b>: 🟢 {a.above} · ⚪ {a.normal} · 🔴 {a.below} <span className="text-faint">({a.n} videos)</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={BOX}>
        <h3 className="font-semibold">Calibration: predicted vs real views</h3>
        <p className="text-xs text-muted">
          Compares the predicted views of each idea (Criteria step) with the real views at 30 days (or 7). Ready after {CALIBRATION_MIN_VIDEOS} published long videos — then the idea
          score can be adjusted.
        </p>
        <p className="text-sm">
          {cal.n}/{CALIBRATION_MIN_VIDEOS} videos with real numbers{cal.ready ? " — ready." : "."}
          {cal.medianRatio !== null && <> Real ÷ predicted (median): <b>{cal.medianRatio}×</b>.</>}
          {cal.scoreCorrelation !== null && <> Score vs real views (−1…1): <b>{cal.scoreCorrelation}</b>.</>}
        </p>
        {cal.points.filter((p) => p.at).length > 0 && (
          <ul className="text-xs text-muted">
            {cal.points
              .filter((p) => p.at)
              .slice(0, 20)
              .map((p) => {
                const v = vById.get(p.videoId);
                return (
                  <li key={p.videoId}>
                    {v ? videoLabel(v) : "Video"}: predicted {p.predictedViews ?? "—"} · real {(p.views30d ?? p.views7d)?.toLocaleString("en-US")} ({p.at}){p.ratio !== null ? ` · ${p.ratio}×` : ""}
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}
