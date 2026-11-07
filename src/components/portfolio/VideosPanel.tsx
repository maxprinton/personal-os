"use client";
// Portfolio add-on, Phase 5 — the Videos screen: the list of shown videos and the picker for adding finished ones.
import { addVideoAction, flagVideoAction, moveVideoAction, refreshVideoAction, removeVideoAction } from "@/app/portfolio-video-actions";
import { ActForm, BOX, BTN_PLAIN, BTN_PRIMARY, INPUT } from "@/components/portfolio/ui";
import type { VideoRow } from "@/lib/portfolio/videos";

export type Pick = { id: string; name: string; youtube_video_id: string; published_at: string | null; reason?: string };

const date = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "—");
const length = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "—");
const MINI = "rounded-md border border-line-strong bg-surface px-2 py-1 text-xs hover:bg-subtle disabled:opacity-60";

function Hidden({ id, extra }: { id: string; extra?: Record<string, string> }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

export default function VideosPanel({ rows, picks }: { rows: VideoRow[]; picks: Pick[] }) {
  const ready = picks.filter((p) => !p.reason);
  const blocked = picks.filter((p) => p.reason);
  return (
    <div className="space-y-6">
      <section className={BOX}>
        <h2 className="mb-2 text-sm font-semibold">Add a finished video</h2>
        {ready.length === 0 ? (
          <p className="text-sm text-muted">Nothing to add. Videos appear here when they reach the stage “published” in the YouTube add-on, are long (not Shorts), have a YouTube id and are public.</p>
        ) : (
          <ActForm action={addVideoAction} saved="Added ✓" className="flex flex-wrap items-end gap-2">
            {(pending) => (
              <>
                <label className="min-w-[14rem] flex-1 space-y-1 text-xs text-muted">
                  Video
                  <select name="id" className={INPUT} required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {ready.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {date(p.published_at)}
                      </option>
                    ))}
                  </select>
                </label>
                <button className={BTN_PRIMARY} disabled={pending}>
                  {pending ? "Adding…" : "Add"}
                </button>
              </>
            )}
          </ActForm>
        )}
        {blocked.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Not available: {blocked.map((b) => `${b.name} (${b.reason})`).join(" · ")}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">Only the title, a short description, the date, the thumbnail and the length are copied. Scripts, tests and strategy never leave the YouTube add-on.</p>
      </section>

      <section className={BOX}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Shown on the site ({rows.length})</h2>
          {rows.length > 0 && (
            <ActForm action={refreshVideoAction} saved="Refreshed ✓">
              {(pending) => (
                <button className={BTN_PLAIN} disabled={pending}>
                  {pending ? "Refreshing…" : "Refresh all"}
                </button>
              )}
            </ActForm>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No videos yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((v, i) => (
              <li key={v.id} className="flex flex-wrap items-start gap-3 py-3">
                {v.thumb_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumb_url} alt="" className="h-16 w-28 shrink-0 rounded-md border border-line object-cover" />
                ) : (
                  <div className="h-16 w-28 shrink-0 rounded-md border border-line bg-subtle" />
                )}
                <div className="min-w-[12rem] flex-1">
                  <p className="text-sm font-medium">{v.title.en}</p>
                  {v.title.es && v.title.es !== v.title.en && <p className="text-sm text-muted">{v.title.es}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {date(v.published_at)} · {length(v.duration_s)} · {v.is_live ? "Visible" : "Hidden"}
                    {v.featured ? " · Featured" : ""}
                  </p>
                  {!v.yt_video_id && <p className="mt-1 text-xs text-warning">The source video was deleted in the YouTube add-on. This copy stays as it is.</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ActForm action={moveVideoAction} saved="">
                    {(pending) => (
                      <>
                        <Hidden id={v.id} extra={{ dir: "up" }} />
                        <button className={MINI} disabled={pending || i === 0} aria-label="Move up">
                          ↑
                        </button>
                      </>
                    )}
                  </ActForm>
                  <ActForm action={moveVideoAction} saved="">
                    {(pending) => (
                      <>
                        <Hidden id={v.id} extra={{ dir: "down" }} />
                        <button className={MINI} disabled={pending || i === rows.length - 1} aria-label="Move down">
                          ↓
                        </button>
                      </>
                    )}
                  </ActForm>
                  <ActForm action={flagVideoAction} saved="">
                    {(pending) => (
                      <>
                        <Hidden id={v.id} extra={{ flag: "is_live", value: v.is_live ? "0" : "1" }} />
                        <button className={MINI} disabled={pending}>
                          {v.is_live ? "Hide" : "Show"}
                        </button>
                      </>
                    )}
                  </ActForm>
                  <ActForm action={flagVideoAction} saved="">
                    {(pending) => (
                      <>
                        <Hidden id={v.id} extra={{ flag: "featured", value: v.featured ? "0" : "1" }} />
                        <button className={MINI} disabled={pending}>
                          {v.featured ? "Unfeature" : "Feature"}
                        </button>
                      </>
                    )}
                  </ActForm>
                  <ActForm action={refreshVideoAction} saved="">
                    {(pending) => (
                      <>
                        <Hidden id={v.id} />
                        <button className={MINI} disabled={pending || !v.yt_video_id}>
                          Refresh
                        </button>
                      </>
                    )}
                  </ActForm>
                  <ActForm action={removeVideoAction} saved="" confirm="Remove this video from the site? The video itself is not touched.">
                    {(pending) => (
                      <>
                        <Hidden id={v.id} />
                        <button className={`${MINI} ${"text-danger"}`} disabled={pending}>
                          Remove
                        </button>
                      </>
                    )}
                  </ActForm>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">The first featured video appears on the Home page; if none is featured, the newest visible one does. To show a video inside a project or article, paste its YouTube address in that page’s “Video” field.</p>
      </section>
    </div>
  );
}
