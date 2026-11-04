// YouTube Pipeline add-on — TypeScript shapes of every yt_ table (migrations 0031–0036) and the shared enums.
// Pure types: safe to import anywhere (server, client, tests). Column names match the database exactly.
// Lists of allowed values (with labels) live in constants.ts.

export type Uuid = string;
/** ISO timestamp as Supabase returns it. */
export type Ts = string;

// ----- Enums ---------------------------------------------------------------------------------------
export type YtStage =
  | "bank" | "idea" | "package" | "research" | "outline" | "script" | "shots" | "filming" | "edit" | "publish" | "published" | "archived";
export type YtKind = "long" | "short";
export type ShortRole = "teaser" | "standalone" | "test";
export type IdeaStep = "topic" | "format" | "angle" | "criteria";
export type IdeaSource = "web" | "telegram" | "note" | "comment" | "follow_up" | "short_test" | "watchlist";
export type VideoFormat = "tutorial" | "challenge" | "breakdown" | "commentary" | "vlog" | "interview";
export type VideoAngle =
  | "superlatives" | "stakes" | "money" | "time" | "comprehensive" | "list" | "familiarity" | "topic_twist"
  | "comparison" | "transformation" | "beginner" | "authority" | "outcome" | "mistakes" | "controversial";
export type GateKey = "feasibility" | "brand" | "packageability";
export type RatingKey = "excitement" | "confidence" | "effort" | "new_audience" | "existing_audience";
export type LinkKind = "series" | "follow_up" | "watch_next";
export type VariantKind = "title" | "thumbnail";
export type GapType = "moment" | "story" | "result" | "transformation" | "novelty";
export type ScrollStopper = "bright_colors" | "big_numbers" | "danger_motion" | "aesthetic" | "money" | "emotions" | "faces";
export type ContrastKind = "luminance" | "saturation" | "hue";
export type ThumbTestKey = "clarity" | "contrast" | "glance" | "bonus";
export type CardKind = "note" | "fragment" | "quick" | "link" | "reference";
export type ReferenceSource = "finder" | "manual" | "watchlist";
export type SectionKind = "intro" | "body" | "closing";
export type IntroStatus = "not_written" | "draft" | "final" | "filmed";
export type CueKind = "music" | "sfx" | "cut" | "zoom";
/** AR talking head · BR B-roll · SC screen · GR graphics & text · ST stock · PH phone · VT vertical */
export type ShotKind = "AR" | "BR" | "SC" | "GR" | "ST" | "PH" | "VT";
export type Framing = "wide" | "medium" | "close";
export type MomentKind = "funny" | "fail" | "reveal" | "effort" | "other";
export type ClipLocation = "drive" | "pc" | "phone" | "other";
export type ClipStatus = "missing" | "recorded" | "imported" | "in_timeline";
export type EditPass = "rough_cut" | "annotation" | "broll" | "music" | "visual" | "sfx";
export type MusicSource = "music_lab" | "library" | "other";
export type TestKind = "test_compare" | "swap";
export type TestVerdict = "winner" | "same" | "inconclusive" | "no_clear_difference";
export type CheckinKind = "48h" | "7d" | "30d" | "90d";
export type CheckinVerdict = "above" | "normal" | "below" | "insufficient";
export type WatchOutlierStatus = "new" | "saved" | "idea" | "dismissed";
export type PrivacyStatus = "private" | "unlisted" | "public";

// ----- jsonb shapes ---------------------------------------------------------------------------------
export type FinderFilters = {
  min_views: number;
  max_subs: number;
  /** views ÷ channel median */
  min_outlier: number;
  min_age_days: number;
  max_results: number;
  /** optional extras */
  published_after_days?: number | null;
  shorts?: "exclude" | "include" | "only";
};
export type SonicIdentity = {
  instruments?: string[];
  bpm_min?: number | null;
  bpm_max?: number | null;
  key?: string | null;
  style?: string | null;
  notes?: string | null;
};
export type WeeklyReviewPrefs = { day: number; time: string; telegram: boolean; note: boolean };
export type PublishDefaults = {
  category_id?: string;
  default_language?: string;
  default_audio_language?: string;
  tags?: string[];
  description_template?: string;
  privacy?: PrivacyStatus;
  playlists?: string[];
  made_for_kids?: boolean;
};
/** null = not answered yet */
export type Gates = Partial<Record<GateKey, boolean | null>> & { notes?: string };
/** 1–10 each */
export type Ratings = Partial<Record<RatingKey, number>>;
export type ScoreWeights = Partial<Record<RatingKey | "view_potential", number>>;
export type ThumbTests = Partial<Record<ThumbTestKey, boolean>> & { notes?: string };
export type IntroGuides = {
  open_loop?: string;
  closes_section_id?: Uuid | null;
  context?: string;
  input_bias?: string;
  first_line_matches?: boolean;
  first_shot_matches?: boolean;
};
export type OutlineTemplateSection = { kind: SectionKind; title: string; description?: string; is_climax?: boolean; energy?: number };
export type Chapter = { start_s: number; title: string };
export type Localization = { title: string; description: string };
export type PublishFields = {
  title?: string;
  description?: string;
  tags?: string[];
  category_id?: string;
  default_language?: string;
  default_audio_language?: string;
  privacy?: PrivacyStatus;
  publish_at?: string | null;
  made_for_kids?: boolean;
  license?: "youtube" | "creativeCommon";
  embeddable?: boolean;
  public_stats?: boolean;
  synthetic_media?: boolean;
};
export type CaptionTrack = { text: string; reviewed: boolean; pushed_at?: string | null; track_id?: string | null };
export type VideoMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
  subs_gained?: number;
  impressions?: number;
  ctr?: number;
  avg_view_duration_s?: number;
  avg_view_pct?: number;
  retention?: { t: number; pct: number }[];
  at?: string;
};

// ----- Tables ---------------------------------------------------------------------------------------
export type YtSettings = {
  user_id: Uuid;
  channel_url: string | null;
  channel_id: string | null;
  channel_title: string | null;
  channel_handle: string | null;
  view_goal: number | null;
  words_per_min: number;
  wip_limit: number;
  finder_filters: FinderFilters;
  score_weights: ScoreWeights;
  sonic_identity: SonicIdentity;
  weekly_review: WeeklyReviewPrefs;
  publish_defaults: PublishDefaults;
  footage_root: string | null;
  /** last V-number given (managed by the database trigger) */
  last_code: number;
  created_at: Ts;
  updated_at: Ts;
};

export type YtVideo = {
  id: Uuid;
  user_id: Uuid;
  seq: number | null;
  /** "V012" — null while the idea is in the bank (set by the database when approved) */
  code: string | null;
  kind: YtKind;
  parent_id: Uuid | null;
  short_role: ShortRole | null;
  source_start_s: number | null;
  source_end_s: number | null;
  idea_name: string;
  topic: string | null;
  base_idea: string | null;
  formats: string[];
  angles: string[];
  angle_notes: string | null;
  stage: YtStage;
  step: IdeaStep;
  gates: Gates;
  ratings: Ratings;
  view_potential: number | null;
  data_score: number | null;
  priority: number;
  predicted_views: number | null;
  source: IdeaSource;
  source_quote: string | null;
  note_id: Uuid | null;
  origin_video_id: Uuid | null;
  gap_known: string | null;
  gap_want: string | null;
  package_ready: boolean;
  outline_template: string | null;
  outline_locked_at: Ts | null;
  footage_folder: string | null;
  quick_notes: string | null;
  tags: string[];
  position: number;
  approved_at: Ts | null;
  stage_changed_at: Ts;
  scheduled_at: Ts | null;
  youtube_video_id: string | null;
  published_at: Ts | null;
  archived_reason: string | null;
  created_at: Ts;
  updated_at: Ts;
};

export type YtVideoLink = { id: Uuid; user_id: Uuid; from_id: Uuid; to_id: Uuid; kind: LinkKind; note: string | null; position: number; created_at: Ts };

export type YtReference = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid | null;
  yt_id: string | null;
  url: string;
  title: string;
  channel_id: string | null;
  channel_title: string | null;
  channel_subs: number | null;
  views: number | null;
  channel_median: number | null;
  outlier_score: number | null;
  published_at: Ts | null;
  thumbnail_url: string | null;
  duration_s: number | null;
  is_short: boolean;
  source: ReferenceSource;
  note: string | null;
  position: number;
  created_at: Ts;
};

export type YtVariant = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  kind: VariantKind;
  label: string | null;
  position: number;
  /** the title text (kind=title) or the concept's short name (kind=thumbnail) */
  value: string;
  gap_type: GapType | null;
  focal: string | null;
  supporting: string | null;
  composition: string | null;
  contrast: string[];
  stoppers: string[];
  thumb_text: string | null;
  image_url: string | null;
  tests: ThumbTests;
  /** learning-library attributes (face, title style, …) */
  attrs: Record<string, unknown>;
  archived: boolean;
  created_at: Ts;
  updated_at: Ts;
};

export type YtPair = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  label: string;
  title_id: Uuid | null;
  thumbnail_id: Uuid | null;
  position: number;
  is_primary: boolean;
  active_from: Ts | null;
  active_to: Ts | null;
  result: string | null;
  notes: string | null;
  created_at: Ts;
};

export type YtBucket = {
  id: Uuid;
  user_id: Uuid;
  /** null = topic shelf */
  video_id: Uuid | null;
  is_shelf: boolean;
  name: string;
  description: string | null;
  color: string | null;
  position: number;
  created_at: Ts;
};

export type YtCard = {
  id: Uuid;
  user_id: Uuid;
  bucket_id: Uuid;
  video_id: Uuid | null;
  kind: CardKind;
  note_id: Uuid | null;
  block_id: string | null;
  quote_text: string | null;
  url: string | null;
  preview: { title?: string; description?: string; image?: string; site?: string } | null;
  text: string | null;
  annotation: string | null;
  reference_id: Uuid | null;
  position: number;
  created_at: Ts;
  updated_at: Ts;
};

export type YtSection = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  kind: SectionKind;
  /** fixed number once the outline is locked: intro 0, closing 99, body 1… (null before) */
  num: number | null;
  title: string;
  description: string | null;
  position: number;
  is_climax: boolean;
  /** Markdown (Notes editor format) */
  content: string;
  words: number;
  card_ids: Uuid[];
  energy: number | null;
  start_s: number | null;
  intro_status: IntroStatus;
  intro_guides: IntroGuides;
  watch_checks: number;
  watch_notes: string | null;
  created_at: Ts;
  updated_at: Ts;
};

export type YtOutlineTemplate = {
  id: Uuid;
  user_id: Uuid;
  format: string;
  name: string;
  sections: OutlineTemplateSection[];
  position: number;
  created_at: Ts;
  updated_at: Ts;
};

export type YtCue = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  section_id: Uuid;
  block_id: string | null;
  anchor_text: string | null;
  kind: CueKind;
  text: string | null;
  mood: string | null;
  energy: number | null;
  at_s: number | null;
  position: number;
  created_at: Ts;
};

export type YtScriptExport = { id: Uuid; user_id: Uuid; video_id: Uuid; note_id: Uuid | null; version: number; title: string | null; exported_at: Ts };

export type YtShot = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  section_id: Uuid | null;
  block_id: string | null;
  para_hash: string | null;
  line_text: string | null;
  /** shot number inside its section (for file names S03-05) */
  num: number | null;
  kind: ShotKind;
  description: string | null;
  framing: string | null;
  angle: string | null;
  movement: string | null;
  location: string | null;
  setup: string | null;
  props: string | null;
  lighting: string | null;
  outfit: string | null;
  duration_s: number | null;
  audio: string | null;
  edit_notes: string | null;
  done: boolean;
  done_at: Ts | null;
  script_changed: boolean;
  is_pickup: boolean;
  matches_thumbnail: boolean;
  ai_suggested: boolean;
  position: number;
  created_at: Ts;
  updated_at: Ts;
};

export type YtMoment = { id: Uuid; user_id: Uuid; video_id: Uuid; shot_id: Uuid | null; text: string; kind: MomentKind; at: Ts; used_in_intro: boolean; created_at: Ts };

export type YtClip = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  shot_id: Uuid | null;
  file_name: string;
  original_name: string | null;
  location: ClipLocation;
  url_or_path: string | null;
  take: number;
  is_best: boolean;
  status: ClipStatus;
  /** shot kind code, or extra kind (stock, image, meme…) */
  kind: string | null;
  source: string | null;
  license: string | null;
  notes: string | null;
  position: number;
  created_at: Ts;
  updated_at: Ts;
};

export type YtEditPass = { id: Uuid; user_id: Uuid; video_id: Uuid; pass: EditPass; done_at: Ts | null; link: string | null; notes: string | null; created_at: Ts };
export type YtCut = { id: Uuid; user_id: Uuid; video_id: Uuid; label: string; url: string | null; duration_s: number | null; notes: string | null; created_at: Ts };
export type YtReviewNote = { id: Uuid; user_id: Uuid; video_id: Uuid; cut_id: Uuid; at_seconds: number; text: string; resolved: boolean; created_at: Ts };

export type YtMusic = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  section_id: Uuid | null;
  track: string;
  source: MusicSource;
  license: string | null;
  file_name: string | null;
  /** Music Lab recipe (all inputs + seed) — shape owned by src/lib/youtube/music.ts */
  recipe: Record<string, unknown> | null;
  start_s: number | null;
  end_s: number | null;
  position: number;
  created_at: Ts;
  updated_at: Ts;
};

export type YtPublish = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  youtube_video_id: string | null;
  fields: PublishFields;
  /** { es: {title, description}, en: {...} } */
  localizations: Record<string, Localization>;
  chapters: Chapter[];
  playlists: string[];
  /** { en: CaptionTrack, es: CaptionTrack } */
  captions: Record<string, CaptionTrack>;
  captions_pushed: boolean;
  captions_pushed_at: Ts | null;
  /** manual Studio steps: end_screen, cards, pinned_comment, test_compare… → boolean */
  checklist: Record<string, boolean>;
  pinned_comment: string | null;
  post_plan: Record<string, unknown>;
  scheduled_at: Ts | null;
  pushed_at: Ts | null;
  push_log: { at: string; what: string; ok: boolean; error?: string }[];
  created_at: Ts;
  updated_at: Ts;
};

export type YtTest = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  kind: TestKind;
  pair_ids: Uuid[];
  from_pair_id: Uuid | null;
  to_pair_id: Uuid | null;
  winner_pair_id: Uuid | null;
  started_at: Ts;
  ended_at: Ts | null;
  verdict: TestVerdict | null;
  metrics_before: VideoMetrics;
  metrics_after: VideoMetrics;
  attrs: Record<string, unknown>;
  notes: string | null;
  created_at: Ts;
};

export type YtCheckin = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  kind: CheckinKind;
  due_at: Ts;
  done_at: Ts | null;
  metrics: VideoMetrics;
  baseline: VideoMetrics & { n?: number };
  verdict: CheckinVerdict | null;
  notified_at: Ts | null;
  notes: string | null;
  created_at: Ts;
};

export type YtPostmortem = { id: Uuid; user_id: Uuid; video_id: Uuid; checkin_id: Uuid | null; text: string; note_id: Uuid | null; created_at: Ts; updated_at: Ts };

export type YtCommentTodo = {
  id: Uuid;
  user_id: Uuid;
  video_id: Uuid;
  comment_id: string | null;
  text: string;
  author: string | null;
  like_count: number | null;
  published_at: Ts | null;
  answered: boolean;
  idea_video_id: Uuid | null;
  created_at: Ts;
};

export type YtWatchChannel = {
  id: Uuid;
  user_id: Uuid;
  channel_id: string;
  handle: string | null;
  title: string;
  url: string | null;
  thumbnail_url: string | null;
  subs: number | null;
  median_views: number | null;
  active: boolean;
  last_checked_at: Ts | null;
  last_upload_at: Ts | null;
  notes: string | null;
  created_at: Ts;
};

export type YtWatchOutlier = {
  id: Uuid;
  user_id: Uuid;
  channel_row_id: Uuid | null;
  yt_id: string;
  title: string;
  url: string | null;
  thumbnail_url: string | null;
  views: number | null;
  channel_median: number | null;
  outlier_score: number | null;
  published_at: Ts | null;
  status: WatchOutlierStatus;
  video_id: Uuid | null;
  found_at: Ts;
};

export type YtWeekly = { id: Uuid; user_id: Uuid; week_start: string; summary: string; data: Record<string, unknown>; note_id: Uuid | null; sent_at: Ts | null; created_at: Ts };

/** Server only — never send to the browser. */
export type YtOauth = {
  user_id: Uuid;
  google_sub: string | null;
  channel_id: string | null;
  channel_title: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: Ts | null;
  scopes: string[];
  connected_at: Ts;
  last_refresh_at: Ts | null;
  last_error: string | null;
  updated_at: Ts;
};
/** What rpc("yt_oauth_status") returns (one row or none) — safe for the page. */
export type YtOauthStatus = {
  connected: boolean;
  channel_id: string | null;
  channel_title: string | null;
  scopes: string[];
  expires_at: Ts | null;
  connected_at: Ts | null;
  last_refresh_at: Ts | null;
  last_error: string | null;
};
export type YtApiCache = { user_id: Uuid; key: string; data: unknown; fetched_at: Ts; expires_at: Ts | null };
export type YtQuota = { user_id: Uuid; day: string; units: number; search_calls: number };

/** Table name → row type (handy for generic helpers). */
export type YtTables = {
  yt_settings: YtSettings;
  yt_videos: YtVideo;
  yt_video_links: YtVideoLink;
  yt_references: YtReference;
  yt_variants: YtVariant;
  yt_pairs: YtPair;
  yt_buckets: YtBucket;
  yt_cards: YtCard;
  yt_sections: YtSection;
  yt_outline_templates: YtOutlineTemplate;
  yt_cues: YtCue;
  yt_script_exports: YtScriptExport;
  yt_shots: YtShot;
  yt_moments: YtMoment;
  yt_clips: YtClip;
  yt_edit_passes: YtEditPass;
  yt_cuts: YtCut;
  yt_review_notes: YtReviewNote;
  yt_music: YtMusic;
  yt_publish: YtPublish;
  yt_tests: YtTest;
  yt_checkins: YtCheckin;
  yt_postmortems: YtPostmortem;
  yt_comments_todo: YtCommentTodo;
  yt_watch_channels: YtWatchChannel;
  yt_watch_outliers: YtWatchOutlier;
  yt_weekly: YtWeekly;
  yt_oauth: YtOauth;
  yt_api_cache: YtApiCache;
  yt_quota: YtQuota;
};
export type YtTableName = keyof YtTables;
