// /youtube/v/[id]/script — outline → script by sections → intro assistant → export to Notes (Worker B).
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai";
import { getVideo, getYtSettings, ytServer } from "@/lib/youtube/db";
import { DEFAULT_WORDS_PER_MIN } from "@/lib/youtube/constants";
import { orderSections } from "@/lib/youtube/outline";
import type { YtCard, YtMoment, YtOutlineTemplate, YtPair, YtScriptExport, YtSection, YtShot, YtVariant } from "@/lib/youtube/types";
import ScriptWorkspace, { type ScriptCard, type PinnedPair } from "@/components/youtube/script/ScriptWorkspace";

export const dynamic = "force-dynamic";

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ video, missing }, { settings }] = await Promise.all([getVideo(id), getYtSettings()]);
  if (missing) return null;
  if (!video) notFound();
  const { supabase } = await ytServer();
  const vid = video.id;
  const [secRes, tplRes, cardRes, bucketRes, expRes, pairRes, varRes, shotRes, momRes] = await Promise.all([
    supabase.from("yt_sections").select("*").eq("video_id", vid),
    supabase.from("yt_outline_templates").select("*").order("position").order("created_at"),
    supabase.from("yt_cards").select("*").eq("video_id", vid).order("position"),
    supabase.from("yt_buckets").select("id,name,position").eq("video_id", vid).order("position"),
    supabase.from("yt_script_exports").select("*").eq("video_id", vid).order("version"),
    supabase.from("yt_pairs").select("*").eq("video_id", vid).order("position"),
    supabase.from("yt_variants").select("id,kind,value,image_url,thumb_text,focal,archived,position").eq("video_id", vid),
    supabase.from("yt_shots").select("id,section_id,para_hash,kind,duration_s,position,matches_thumbnail,description").eq("video_id", vid),
    supabase.from("yt_moments").select("*").eq("video_id", vid).order("at"),
  ]);
  const sections = orderSections((secRes.data ?? []) as YtSection[]);
  const cardsRaw = (cardRes.data ?? []) as YtCard[];
  const buckets = new Map(((bucketRes.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const noteIds = [...new Set(cardsRaw.map((c) => c.note_id).filter((x): x is string => !!x))];
  const { data: notes } = noteIds.length ? await supabase.from("notes").select("id,title").in("id", noteIds) : { data: [] as { id: string; title: string }[] };
  const noteTitle = new Map((notes ?? []).map((n) => [n.id as string, n.title as string]));
  const cards: ScriptCard[] = cardsRaw.map((c) => ({ ...c, bucket: buckets.get(c.bucket_id) ?? "Research", noteTitle: c.note_id ? noteTitle.get(c.note_id) ?? null : null }));

  // Pinned pair: the primary pair → else the first pair → else the first title / thumbnail concept.
  const variants = ((varRes.data ?? []) as Pick<YtVariant, "id" | "kind" | "value" | "image_url" | "thumb_text" | "focal" | "archived" | "position">[]).sort((a, b) => a.position - b.position);
  const pairs = (pairRes.data ?? []) as YtPair[];
  const pair = pairs.find((p) => p.is_primary) ?? pairs[0] ?? null;
  const byId = (vId: string | null) => (vId ? variants.find((v) => v.id === vId) ?? null : null);
  const t = byId(pair?.title_id ?? null) ?? variants.find((v) => v.kind === "title" && !v.archived) ?? null;
  const th = byId(pair?.thumbnail_id ?? null) ?? variants.find((v) => v.kind === "thumbnail" && !v.archived) ?? null;
  const pinned: PinnedPair = {
    label: pair?.label ?? null,
    primary: !!pair?.is_primary,
    title: t?.value ?? null,
    thumbnail: th ? { concept: th.value, image: th.image_url, text: th.thumb_text, focal: th.focal } : null,
  };

  // Notes still exist? (an export whose note was deleted can't be updated)
  const exportsRaw = (expRes.data ?? []) as YtScriptExport[];
  const expNoteIds = exportsRaw.map((e) => e.note_id).filter((x): x is string => !!x);
  const { data: alive } = expNoteIds.length ? await supabase.from("notes").select("id").in("id", expNoteIds).is("deleted_at", null) : { data: [] as { id: string }[] };
  const aliveSet = new Set((alive ?? []).map((n) => n.id as string));
  const exports = exportsRaw.map((e) => ({ ...e, alive: !!e.note_id && aliveSet.has(e.note_id) }));

  return (
    <ScriptWorkspace
      video={{ id: vid, code: video.code, idea_name: video.idea_name, kind: video.kind, formats: video.formats ?? [], outline_template: video.outline_template, locked: !!video.outline_locked_at }}
      sections={sections}
      templates={(tplRes.data ?? []) as YtOutlineTemplate[]}
      cards={cards}
      exports={exports}
      pinned={pinned}
      shots={(shotRes.data ?? []) as Pick<YtShot, "id" | "section_id" | "para_hash" | "kind" | "duration_s" | "position" | "matches_thumbnail" | "description">[]}
      moments={(momRes.data ?? []) as YtMoment[]}
      wpm={settings?.words_per_min || DEFAULT_WORDS_PER_MIN}
      aiReady={hasAi()}
    />
  );
}
