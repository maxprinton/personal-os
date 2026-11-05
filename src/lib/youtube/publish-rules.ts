// YouTube add-on (Worker C) — pure logic of the Publish step: description template, chapters (fallback when
// Worker B's chapters.ts is not there), tags, validations (YouTube limits + the intro gate), the exact
// videos.update body (snippet / status / localizations), publishAt in the user's timezone and the caption
// text made from the final script.
import { CHAPTER_RULES, INTRO_STATUSES, PUBLISH_INTRO_REQUIRED, TITLE_CUT_WARNING, TITLE_SOFT_LIMIT, YT_LIMITS } from "@/lib/youtube/constants";
import type { Chapter, IntroStatus, Localization, PrivacyStatus, PublishDefaults, PublishFields, YtKind } from "@/lib/youtube/types";
import { zonedToUtc, utcToLocal, minutesToTime } from "@/lib/time";

// ----- Time stamps and chapters ----------------------------------------------------------------------
/** 0 → "0:00", 75 → "1:15", 3723 → "1:02:03" (YouTube's chapter format). */
export function stamp(s: number) {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "1:15" / "01:02:03" / "75" → seconds (null when not a time). */
export function parseStamp(text: string): number | null {
  const s = text.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const [, h, mi, se] = m;
  if (Number(se) > 59 || (h !== undefined && Number(mi) > 59)) return null;
  return Number(h ?? 0) * 3600 + Number(mi) * 60 + Number(se);
}

export type SectionForChapters = { title: string; kind: string; start_s: number | null; num?: number | null; position?: number };

/**
 * FALLBACK chapters from the outline sections and their start times (Worker B owns the real
 * src/lib/youtube/chapters.ts; this keeps Publish working without it). The first chapter is forced to 0:00.
 */
export function chaptersFromSections(sections: SectionForChapters[]): Chapter[] {
  const timed = sections
    .filter((s) => s.start_s !== null && s.start_s !== undefined && s.start_s >= 0)
    .sort((a, b) => a.start_s! - b.start_s! || (a.position ?? 0) - (b.position ?? 0));
  const out: Chapter[] = [];
  for (const s of timed) {
    const title = (s.kind === "intro" && !s.title.trim() ? "Intro" : s.title.trim()) || "Part";
    if (out.length && out[out.length - 1].start_s === s.start_s) continue;
    out.push({ start_s: Math.floor(s.start_s!), title });
  }
  if (out.length) out[0] = { ...out[0], start_s: 0 };
  return out;
}

/** Problems with the chapters (empty = valid for YouTube). No chapters at all is allowed (just no chapters). */
export function chapterProblems(ch: Chapter[], durationS?: number | null): string[] {
  if (!ch.length) return [];
  const p: string[] = [];
  const sorted = [...ch].sort((a, b) => a.start_s - b.start_s);
  if (sorted[0].start_s !== CHAPTER_RULES.firstAt) p.push("The first chapter must start at 0:00.");
  if (sorted.length < CHAPTER_RULES.minChapters) p.push(`YouTube needs at least ${CHAPTER_RULES.minChapters} chapters.`);
  for (let i = 0; i < sorted.length; i++) {
    const end = i + 1 < sorted.length ? sorted[i + 1].start_s : durationS ?? null;
    if (end !== null && end - sorted[i].start_s < CHAPTER_RULES.minSeconds) p.push(`“${sorted[i].title}” is shorter than ${CHAPTER_RULES.minSeconds} s.`);
    if (!sorted[i].title.trim()) p.push(`The chapter at ${stamp(sorted[i].start_s)} has no title.`);
  }
  if (sorted.some((c, i) => ch[i] !== c)) p.push("Chapters must be in time order.");
  return p;
}

export function chaptersText(ch: Chapter[]) {
  return [...ch].sort((a, b) => a.start_s - b.start_s).map((c) => `${stamp(c.start_s)} ${c.title.trim()}`).join("\n");
}

/** Reads "0:00 Intro" lines back (for pasting chapters). */
export function parseChaptersText(text: string): Chapter[] {
  return text
    .split(/\r?\n/)
    .map((l) => /^\s*((?:\d+:)?\d{1,2}:\d{2})\s*[-–—:]?\s*(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ start_s: parseStamp(m[1]) ?? 0, title: m[2].trim() }));
}

// ----- Description -----------------------------------------------------------------------------------
export const DEFAULT_DESCRIPTION_TEMPLATE = `{hook}

{chapters}

{links}

{credits}`;

export type DescriptionParts = {
  hook: string;
  chapters: Chapter[];
  /** "▶ Watch next" etc. — ready lines */
  links: string[];
  credits: string[];
  template?: string | null;
};

/** Fills the template ({hook} {chapters} {links} {credits}); empty blocks don't leave gaps. */
export function buildDescription(p: DescriptionParts): string {
  const blocks: Record<string, string> = {
    hook: p.hook.trim(),
    chapters: p.chapters.length ? `Chapters\n${chaptersText(p.chapters)}` : "",
    links: p.links.map((l) => l.trim()).filter(Boolean).join("\n"),
    credits: p.credits.length ? `Music\n${p.credits.map((c) => `• ${c.trim()}`).join("\n")}` : "",
  };
  const tpl = p.template?.trim() ? p.template : DEFAULT_DESCRIPTION_TEMPLATE;
  return tpl
    .replace(/\{(hook|chapters|links|credits)\}/g, (_, k: string) => blocks[k] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The two lines seen before "...more". */
export function hookPreview(description: string) {
  return description.split(/\r?\n/).filter((l) => l.trim()).slice(0, YT_LIMITS.descriptionHookLines).join("\n");
}

// ----- Tags ------------------------------------------------------------------------------------------
/** "a, b,  c" → ["a","b","c"] (no repeats, no empty, no < > which YouTube rejects). */
export function parseTags(text: string | string[]): string[] {
  const list = Array.isArray(text) ? text : text.split(/[,\n]/);
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}
/** YouTube's count: tags + commas between them; a tag with a space counts its quotes (+2). */
export function tagsLength(tags: string[]) {
  if (!tags.length) return 0;
  return tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + (tags.length - 1);
}

// ----- publishAt in the user's timezone --------------------------------------------------------------
/** Local date "2026-11-20" + time "09:00" in tz → ISO UTC (what the API wants in status.publishAt). */
export function publishAtUtc(date: string, time: string, tz: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return zonedToUtc(date, time, tz).toISOString().replace(/\.\d{3}Z$/, "Z");
}
/** ISO → { date, time } in tz (to fill the form). */
export function localParts(iso: string | null | undefined, tz: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return { date: "", time: "" };
  const l = utcToLocal(iso, tz);
  return { date: l.date, time: minutesToTime(l.minutes) };
}

// ----- Validations -----------------------------------------------------------------------------------
export type PublishCheckInput = {
  kind: YtKind;
  fields: PublishFields;
  localizations: Record<string, Localization>;
  /** languages that must have a translation (e.g. ["en","es"] minus the default language) */
  requiredLangs: string[];
  chapters: Chapter[];
  durationS?: number | null;
  introStatus: IntroStatus | null;
  /** the intro was marked Final before it was Filmed (Filmed implies Final) */
  thumbnail: { bytes?: number | null; width?: number | null; height?: number | null; present: boolean };
  now: Date;
};
export type PublishCheck = { errors: string[]; warnings: string[] };

/** Errors block "Push to YouTube"; warnings don't (only the intro gate and hard YouTube limits are errors). */
export function checkPublish(i: PublishCheckInput): PublishCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const f = i.fields;
  // Hard gate c: intro Final + Filmed (long videos; Shorts have a hook instead).
  if (i.kind === "long" && i.introStatus !== PUBLISH_INTRO_REQUIRED) {
    const label = INTRO_STATUSES.find((s) => s.id === (i.introStatus ?? "not_written"))?.label ?? "Not written";
    errors.push(`The intro must be Final and Filmed before publishing (now: ${label}). Mark it in Script.`);
  }
  const title = (f.title ?? "").trim();
  if (!title) errors.push("Title is empty.");
  if (title.length > YT_LIMITS.titleMax) errors.push(`Title has ${title.length} characters — YouTube allows ${YT_LIMITS.titleMax}.`);
  else if (title.length > TITLE_CUT_WARNING) warnings.push(`Title has ${title.length} characters: it gets cut after ~${TITLE_SOFT_LIMIT}–${TITLE_CUT_WARNING} on most screens.`);
  else if (title.length > TITLE_SOFT_LIMIT) warnings.push(`Title has ${title.length} characters: the end may be cut on phones (~${TITLE_SOFT_LIMIT}).`);
  if (/[<>]/.test(title)) errors.push("YouTube does not allow < or > in the title.");
  const desc = f.description ?? "";
  if (desc.length > YT_LIMITS.descriptionMax) errors.push(`Description has ${desc.length} characters — YouTube allows ${YT_LIMITS.descriptionMax}.`);
  if (/[<>]/.test(desc)) errors.push("YouTube does not allow < or > in the description.");
  if (!desc.trim()) warnings.push("Description is empty.");
  const tl = tagsLength(f.tags ?? []);
  if (tl > YT_LIMITS.tagsTotalMax) errors.push(`Tags use ${tl} characters — YouTube allows ${YT_LIMITS.tagsTotalMax} in total.`);
  if (!f.category_id) warnings.push("No category chosen (YouTube needs one: the current one is kept when pushing).");
  if (i.kind === "long") {
    for (const p of chapterProblems(i.chapters, i.durationS)) warnings.push(`Chapters: ${p}`);
    if (i.chapters.length && desc && !desc.includes(chaptersText(i.chapters).split("\n")[0])) warnings.push("The chapters are not in the description — rebuild it from the template.");
  }
  if (i.kind === "short" && i.durationS && i.durationS > YT_LIMITS.shortMaxSeconds) errors.push(`A Short can be at most ${YT_LIMITS.shortMaxSeconds} s.`);
  for (const lang of i.requiredLangs) {
    const l = i.localizations[lang];
    if (!l || !l.title.trim() || !l.description.trim()) warnings.push(`The ${lang.toUpperCase()} translation is not complete.`);
    else {
      if (l.title.length > YT_LIMITS.titleMax) errors.push(`${lang.toUpperCase()} title is longer than ${YT_LIMITS.titleMax}.`);
      if (l.description.length > YT_LIMITS.descriptionMax) errors.push(`${lang.toUpperCase()} description is longer than ${YT_LIMITS.descriptionMax}.`);
    }
  }
  if (f.publish_at) {
    const t = Date.parse(f.publish_at);
    if (!Number.isFinite(t)) errors.push("The scheduled date is not valid.");
    else if (t < i.now.getTime() + 5 * 60_000) errors.push("The scheduled time must be in the future.");
    if ((f.privacy ?? "private") !== "private") warnings.push("Scheduling needs the video to be Private until then — it will be sent as Private.");
  }
  if (!i.thumbnail.present) warnings.push(i.kind === "short" ? "No thumbnail (Shorts pick a frame in the app)." : "No thumbnail on the primary pair.");
  else {
    if (i.thumbnail.bytes && i.thumbnail.bytes > YT_LIMITS.thumbnailMaxBytes) errors.push("The thumbnail is bigger than 2 MB.");
    if (i.thumbnail.width && i.thumbnail.height) {
      if (Math.abs(i.thumbnail.width / i.thumbnail.height - 16 / 9) > 0.02) warnings.push(`Thumbnail is ${i.thumbnail.width}×${i.thumbnail.height}: YouTube wants 16:9 (1280×720).`);
      else if (i.thumbnail.width < YT_LIMITS.thumbnailWidth) warnings.push(`Thumbnail is ${i.thumbnail.width}×${i.thumbnail.height}: 1280×720 looks best.`);
    }
  }
  if (f.made_for_kids === undefined) warnings.push("Say whether it is made for kids (default: No).");
  return { errors, warnings };
}

// ----- videos.update body ----------------------------------------------------------------------------
type ApiVideo = {
  id?: string;
  snippet?: Record<string, unknown> & { title?: string; categoryId?: string; description?: string; tags?: string[]; defaultLanguage?: string; defaultAudioLanguage?: string };
  status?: Record<string, unknown>;
  localizations?: Record<string, { title: string; description: string }>;
};

/**
 * The body for videos.update?part=snippet,status,localizations. videos.update REPLACES each part, so it starts
 * from the current video (videos.list) and only changes what we manage. Rules: publishAt needs
 * privacyStatus "private"; localizations need snippet.defaultLanguage; categoryId is required.
 */
export function buildVideoUpdate(current: ApiVideo, f: PublishFields, loc: Record<string, Localization>, defaults: PublishDefaults = {}) {
  const snippet: Record<string, unknown> = { ...(current.snippet ?? {}) };
  delete snippet.thumbnails;
  delete snippet.channelTitle;
  delete snippet.publishedAt;
  delete snippet.channelId;
  delete snippet.localized;
  delete snippet.liveBroadcastContent;
  if (f.title?.trim()) snippet.title = f.title.trim();
  if (f.description !== undefined) snippet.description = f.description;
  if (f.tags) snippet.tags = f.tags;
  snippet.categoryId = f.category_id || current.snippet?.categoryId || defaults.category_id || "22";
  const lang = f.default_language || defaults.default_language || current.snippet?.defaultLanguage;
  if (lang) snippet.defaultLanguage = lang;
  const audio = f.default_audio_language || defaults.default_audio_language || current.snippet?.defaultAudioLanguage;
  if (audio) snippet.defaultAudioLanguage = audio;

  const status: Record<string, unknown> = { ...(current.status ?? {}) };
  for (const k of ["uploadStatus", "failureReason", "rejectionReason", "madeForKids"]) delete status[k];
  const publishAt = f.publish_at && Date.parse(f.publish_at) > Date.now() ? f.publish_at : null;
  // Already public videos: never re-privatize just because a date is stored.
  const alreadyPublic = current.status?.privacyStatus === "public";
  if (publishAt && !alreadyPublic) {
    status.privacyStatus = "private";
    status.publishAt = publishAt;
  } else {
    delete status.publishAt;
    if (f.privacy) status.privacyStatus = f.privacy;
  }
  if (f.made_for_kids !== undefined) status.selfDeclaredMadeForKids = f.made_for_kids;
  else if (defaults.made_for_kids !== undefined) status.selfDeclaredMadeForKids = defaults.made_for_kids;
  if (f.license) status.license = f.license;
  if (f.embeddable !== undefined) status.embeddable = f.embeddable;
  if (f.public_stats !== undefined) status.publicStatsViewable = f.public_stats;
  if (f.synthetic_media !== undefined) status.containsSyntheticMedia = f.synthetic_media;

  const localizations: Record<string, { title: string; description: string }> = { ...(current.localizations ?? {}) };
  for (const [l, v] of Object.entries(loc)) {
    if (v?.title?.trim() && l !== lang) localizations[l] = { title: v.title.trim(), description: v.description ?? "" };
  }
  const hasLoc = Object.keys(localizations).length > 0 && !!lang;
  return {
    parts: hasLoc ? "snippet,status,localizations" : "snippet,status",
    body: { id: current.id, snippet, status, ...(hasLoc ? { localizations } : {}) },
  };
}

/** Title / thumbnail swap only (A/B): keeps everything else. */
export function buildTitleSwap(current: ApiVideo, title: string) {
  const snippet: Record<string, unknown> = { ...(current.snippet ?? {}) };
  for (const k of ["thumbnails", "channelTitle", "publishedAt", "channelId", "localized", "liveBroadcastContent"]) delete snippet[k];
  snippet.title = title.trim();
  snippet.categoryId = current.snippet?.categoryId || "22";
  return { parts: "snippet", body: { id: current.id, snippet } };
}

// ----- Captions from the final script ----------------------------------------------------------------
/**
 * Spoken text from the script Markdown (sections in order): no headings, sources, quotes, links' URLs,
 * images, tables, code, cue/stage directions in [brackets], block color/id suffixes or HTML.
 * YouTube syncs the timing itself (captions.insert with sync), so we send plain text.
 */
export function scriptToCaptionText(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").replace(/```[\s\S]*?```/g, "").replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const out: string[] = [];
  for (let raw of lines) {
    raw = raw.replace(/[ \t]*\{(?:\s*[\w-]+="[^"]*")+\s*\}[ \t]*$/, ""); // {color="…" id="…"}
    const l = raw.trim();
    if (!l) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (/^#{1,6}\s/.test(l)) continue; // headings are not spoken
    if (/^>/.test(l)) continue; // quotes / callouts = sources & notes
    if (/^\|/.test(l)) continue; // tables
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) continue;
    if (/^(source|sources|fuente|fuentes|note|nota|ref)\s*:/i.test(l)) continue;
    if (/^!\[/.test(l)) continue;
    const t = l
      .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a: string, b?: string) => b ?? a)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\^[^\]]+\]/g, "")
      .replace(/\[[^\]]*\]/g, "") // [B-roll: …], [cut], [music]
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/(\*\*|__|~~|==|\+\+)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\\([\\`*_{}\[\]()#+\-.!|=~<>])/g, "$1")
      .replace(/[🎵🔊✂️🔍]/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (t) out.push(t);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Splits long text into chunks ≤ max characters at paragraph breaks (for AI translation). */
export function chunkText(text: string, max: number): string[] {
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > max) {
      if (cur) out.push(cur), (cur = "");
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + p.length + 2 > max) out.push(cur), (cur = "");
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

// ----- Studio checklist helpers ---------------------------------------------------------------------
/** Checklist items for this kind: Shorts swap "Test & compare" for "Related video". */
export function studioChecklist(kind: YtKind): { id: string; label: string }[] {
  const base = [
    { id: "end_screen", label: "End screen (watch-next video + playlist)" },
    { id: "cards", label: "Cards" },
    { id: "pinned_comment", label: "Pinned comment" },
    { id: "test_compare", label: "Test & compare started (3 title + thumbnail pairs)" },
  ];
  if (kind === "short") return [{ id: "related_video", label: "Related video → the long video (in the Short's details)" }, { id: "pinned_comment", label: "Pinned comment" }];
  return base;
}

/** Draft of the pinned comment (the user edits; pinning is manual). */
export function pinnedCommentDraft(o: { title: string; watchNextUrl?: string | null; question?: string | null }) {
  const q = o.question?.trim() || "What would you try first?";
  return [`Thanks for watching! ${q}`, o.watchNextUrl ? `\nNext, watch this: ${o.watchNextUrl}` : ""].join("").trim();
}

export const PRIVACY_LABEL: Record<PrivacyStatus, string> = { private: "Private", unlisted: "Unlisted", public: "Public" };
/** Common YouTube categories (id → name). Education is 27, People & Blogs 22, Science & Technology 28. */
export const YT_CATEGORIES: { id: string; label: string }[] = [
  { id: "27", label: "Education" },
  { id: "28", label: "Science & Technology" },
  { id: "22", label: "People & Blogs" },
  { id: "26", label: "Howto & Style" },
  { id: "24", label: "Entertainment" },
  { id: "1", label: "Film & Animation" },
  { id: "10", label: "Music" },
  { id: "20", label: "Gaming" },
  { id: "25", label: "News & Politics" },
  { id: "29", label: "Nonprofits & Activism" },
  { id: "17", label: "Sports" },
  { id: "19", label: "Travel & Events" },
  { id: "2", label: "Autos & Vehicles" },
  { id: "15", label: "Pets & Animals" },
  { id: "23", label: "Comedy" },
];
export const LANGUAGES: { id: string; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
];
/** The translations needed: EN + ES minus the default language. */
export function requiredLangs(defaultLanguage: string | null | undefined) {
  const d = (defaultLanguage || "en").slice(0, 2);
  return LANGUAGES.map((l) => l.id).filter((l) => l !== d);
}

// ===== Round 2 (publish page, captions, Shorts) =====================================================
export const youtubeWatchUrl = (ytId: string) => `https://www.youtube.com/watch?v=${ytId}`;
export const youtubeShortUrl = (ytId: string) => `https://www.youtube.com/shorts/${ytId}`;
export const studioEditUrl = (ytId: string) => `https://studio.youtube.com/video/${ytId}/edit`;
export const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;

/** "PLxxxx" or a playlist link → the playlist id (null when it is not one). */
export function parsePlaylistId(input: string): string | null {
  const s = input.trim();
  if (/^(PL|UU|LL|FL|OL)[\w-]{10,}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
    const l = u.searchParams.get("list");
    return l && /^[\w-]{10,}$/.test(l) ? l : null;
  } catch {
    return null;
  }
}

/** Link lines for the description: watch-next video, first playlist, then the user's own lines. */
export function descriptionLinks(o: { watchNext?: { title: string; ytId: string | null } | null; playlists?: string[]; extra?: string | null }): string[] {
  const out: string[] = [];
  if (o.watchNext?.ytId) out.push(`▶ Watch next: ${o.watchNext.title} — ${youtubeWatchUrl(o.watchNext.ytId)}`);
  const pl = (o.playlists ?? []).find(Boolean);
  if (pl) out.push(`📺 Playlist: ${playlistUrl(pl)}`);
  for (const l of (o.extra ?? "").split(/\r?\n/)) if (l.trim()) out.push(l.trim());
  return out;
}

export type MusicCreditRow = { track: string; source: string; license: string | null; position?: number };
/** Music credits from yt_music (no repeats). Music Lab tracks are the user's own: "original music". */
export function musicCredits(rows: MusicCreditRow[]): string[] {
  const out: string[] = [];
  for (const r of [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const name = r.track.trim();
    if (!name) continue;
    const line = r.source === "music_lab" ? `${name} (original music)` : r.license?.trim() ? `${name} — ${r.license.trim()}` : name;
    if (!out.some((o) => o.toLowerCase() === line.toLowerCase())) out.push(line);
  }
  return out;
}

/** Hook = the two lines before "…more": keeps at most 2 non-empty lines. */
export function cleanHook(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, YT_LIMITS.descriptionHookLines)
    .join("\n");
}

/** Takes the hook back out of a saved description (the lines before the first empty line, max 2). */
export function hookOf(description: string): string {
  const first = description.replace(/\r\n?/g, "\n").split(/\n\s*\n/)[0] ?? "";
  if (/^chapters\b/i.test(first.trim()) || /^\d+:\d{2}/.test(first.trim())) return "";
  return cleanHook(first);
}

/** First fields when the user opens Publish: title from the primary pair + the channel's defaults. */
export function initialFields(o: { title: string | null; defaults: PublishDefaults; kind: YtKind; current?: PublishFields | null }): PublishFields {
  const d = o.defaults;
  const cur = o.current ?? {};
  return {
    privacy: d.privacy ?? "private",
    made_for_kids: d.made_for_kids ?? false,
    category_id: d.category_id ?? "27",
    default_language: d.default_language ?? "en",
    default_audio_language: d.default_audio_language ?? d.default_language ?? "en",
    tags: d.tags ?? [],
    license: "youtube",
    embeddable: true,
    public_stats: true,
    synthetic_media: false,
    ...cur,
    title: cur.title?.trim() ? cur.title : o.title ?? "",
  };
}

// ----- Captions --------------------------------------------------------------------------------------
export type CaptionSection = { kind: string; title: string; content: string };
/**
 * EN caption text = the script sections in order, spoken words only: Source blocks (📎) removed first,
 * then headings, quotes, cues in [brackets], links and formatting (scriptToCaptionText).
 * `stripSources` is Worker B's (outline.ts) and understands the collapsible Source blocks.
 */
export function captionTextFromSections(sections: CaptionSection[], stripSources: (md: string) => string = (m) => m): string {
  return sections
    .map((s) => scriptToCaptionText(dropCueLines(stripSources(s.content ?? ""))))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** Lines that start with a cue mark (🎵 music, 🔊 SFX, ✂️ cut, 🔍 zoom) are editing notes, not speech. */
export function dropCueLines(md: string): string {
  return md
    .split(/\r?\n/)
    .filter((l) => !/^\s*(?:[-*]\s+)?(?:🎵|🔊|✂️|✂|🔍)/u.test(l))
    .join("\n");
}

/** Words in a caption text. */
export const captionWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/**
 * Warnings before sending captions: always the "improvised parts" reminder; louder when the final cut is much
 * longer/shorter than the script read at the user's speed (= you said things that are not in the script).
 */
export function captionWarnings(o: { text: string; wpm: number; cutSeconds: number | null | undefined }): string[] {
  const w: string[] = [];
  if (!o.text.trim()) return ["The caption text is empty — write the script first (Script tab)."];
  w.push("Captions come from the script. Anything you improvised on camera will not be in them: read them once and fix those parts.");
  const words = captionWords(o.text);
  const scriptS = Math.round((words / Math.max(60, o.wpm || 150)) * 60);
  if (o.cutSeconds && o.cutSeconds > 0 && scriptS > 0) {
    const ratio = o.cutSeconds / scriptS;
    if (ratio > 1.3) w.push(`The final cut (${stamp(o.cutSeconds)}) is much longer than the script read aloud (~${stamp(scriptS)}): you probably improvised a lot — YouTube's auto-timing may drift there.`);
    else if (ratio < 0.7) w.push(`The final cut (${stamp(o.cutSeconds)}) is much shorter than the script (~${stamp(scriptS)}): parts were cut — delete them from the captions too.`);
  }
  return w;
}

/**
 * The multipart/related body of captions.insert (uploadType=multipart): JSON metadata + the plain text.
 * Returned as a string; the Content-Type header is `multipart/related; boundary=<boundary>`.
 */
export function captionMultipart(o: { videoId: string; language: string; name: string; text: string; boundary: string }): string {
  const meta = { snippet: { videoId: o.videoId, language: o.language, name: o.name, isDraft: false } };
  return [
    `--${o.boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(meta),
    `--${o.boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    o.text,
    `--${o.boundary}--`,
    "",
  ].join("\r\n");
}

// ----- Marking as published ---------------------------------------------------------------------------
/** Can it be marked published? Needs a linked YouTube id; the date can't be in the far future. */
export function publishedProblems(o: { ytId: string | null; publishedAt: string | null; now: Date }): string[] {
  const p: string[] = [];
  if (!o.ytId) p.push("Link the YouTube video first (paste its link after you upload it in Studio).");
  if (o.publishedAt) {
    const t = Date.parse(o.publishedAt);
    if (!Number.isFinite(t)) p.push("The publish date is not valid.");
    else if (t > o.now.getTime() + 60 * 86_400_000) p.push("The publish date is too far away.");
  }
  return p;
}

// ----- Shorts ------------------------------------------------------------------------------------------
export type ShortRoleId = "teaser" | "standalone" | "test";

/** Problems with a source range cut from the long video (seconds). Empty = OK. */
export function shortRangeProblems(start: number | null, end: number | null, parentDurationS?: number | null): string[] {
  if (start == null && end == null) return [];
  const p: string[] = [];
  if (start == null || end == null) return ["Give both the start and the end of the clip."];
  if (start < 0 || end < 0) p.push("Times can't be negative.");
  if (end <= start) p.push("The end must be after the start.");
  else if (end - start > YT_LIMITS.shortMaxSeconds) p.push(`A Short can be at most ${YT_LIMITS.shortMaxSeconds} s (this clip is ${end - start} s).`);
  else if (end - start < 5) p.push("That clip is shorter than 5 seconds.");
  if (parentDurationS && end > parentDurationS) p.push(`The long video is only ${stamp(parentDurationS)} long.`);
  return p;
}

/** Default name of a Short made from a long video. */
export function shortName(parentName: string, role: ShortRoleId, n: number) {
  const r = role === "teaser" ? "Teaser" : role === "test" ? "Test" : "Short";
  return `${r} ${n} · ${parentName}`.slice(0, 200);
}

/** Starting stage of a new Short: clips cut from the long go straight to Edit; made-on-purpose ones need a short script. */
export function shortStartStage(o: { hasRange: boolean }): "edit" | "script" {
  return o.hasRange ? "edit" : "script";
}

/** Which role the made-on-purpose Short should take: doubtful ideas in the bank → Test, otherwise Standalone. */
export function suggestPurposeRole(doubtfulIdeas: number): ShortRoleId {
  return doubtfulIdeas > 0 ? "test" : "standalone";
}

/**
 * Suggested publish day for each Short of a long video (local dates): Teaser 1 = day 2, Teaser 2 = day 5,
 * the made-on-purpose one mid-week before the next long (day 4 if there is no next long date).
 */
export function shortScheduleSuggestion(o: { longDate: string; role: ShortRoleId; teaserIndex: number; nextLongDate?: string | null; addDays: (d: string, n: number) => string; daysBetween: (a: string, b: string) => number }): string {
  if (o.role === "teaser") return o.addDays(o.longDate, o.teaserIndex <= 1 ? 2 : 5);
  if (o.nextLongDate) {
    const gap = o.daysBetween(o.longDate, o.nextLongDate);
    if (gap >= 4) return o.addDays(o.longDate, Math.floor(gap / 2) + 1);
  }
  return o.addDays(o.longDate, 4);
}

/** The Short's own plan: what's done and what's next (short path, not the 4 ideation steps). */
export function shortPath(o: { hook: boolean; source: boolean; script: boolean | null; captions: boolean; related: boolean; published: boolean }) {
  const steps = [
    { id: "hook", label: "Hook (first 1–2 s, on-screen text)", done: o.hook },
    { id: "source", label: "Source (time range of the long, or new vertical shots)", done: o.source },
    ...(o.script === null ? [] : [{ id: "script", label: "Short script (Hook · Body · Payoff/Loop)", done: o.script }]),
    { id: "captions", label: "Captions", done: o.captions },
    { id: "related", label: "Related video → the long video", done: o.related },
    { id: "published", label: "Publish", done: o.published },
  ];
  return { steps, next: steps.find((s) => !s.done)?.label ?? null };
}
