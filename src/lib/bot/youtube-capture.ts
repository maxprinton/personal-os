// YouTube add-on in Telegram (server only). Owner: Worker A.
//  · "yt: how I built my calendar" / "/yt how I built…" / "youtube: …" (also by voice) → a new idea in the idea bank
//  · "yt short: …", "yts: …" or "#shorts" in the text → the idea is a Short
//  · YouTube links in the message → saved as references of that idea (title from YouTube when reachable)
//  · "/youtube" (or "/yt" alone) → short summary: best ideas in the bank, what is in progress, published lately
// The admin client skips RLS: EVERY query filters by user_id.
import type { Ctx } from "@/lib/bot/core";
import type { Kb } from "@/lib/bot/tg";
import { BANK_STAGES, MIGRATION_FILE, WIP_STAGES, stageLabel, videoLabel } from "@/lib/youtube/constants";
import { nextStep, parseCapture, wipStatus, ytThumb, type BoardVideo } from "@/lib/youtube/scoring";

type Reply = { text: string; kb: Kb };

const MISSING = `The YouTube add-on isn't set up yet. In Supabase run ${MIGRATION_FILE}, then try again.`;
const isMissing = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /yt_/.test(e.message ?? ""));

/**
 * The idea text of a YouTube capture, or null when the message is not one.
 * "yt: idea", "youtube: idea", "/yt idea", "/yt@Bot idea"; "yt short: idea" / "yts: idea" → "short: idea".
 * "/yt" alone → null (that's the summary).
 */
export function parseYoutubeCapture(text: string): string | null {
  const t = text.trim();
  const short = /^(?:yt|youtube)\s+shorts?\s*:\s*([\s\S]+)$/i.exec(t) ?? /^yts\s*:\s*([\s\S]+)$/i.exec(t);
  const m = short ?? /^(?:yt|youtube)\s*:\s*([\s\S]+)$/i.exec(t) ?? /^\/(?:yt|idea_yt)(?:@\w+)?\s+([\s\S]+)$/i.exec(t);
  if (!m) return null;
  const idea = m[1].replace(/[ \t]+/g, " ").trim();
  if (!idea) return null;
  return (short ? `short: ${idea}` : idea).slice(0, 2000);
}

/** True for "/youtube", "/yt", "youtube" alone (the summary). */
export function isYoutubeSummary(text: string) {
  return /^\/?(?:youtube|yt)(?:@\w+)?$/i.test(text.trim());
}

async function oembedTitle(url: string): Promise<{ title?: string; author_name?: string } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(3500) });
    return res.ok ? ((await res.json()) as { title?: string; author_name?: string }) : null;
  } catch {
    return null;
  }
}

/** Saves the idea in the idea bank (stage "bank", source "telegram") and answers. */
export async function handleYoutubeCapture(c: Ctx, idea: string): Promise<Reply> {
  const cap = parseCapture(idea);
  if (!cap) return { text: "Write the idea after “yt:”. Example: yt: How I built my own calendar", kb: [] };

  const metas = await Promise.all(cap.links.slice(0, 5).map((l) => oembedTitle(l.url)));
  let name = cap.idea_name;
  if (!name) {
    const t = metas.find((m) => m?.title)?.title;
    name = t ? `Like “${t.slice(0, 100)}”` : "Idea from a YouTube video";
  }

  // Same idea already waiting in the bank? Don't save it twice.
  const { data: dup, error: dupErr } = await c.admin
    .from("yt_videos")
    .select("id,idea_name")
    .eq("user_id", c.userId)
    .in("stage", BANK_STAGES)
    .ilike("idea_name", name.replace(/[%_\\]/g, (x) => `\\${x}`))
    .limit(1);
  if (dupErr && isMissing(dupErr)) return { text: MISSING, kb: [] };
  if (dup?.length && !cap.links.length) return { text: `💡 That idea is already in the bank: “${dup[0].idea_name}”.`, kb: [] };

  const { data, error } = await c.admin
    .from("yt_videos")
    .insert({
      user_id: c.userId,
      idea_name: name,
      topic: cap.topic || name,
      kind: cap.kind,
      stage: "bank",
      step: "topic",
      source: "telegram",
      source_quote: cap.quote,
    })
    .select("id")
    .single();
  if (error || !data) return { text: isMissing(error) ? MISSING : "Sorry, I couldn't save that idea. Try again.", kb: [] };

  let refs = 0;
  if (cap.links.length) {
    const rows = cap.links.slice(0, 5).map((l, i) => ({
      user_id: c.userId,
      video_id: data.id,
      yt_id: l.yt_id,
      url: l.url,
      title: metas[i]?.title?.slice(0, 300) || l.url,
      channel_title: metas[i]?.author_name?.slice(0, 200) ?? null,
      thumbnail_url: ytThumb(l.yt_id),
      is_short: l.is_short,
      source: "manual",
      position: i + 1,
    }));
    const { error: rErr } = await c.admin.from("yt_references").insert(rows);
    if (!rErr) refs = rows.length;
  }

  const { count } = await c.admin.from("yt_videos").select("id", { count: "exact", head: true }).eq("user_id", c.userId).in("stage", BANK_STAGES);
  const L = [`🎬 Saved to the YouTube idea bank${cap.kind === "short" ? " (Short)" : ""}: “${name}”`];
  if (refs) L.push(`🔗 ${refs} reference video${refs === 1 ? "" : "s"} saved with it.`);
  if (count) L.push(`💡 ${count} ${count === 1 ? "idea" : "ideas"} in the bank.`);
  L.push("Develop it on the web: YouTube → Board.");
  return { text: L.join("\n"), kb: [] };
}

/** /youtube: best ideas in the bank, what is in progress (vs the WIP limit) with its next step, published lately. */
export async function youtubeView(c: Ctx): Promise<Reply> {
  const { data, error } = await c.admin
    .from("yt_videos")
    .select("id,code,idea_name,stage,kind,step,topic,formats,angles,gates,ratings,priority,package_ready,created_at,stage_changed_at,published_at")
    .eq("user_id", c.userId)
    .neq("stage", "archived")
    .order("stage_changed_at", { ascending: false })
    .limit(500);
  if (error) return { text: isMissing(error) ? MISSING : "Sorry, I couldn't read the YouTube board. Try again.", kb: [] };
  type Row = BoardVideo & { code: string | null; published_at: string | null };
  const rows = (data ?? []) as unknown as Row[];
  const { data: set } = await c.admin.from("yt_settings").select("wip_limit").eq("user_id", c.userId).maybeSingle();
  const bank = rows.filter((r) => (BANK_STAGES as string[]).includes(r.stage));
  const wipRows = rows.filter((r) => (WIP_STAGES as string[]).includes(r.stage));
  const wip = wipStatus(rows.map((r) => r.stage), (set?.wip_limit as number | undefined) ?? null);
  const pub = rows.filter((r) => r.stage === "published").slice(0, 3);

  const L = ["🎬 YouTube", `💡 ${bank.length} ${bank.length === 1 ? "idea" : "ideas"} in the bank`];
  const best = [...bank].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 3);
  for (const v of best) L.push(`  • ${v.idea_name}${v.priority ? ` (${v.priority})` : ""}${v.kind === "short" ? " · Short" : ""}`);
  L.push("", `🛠 In progress: ${wip.count}/${wip.limit}${wip.over ? " ⚠️ over your limit — finish one first" : ""}`);
  for (const v of wipRows.slice(0, 8)) L.push(`• ${videoLabel(v)}${v.kind === "short" ? " (Short)" : ""} — ${stageLabel(v.stage)}${v.stage === "package" || v.stage === "research" ? "" : ` → ${nextStep(v)}`}`);
  if (pub.length) {
    L.push("", "📺 Published lately");
    for (const v of pub) L.push(`• ${videoLabel(v)}`);
  }
  L.push("", "New idea: yt: <your idea>  ·  Short: yt short: <idea>");
  return { text: L.join("\n"), kb: [] };
}
