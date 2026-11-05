"use client";
// Publish step (Worker C): 1 upload in Studio + link · 2 the package (title, description with hook/chapters/
// links/music credits, tags, category, languages, privacy & schedule, translations, playlists) with Copy
// buttons · 3 Push to YouTube (when Google is connected) · 4 Studio checklist · 5 Mark as published.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  aiTranslatePackage, chaptersFromScript, linkYoutubeVideo, loadMyPlaylists, markPublished, pushToYoutube, savePublish, unlinkYoutubeVideo, unmarkPublished,
} from "@/app/youtube-actions/publish";
import { chaptersText as chText, parseChaptersText, validateChapters } from "@/lib/youtube/chapters";
import { CHECKINS, INTRO_STATUSES, TITLE_SOFT_LIMIT, YT_LIMITS, videoHref } from "@/lib/youtube/constants";
import {
  buildDescription, checkPublish, cleanHook, descriptionLinks, hookOf, hookPreview, initialFields, LANGUAGES, localParts, musicCredits, parsePlaylistId, parseTags,
  pinnedCommentDraft, playlistUrl, PRIVACY_LABEL, publishAtUtc, requiredLangs, studioChecklist, studioEditUrl, tagsLength, youtubeShortUrl, youtubeWatchUrl, YT_CATEGORIES,
} from "@/lib/youtube/publish-rules";
import type { Chapter, CheckinKind, CheckinVerdict, IntroStatus, Localization, PrivacyStatus, PublishDefaults, PublishFields, YtKind, YtMusic } from "@/lib/youtube/types";
import { AI_BTN, BOX, BTN, BTN_SM, INPUT, Msg, PRIMARY } from "@/components/youtube/script/ui";
import CopyButton from "@/components/youtube/publish/CopyButton";

export type PairLite = { id: string; label: string; is_primary: boolean; title: string | null; thumb: string | null; thumbName: string | null };
export type VideoRef = { id: string; label: string; ytId: string | null };
export type PublishLite = {
  fields: PublishFields;
  localizations: Record<string, Localization>;
  chapters: Chapter[];
  playlists: string[];
  checklist: Record<string, boolean>;
  pinned_comment: string | null;
  push_log: { at: string; what: string; ok: boolean; error?: string }[];
  pushed_at: string | null;
  post_plan: Record<string, unknown>;
};
type Props = {
  video: { id: string; kind: YtKind; code: string | null; idea_name: string; stage: string; youtube_video_id: string | null; published_at: string | null };
  publish: PublishLite | null;
  defaults: PublishDefaults;
  timezone: string;
  pairs: PairLite[];
  primary: PairLite | null;
  suggestedChapters: { chapters: Chapter[]; estimated: boolean; problems: string[] } | null;
  introStatus: IntroStatus | null;
  music: Pick<YtMusic, "track" | "source" | "license" | "position">[];
  watchNext: VideoRef | null;
  parent: VideoRef | null;
  durationS: number | null;
  uploaded: { duration_s?: number | null; privacy?: string | null; title?: string | null } | null;
  checkins: { kind: CheckinKind; due_at: string; done_at: string | null; verdict: CheckinVerdict | null }[];
  google: { configured: boolean; connected: boolean; channel: string | null; error: string | null };
  apiKey: boolean;
  aiReady: boolean;
};

const SELECT = "rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-fg";
const LABEL = "text-xs font-medium text-muted";
const fmtLocal = (iso: string, tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
};
function Counter({ n, max, soft }: { n: number; max: number; soft?: number }) {
  const cls = n > max ? "text-danger" : soft && n > soft ? "text-warning" : "text-faint";
  return <span className={`text-xs tabular-nums ${cls}`}>{n}/{max}</span>;
}
function Step({ n, title, children, right }: { n: string; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className={BOX}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          <span className="mr-1.5 rounded bg-subtle px-1.5 py-0.5 font-mono text-xs text-muted">{n}</span>
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function PublishWorkspace(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { video, timezone: tz } = p;
  const isShort = video.kind === "short";
  const saved = p.publish;

  // ----- local state ---------------------------------------------------------------------------------
  const [f, setF] = useState<PublishFields>(() => initialFields({ title: p.primary?.title ?? video.idea_name, defaults: p.defaults, kind: video.kind, current: saved?.fields }));
  const [hook, setHook] = useState(() => hookOf(saved?.fields?.description ?? ""));
  const [chText0] = useState(() => chText(saved?.chapters?.length ? saved.chapters : p.suggestedChapters?.chapters ?? []));
  const [chapters, setChapters] = useState(chText0);
  const [chEstimated, setChEstimated] = useState(!saved?.chapters?.length && !!p.suggestedChapters?.estimated);
  const [extraLinks, setExtraLinks] = useState(String(saved?.post_plan?.extra_links ?? ""));
  const [loc, setLoc] = useState<Record<string, Localization>>(saved?.localizations ?? {});
  const [playlists, setPlaylists] = useState<string[]>(saved?.playlists?.length ? saved.playlists : p.defaults.playlists ?? []);
  const [pinned, setPinned] = useState(saved?.pinned_comment ?? pinnedCommentDraft({ title: f.title ?? "", watchNextUrl: p.watchNext?.ytId ? youtubeWatchUrl(p.watchNext.ytId) : null }));
  const [checklist, setChecklist] = useState<Record<string, boolean>>(saved?.checklist ?? {});
  const sched0 = localParts(saved?.fields?.publish_at, tz);
  const [schedDate, setSchedDate] = useState(sched0.date);
  const [schedTime, setSchedTime] = useState(sched0.time || "09:00");
  const [tagText, setTagText] = useState((f.tags ?? []).join(", "));
  const [dirty, setDirty] = useState(!saved);
  const [msg, setMsg] = useState<{ error?: string | null; info?: string | null }>({});
  const [blockers, setBlockers] = useState<string[]>([]);
  const [pushLog, setPushLog] = useState(saved?.push_log ?? []);
  const [parts, setParts] = useState({ metadata: true, thumbnail: !isShort, playlists: true });
  const [linkInput, setLinkInput] = useState("");
  const [myLists, setMyLists] = useState<{ id: string; title: string }[] | null>(null);
  const [plInput, setPlInput] = useState("");
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const nowLocal = localParts(new Date().toISOString(), tz);
  const [pubDate, setPubDate] = useState(localParts(saved?.fields?.publish_at, tz).date || nowLocal.date);
  const [pubTime, setPubTime] = useState(localParts(saved?.fields?.publish_at, tz).time || nowLocal.time);

  const edit = <K extends keyof PublishFields>(k: K, v: PublishFields[K]) => {
    setF((o) => ({ ...o, [k]: v }));
    setDirty(true);
  };
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  // ----- derived ---------------------------------------------------------------------------------------
  const parsedChapters = useMemo(() => parseChaptersText(chapters), [chapters]);
  const chapterCheck = useMemo(() => (parsedChapters.length ? validateChapters(parsedChapters, p.durationS) : null), [parsedChapters, p.durationS]);
  const credits = useMemo(() => musicCredits(p.music), [p.music]);
  const links = useMemo(() => descriptionLinks({ watchNext: p.watchNext ? { title: p.watchNext.label.replace(/^[^·]*·\s*/, ""), ytId: p.watchNext.ytId } : null, playlists, extra: extraLinks }), [p.watchNext, playlists, extraLinks]);
  const built = useMemo(
    () => buildDescription({ hook: cleanHook(hook), chapters: isShort ? [] : parsedChapters, links, credits, template: p.defaults.description_template }),
    [hook, parsedChapters, links, credits, isShort, p.defaults.description_template],
  );
  const publishAt = schedDate ? publishAtUtc(schedDate, schedTime, tz) : null;
  const fieldsToSave: PublishFields = { ...f, tags: parseTags(tagText), publish_at: publishAt };
  const langs = requiredLangs(f.default_language);
  const check = checkPublish({
    kind: video.kind,
    fields: fieldsToSave,
    localizations: loc,
    requiredLangs: langs,
    chapters: isShort ? [] : parsedChapters,
    durationS: p.durationS,
    introStatus: p.introStatus,
    thumbnail: { present: !!p.primary?.thumb },
    now: new Date(),
  });
  const ytId = video.youtube_video_id;
  const published = video.stage === "published";
  const tagsLen = tagsLength(parseTags(tagText));
  const descNow = f.description ?? "";
  const descStale = !!descNow && descNow.trim() !== built.trim();

  // ----- actions --------------------------------------------------------------------------------------
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setMsg({});
      await fn();
    });
  const doSave = async (): Promise<boolean> => {
    const r = await savePublish(video.id, {
      fields: fieldsToSave,
      localizations: loc,
      chapters: isShort ? [] : parsedChapters,
      playlists,
      pinned_comment: pinned,
      post_plan: { extra_links: extraLinks },
    });
    if (r.error) {
      setMsg({ error: r.error });
      return false;
    }
    setDirty(false);
    return true;
  };
  const save = () =>
    run(async () => {
      if (await doSave()) {
        setMsg({ info: "Saved." });
        router.refresh();
      }
    });
  const toggleCheck = (id: string, on: boolean) =>
    run(async () => {
      const next = { ...checklist, [id]: on };
      setChecklist(next);
      const r = await savePublish(video.id, { checklist: { [id]: on } });
      if (r.error) setMsg({ error: r.error });
    });
  const link = () =>
    run(async () => {
      const r = await linkYoutubeVideo(video.id, linkInput);
      if (r.error) return setMsg({ error: r.error });
      setLinkInput("");
      const i = r.info;
      setMsg({ info: i?.checked ? `Linked: “${i.title ?? r.ytId}” (${i.privacy ?? "?"}${i.durationS ? `, ${Math.round(i.durationS / 60)} min` : ""}).` : `Linked ${r.ytId}. (Not checked with YouTube — no API key or Google connection.)` });
      router.refresh();
    });
  const unlink = () =>
    run(async () => {
      const r = await unlinkYoutubeVideo(video.id);
      if (r.error) return setMsg({ error: r.error });
      router.refresh();
    });
  const push = () =>
    run(async () => {
      setBlockers([]);
      if (dirty && !(await doSave())) return;
      const r = await pushToYoutube(video.id, parts);
      if (r.blockers?.length) setBlockers(r.blockers);
      if (r.log) setPushLog((l) => [...l, ...r.log!].slice(-40));
      setMsg(r.ok ? { info: "Sent to YouTube ✓ — check it in Studio." } : { error: r.error ?? "Some parts failed." });
      router.refresh();
    });
  const translate = (lang: string) =>
    run(async () => {
      setAiBusy(lang);
      const from = (f.default_language || "en").slice(0, 2);
      const r = await aiTranslatePackage(video.id, lang, { title: f.title ?? "", description: f.description || built, from });
      setAiBusy(null);
      if (r.error || !r.title) return setMsg({ error: r.error ?? "No answer." });
      setLoc((o) => ({ ...o, [lang]: { title: r.title!, description: r.description ?? "" } }));
      setDirty(true);
      setMsg({ info: `✨ ${lang.toUpperCase()} draft ready — read it, edit, then Save.${r.usage ? ` ${r.usage}` : ""}` });
    });
  const reloadChapters = () =>
    run(async () => {
      const r = await chaptersFromScript(video.id);
      if (r.error || !r.chapters) return setMsg({ error: r.error ?? "No chapters." });
      setChapters(chText(r.chapters));
      setChEstimated(!!r.estimated);
      setDirty(true);
    });
  const fetchLists = () =>
    run(async () => {
      const r = await loadMyPlaylists();
      if (r.error) return setMsg({ error: r.error });
      setMyLists((r.playlists ?? []).map((x) => ({ id: x.id, title: x.title })));
    });
  const addPlaylist = (raw: string) => {
    const id = parsePlaylistId(raw);
    if (!id) return setMsg({ error: "That is not a playlist link or id (starts with PL…)." });
    if (!playlists.includes(id)) touch(setPlaylists)([...playlists, id]);
    setPlInput("");
  };
  const markPub = () =>
    run(async () => {
      if (dirty && !(await doSave())) return;
      const iso = publishAtUtc(pubDate, pubTime, tz);
      const r = await markPublished(video.id, iso);
      if (r.error) return setMsg({ error: r.error });
      setMsg({ info: `Marked as published. ${r.checkins ?? 0} check-ins created (48 h, 7 d, 30 d, 90 d) — see Follow-up.` });
      router.refresh();
    });
  const unmark = () =>
    run(async () => {
      if (!confirm("Undo “published”? Check-ins not done yet are removed.")) return;
      const r = await unmarkPublished(video.id);
      if (r.error) return setMsg({ error: r.error });
      router.refresh();
    });

  const introLabel = INTRO_STATUSES.find((s) => s.id === (p.introStatus ?? "not_written"))?.label ?? "Not written";
  const watchUrl = ytId ? (isShort ? youtubeShortUrl(ytId) : youtubeWatchUrl(ytId)) : null;
  const testPairs = p.pairs.filter((x) => x.title || x.thumb).slice(0, 3);

  return (
    <div className="space-y-4">
      {/* ----- status ----- */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/95 px-3 py-2 text-sm shadow-card backdrop-blur">
        <span className={check.errors.length ? "text-danger" : "text-success"}>{check.errors.length ? `${check.errors.length} to fix` : "Ready ✓"}</span>
        {check.warnings.length > 0 && <span className="text-warning">· {check.warnings.length} warnings</span>}
        {!isShort && <span className={`text-xs ${p.introStatus === "filmed" ? "text-success" : "text-danger"}`}>· Intro: {introLabel}</span>}
        <span className="text-xs text-muted">· Google: {p.google.connected ? `connected${p.google.channel ? ` (${p.google.channel})` : ""}` : "not connected"}</span>
        <span className="flex-1" />
        {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
        <button type="button" className={PRIMARY} disabled={pending} onClick={save}>
          {pending ? "Working…" : "Save"}
        </button>
      </div>
      <Msg error={msg.error} info={msg.info} />
      {(check.errors.length > 0 || check.warnings.length > 0 || blockers.length > 0) && (
        <div className="space-y-1 rounded-lg border border-line bg-subtle p-3 text-sm">
          {[...new Set([...blockers, ...check.errors])].map((e) => (
            <p key={e} className="text-danger">✗ {e}</p>
          ))}
          {check.warnings.map((w) => (
            <p key={w} className="text-warning">! {w}</p>
          ))}
        </div>
      )}

      {/* ----- 1 upload + link ----- */}
      <Step n="1" title="Upload in YouTube Studio, then link it here">
        <p className="text-sm text-muted">
          The app does not upload files. Upload the {isShort ? "Short" : "video"} in{" "}
          <a className="text-accent underline" href="https://studio.youtube.com" target="_blank" rel="noreferrer">
            YouTube Studio
          </a>{" "}
          (leave it Private or Unlisted), copy its link and paste it below.
        </p>
        {ytId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-subtle px-2 py-0.5 font-mono text-xs">{ytId}</span>
            <a className="text-accent underline" href={watchUrl!} target="_blank" rel="noreferrer">
              Open on YouTube
            </a>
            <a className="text-accent underline" href={studioEditUrl(ytId)} target="_blank" rel="noreferrer">
              Edit in Studio
            </a>
            <CopyButton text={watchUrl!} label="Copy link" />
            {p.uploaded?.privacy && <span className="text-xs text-muted">YouTube says: {p.uploaded.privacy}</span>}
            {!published && (
              <button type="button" className={BTN_SM} onClick={unlink} disabled={pending}>
                Unlink
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input className={`${INPUT} max-w-md`} placeholder="https://youtu.be/… or the 11-character id" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} />
            <button type="button" className={BTN} disabled={pending || !linkInput.trim()} onClick={link}>
              Link video
            </button>
          </div>
        )}
      </Step>

      {/* ----- 2 package ----- */}
      <Step n="2" title="Title & thumbnail">
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className={LABEL} htmlFor="pub-title">Title {p.primary ? `(pair ${p.primary.label})` : ""}</label>
              <span className="flex items-center gap-2">
                <Counter n={(f.title ?? "").length} max={YT_LIMITS.titleMax} soft={TITLE_SOFT_LIMIT} />
                <CopyButton text={f.title ?? ""} />
              </span>
            </div>
            <input id="pub-title" className={INPUT} value={f.title ?? ""} maxLength={150} onChange={(e) => edit("title", e.target.value)} />
            {p.primary?.title && f.title !== p.primary.title && (
              <button type="button" className={BTN_SM} onClick={() => edit("title", p.primary!.title!)}>
                Use the pair {p.primary.label} title again
              </button>
            )}
            {!p.primary && <p className="text-xs text-warning">No title + thumbnail pair yet — make them in the Package tab.</p>}
          </div>
          <div className="space-y-1">
            <span className={LABEL}>Thumbnail {p.primary?.thumbName ? `· ${p.primary.thumbName}` : ""}</span>
            {p.primary?.thumb ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.primary.thumb} alt="Primary thumbnail" className="aspect-video w-full rounded-md border border-line object-cover" />
                <a className="text-xs text-accent underline" href={p.primary.thumb} target="_blank" rel="noreferrer" download>
                  Open / download (to upload by hand)
                </a>
              </>
            ) : (
              <p className="text-xs text-muted">{isShort ? "Shorts use a frame picked in the YouTube app." : "No image on the primary pair yet."}</p>
            )}
          </div>
        </div>
      </Step>

      <Step n="3" title="Description" right={<span className="flex items-center gap-2"><Counter n={descNow.length} max={YT_LIMITS.descriptionMax} /><CopyButton text={descNow} /></span>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1">
              <label className={LABEL} htmlFor="pub-hook">Hook — the 2 lines people see before “…more”</label>
              <textarea id="pub-hook" className={INPUT} rows={2} value={hook} onChange={(e) => touch(setHook)(e.target.value)} placeholder="Line 1: the promise of the title.&#10;Line 2: why watch till the end." />
            </div>
            {!isShort && (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className={LABEL} htmlFor="pub-ch">Chapters (one per line: 0:00 Title)</label>
                  <span className="flex gap-1">
                    <button type="button" className={BTN_SM} onClick={reloadChapters} disabled={pending}>
                      ↻ From the sections
                    </button>
                    <CopyButton text={chapters} />
                  </span>
                </div>
                <textarea id="pub-ch" className={`${INPUT} font-mono`} rows={Math.min(10, Math.max(3, parsedChapters.length + 1))} value={chapters} onChange={(e) => { touch(setChapters)(e.target.value); setChEstimated(false); }} />
                {chEstimated && <p className="text-xs text-warning">Some times are estimated from the words (no start time set in Edit) — check them against the final cut.</p>}
                {chapterCheck && !chapterCheck.ok && chapterCheck.problems.map((x) => <p key={x} className="text-xs text-warning">! {x}</p>)}
              </div>
            )}
            <div className="space-y-1">
              <label className={LABEL} htmlFor="pub-links">Extra links (one per line: socials, website…)</label>
              <textarea id="pub-links" className={INPUT} rows={2} value={extraLinks} onChange={(e) => touch(setExtraLinks)(e.target.value)} />
              <p className="text-xs text-muted">
                {p.watchNext ? (p.watchNext.ytId ? `Watch next: ${p.watchNext.label} ✓` : `Watch next: ${p.watchNext.label} — not on YouTube yet, so no link.`) : "No “watch next” video linked (Research → video links)."}
                {credits.length ? ` · Music credits: ${credits.length}` : " · No music credits (Music tab)."}
              </p>
            </div>
            <button type="button" className={BTN} onClick={() => edit("description", built)}>
              {descNow ? "Rebuild description from these parts" : "Build description"}
            </button>
            {descStale && <p className="text-xs text-muted">The description below was edited by hand or the parts changed — rebuild to bring them in.</p>}
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="pub-desc">Final description (edit freely)</label>
            <textarea id="pub-desc" className={INPUT} rows={16} value={descNow} onChange={(e) => edit("description", e.target.value)} placeholder={built} />
            {descNow && (
              <div className="rounded-md bg-subtle p-2 text-xs">
                <p className="mb-1 text-faint">Before “…more”:</p>
                <p className="whitespace-pre-line">{hookPreview(descNow)}</p>
              </div>
            )}
          </div>
        </div>
      </Step>

      <Step n="4" title="Tags, category, languages, privacy & schedule">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className={LABEL} htmlFor="pub-tags">Tags (comma separated)</label>
            <span className="flex items-center gap-2">
              <Counter n={tagsLen} max={YT_LIMITS.tagsTotalMax} />
              <CopyButton text={parseTags(tagText).join(", ")} />
            </span>
          </div>
          <input id="pub-tags" className={INPUT} value={tagText} onChange={(e) => touch(setTagText)(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className={LABEL}>Category</span>
            <span className="flex gap-1">
              <select className={`${SELECT} flex-1`} value={f.category_id ?? ""} onChange={(e) => edit("category_id", e.target.value)}>
                {YT_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <CopyButton text={YT_CATEGORIES.find((c) => c.id === f.category_id)?.label ?? ""} />
            </span>
          </label>
          <label className="space-y-1">
            <span className={LABEL}>Title & description language</span>
            <select className={`${SELECT} w-full`} value={f.default_language ?? "en"} onChange={(e) => edit("default_language", e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className={LABEL}>Spoken language (audio)</span>
            <select className={`${SELECT} w-full`} value={f.default_audio_language ?? "en"} onChange={(e) => edit("default_audio_language", e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className={LABEL}>Visibility</span>
            <select className={`${SELECT} w-full`} value={f.privacy ?? "private"} onChange={(e) => edit("privacy", e.target.value as PrivacyStatus)} disabled={!!schedDate}>
              {(["private", "unlisted", "public"] as PrivacyStatus[]).map((x) => <option key={x} value={x}>{PRIVACY_LABEL[x]}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className={LABEL}>Schedule (your time: {tz})</span>
            <span className="flex gap-1">
              <input type="date" className={SELECT} value={schedDate} onChange={(e) => touch(setSchedDate)(e.target.value)} />
              <input type="time" className={SELECT} value={schedTime} onChange={(e) => touch(setSchedTime)(e.target.value)} disabled={!schedDate} />
            </span>
          </label>
          {schedDate && (
            <>
              <span className="pb-1 text-xs text-muted">{publishAt ? `Goes public ${fmtLocal(publishAt, tz)} (sent as Private until then).` : "Pick a valid time."}</span>
              <button type="button" className={BTN_SM} onClick={() => touch(setSchedDate)("")}>
                No schedule
              </button>
              {publishAt && <CopyButton text={`${schedDate} ${schedTime}`} label="Copy date" />}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {(
            [
              ["made_for_kids", "Made for kids"],
              ["synthetic_media", "Altered or synthetic content (realistic AI)"],
              ["embeddable", "Allow embedding"],
              ["public_stats", "Show likes count"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!f[k]} onChange={(e) => edit(k, e.target.checked)} />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-1.5">
            <span className="text-muted">License</span>
            <select className={SELECT} value={f.license ?? "youtube"} onChange={(e) => edit("license", e.target.value as PublishFields["license"])}>
              <option value="youtube">Standard YouTube</option>
              <option value="creativeCommon">Creative Commons</option>
            </select>
          </label>
        </div>
      </Step>

      <Step n="5" title="Translations (title & description)">
        {langs.map((lang) => {
          const l = loc[lang] ?? { title: "", description: "" };
          const setL = (patch: Partial<Localization>) => touch(setLoc)({ ...loc, [lang]: { ...l, ...patch } });
          const name = LANGUAGES.find((x) => x.id === lang)?.label ?? lang;
          return (
            <div key={lang} className="space-y-2 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{name}</span>
                {p.aiReady && (
                  <button type="button" className={AI_BTN} disabled={pending || aiBusy === lang} onClick={() => translate(lang)}>
                    {aiBusy === lang ? "✨ Translating…" : `✨ Draft ${name}`}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input className={INPUT} placeholder={`Title in ${name}`} value={l.title} onChange={(e) => setL({ title: e.target.value })} />
                <Counter n={l.title.length} max={YT_LIMITS.titleMax} />
                <CopyButton text={l.title} />
              </div>
              <div className="flex items-start gap-2">
                <textarea className={INPUT} rows={5} placeholder={`Description in ${name}`} value={l.description} onChange={(e) => setL({ description: e.target.value })} />
                <CopyButton text={l.description} />
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted">In Studio by hand: Subtitles → Add language → Title & description.</p>
      </Step>

      <Step n="6" title="Playlists">
        <div className="flex flex-wrap gap-2">
          {playlists.map((id) => (
            <span key={id} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
              <a className="text-accent" href={playlistUrl(id)} target="_blank" rel="noreferrer">
                {myLists?.find((m) => m.id === id)?.title ?? id}
              </a>
              <button type="button" aria-label="Remove playlist" className="text-faint hover:text-danger" onClick={() => touch(setPlaylists)(playlists.filter((x) => x !== id))}>
                ✕
              </button>
            </span>
          ))}
          {!playlists.length && <span className="text-xs text-muted">No playlists.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input className={`${INPUT} max-w-sm`} placeholder="Playlist link or id (PL…)" value={plInput} onChange={(e) => setPlInput(e.target.value)} />
          <button type="button" className={BTN} disabled={!plInput.trim()} onClick={() => addPlaylist(plInput)}>
            Add
          </button>
          {p.google.connected && (
            <button type="button" className={BTN} disabled={pending} onClick={fetchLists}>
              Load my playlists
            </button>
          )}
        </div>
        {myLists && (
          <div className="flex flex-wrap gap-1">
            {myLists.length === 0 && <span className="text-xs text-muted">No playlists on the channel.</span>}
            {myLists.filter((m) => !playlists.includes(m.id)).map((m) => (
              <button key={m.id} type="button" className={BTN_SM} onClick={() => addPlaylist(m.id)}>
                + {m.title}
              </button>
            ))}
          </div>
        )}
      </Step>

      {/* ----- push ----- */}
      <Step n="7" title="Push to YouTube">
        {!p.google.configured ? (
          <p className="text-sm text-muted">Google sign-in is not set up yet (see ACTIVAR-GOOGLE-OAUTH.md). Use the Copy buttons and paste each field in Studio.</p>
        ) : !p.google.connected ? (
          <p className="text-sm text-muted">
            Google is not connected{p.google.error ? ` (${p.google.error})` : ""}. <Link className="text-accent underline" href="/youtube/settings">Connect it in Settings</Link>, or use the Copy buttons.
          </p>
        ) : !ytId ? (
          <p className="text-sm text-muted">Link the uploaded video first (step 1).</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={parts.metadata} onChange={(e) => setParts({ ...parts, metadata: e.target.checked })} /> Title, description, tags, category, languages, translations, visibility & schedule
              </label>
              {!isShort && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={parts.thumbnail} onChange={(e) => setParts({ ...parts, thumbnail: e.target.checked })} /> Thumbnail <span className="text-faint">(sent as JPG 1280×720; custom thumbnails need a verified phone on the channel — youtube.com/verify)</span>
                </label>
              )}
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={parts.playlists} onChange={(e) => setParts({ ...parts, playlists: e.target.checked })} disabled={!playlists.length} /> Playlists ({playlists.length})
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={PRIMARY} disabled={pending || (parts.metadata && check.errors.length > 0) || !(parts.metadata || parts.thumbnail || parts.playlists)} onClick={push}>
                {pending ? "Sending…" : "Push to YouTube"}
              </button>
              {parts.metadata && check.errors.length > 0 && <span className="text-xs text-danger">Fix the red items first.</span>}
              <span className="text-xs text-muted">Uses ~{(parts.metadata ? 51 : 0) + (parts.thumbnail && !isShort ? 50 : 0) + (parts.playlists ? playlists.length * 51 : 0)} of 10,000 daily API units.</span>
            </div>
          </>
        )}
        {pushLog.length > 0 && (
          <ul className="space-y-0.5 text-xs">
            {pushLog.slice(-8).reverse().map((l, i) => (
              <li key={`${l.at}-${i}`} className={l.ok ? "text-success" : "text-danger"}>
                {l.ok ? "✓" : "✗"} {fmtLocal(l.at, tz)} · {l.what}
                {l.error ? ` — ${l.error}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Step>

      {/* ----- Studio checklist ----- */}
      <Step n="8" title="In YouTube Studio (by hand)">
        <ul className="space-y-3">
          {studioChecklist(video.kind).map((item) => (
            <li key={item.id} className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!checklist[item.id]} onChange={(e) => toggleCheck(item.id, e.target.checked)} />
                <span className={checklist[item.id] ? "text-muted line-through" : ""}>{item.label}</span>
              </label>
              <div className="ml-6 text-xs text-muted">
                {item.id === "end_screen" && (
                  <p>
                    Suggested: {p.watchNext ? `video “${p.watchNext.label}”` : "your best recent video"}
                    {playlists[0] ? ` + playlist ${myLists?.find((m) => m.id === playlists[0])?.title ?? playlists[0]}` : ""} + Subscribe.
                    {p.watchNext?.ytId && <> <CopyButton text={youtubeWatchUrl(p.watchNext.ytId)} label="Copy video link" /></>}
                  </p>
                )}
                {item.id === "cards" && <p>Add a card where you mention {p.watchNext ? `“${p.watchNext.label}”` : "another video"}, and one at the end of the climax.</p>}
                {item.id === "pinned_comment" && (
                  <div className="space-y-1">
                    <div className="flex items-start gap-2">
                      <textarea className={INPUT} rows={3} value={pinned} onChange={(e) => touch(setPinned)(e.target.value)} />
                      <CopyButton text={pinned} />
                    </div>
                    <p>Post it as a comment on your video, then ⋮ → Pin.</p>
                  </div>
                )}
                {item.id === "test_compare" && (
                  <div className="space-y-1">
                    <p>Studio → the video → “Test & compare”: add these {testPairs.length} pairs. While the test runs, do NOT change the title or thumbnail (it stops the test) — the app won’t rotate anything either. After publishing, log the test (and later Studio’s verdict) in the Follow-up tab.</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {testPairs.map((t) => (
                        <div key={t.id} className="space-y-1 rounded-md border border-line p-2">
                          <span className="font-mono text-[10px] text-faint">Pair {t.label}{t.is_primary ? " · primary" : ""}</span>
                          {t.thumb && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <a href={t.thumb} target="_blank" rel="noreferrer"><img src={t.thumb} alt={`Thumbnail ${t.label}`} className="aspect-video w-full rounded object-cover" /></a>
                          )}
                          <p className="text-fg">{t.title ?? "—"}</p>
                          {t.title && <CopyButton text={t.title} />}
                        </div>
                      ))}
                    </div>
                    {testPairs.length < 2 && <p className="text-warning">Test & compare needs 2–3 pairs: make more in Package.</p>}
                  </div>
                )}
                {item.id === "related_video" && (
                  <p>
                    In the Short’s details → “Related video” → pick {p.parent ? `“${p.parent.label}”` : "the long video"}.
                    {p.parent?.ytId && <> <CopyButton text={youtubeWatchUrl(p.parent.ytId)} label="Copy its link" /></>}
                    {p.parent && !p.parent.ytId && " (It is not on YouTube yet — publish the long video first.)"}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {isShort && <p className="text-xs text-muted">Shorts don’t use Test & compare: the follow-up compares it with your usual Shorts views, not with long videos.</p>}
      </Step>

      {/* ----- published ----- */}
      <Step n="9" title={published ? "Published" : "Mark as published"}>
        {published ? (
          <div className="space-y-2 text-sm">
            <p>
              Published {video.published_at ? fmtLocal(video.published_at, tz) : ""}.{" "}
              <Link className="text-accent underline" href={videoHref(video.id, "follow-up")}>Open Follow-up</Link>
            </p>
            <ul className="grid gap-1 sm:grid-cols-4">
              {CHECKINS.map((c) => {
                const ci = p.checkins.find((x) => x.kind === c.id);
                return (
                  <li key={c.id} className="rounded-md border border-line px-2 py-1 text-xs">
                    <span className="font-medium">{c.label}</span>
                    <br />
                    <span className="text-muted">{ci ? (ci.done_at ? `done · ${ci.verdict ?? ""}` : `due ${fmtLocal(ci.due_at, tz)}`) : "—"}</span>
                  </li>
                );
              })}
            </ul>
            <button type="button" className={BTN_SM} disabled={pending} onClick={unmark}>
              Undo “published”
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted">When it is live (or scheduled), mark it here: the app creates the check-ins at 48 hours, 7, 30 and 90 days.</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className={LABEL}>Goes / went live ({tz})</span>
                <span className="flex gap-1">
                  <input type="date" className={SELECT} value={pubDate} onChange={(e) => setPubDate(e.target.value)} />
                  <input type="time" className={SELECT} value={pubTime} onChange={(e) => setPubTime(e.target.value)} />
                </span>
              </label>
              <button type="button" className={PRIMARY} disabled={pending || !ytId} onClick={markPub}>
                Mark as published
              </button>
              {!ytId && <span className="text-xs text-muted">Link the video first.</span>}
            </div>
          </div>
        )}
      </Step>
    </div>
  );
}
