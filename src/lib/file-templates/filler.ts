// Template Manager, phase 3 — SERVER: reads an original file, works out its blanks (your saved map, or the scan's
// sure suggestions) and fills it from a project profile. Used by the copy and profile actions.
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET } from "./constants";
import { missingFields, resolveValues, snapshot, withAnswers, type ProfileData, type Values } from "./fields";
import { autoItems, fieldsUsed, mergeMap, type FillReport, type MapItem } from "./fill/common";
import { fillFile, fillKindOf, scanFile } from "./fill";
import type { CopyFill, Lang } from "./types";

export type SourceFile = { id: string; template_id: string; storage_path: string; file_name: string; mime: string | null; lang: Lang | null };

export async function downloadBytes(supabase: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("Could not read the original file.");
  return new Uint8Array(await data.arrayBuffer());
}

/** The blanks of one original file: your confirmed map, or the scan (only its sure suggestions are used to fill). */
export async function mapFor(supabase: SupabaseClient, userId: string, file: SourceFile, bytes?: Uint8Array): Promise<{ items: MapItem[]; confirmed: boolean; scanned: MapItem[] | null }> {
  if (!fillKindOf(file.file_name)) return { items: [], confirmed: false, scanned: null };
  const { data } = await supabase.from("tm_field_maps").select("items, confirmed").eq("file_id", file.id).eq("user_id", userId).maybeSingle();
  if (data?.confirmed) return { items: (data.items ?? []) as MapItem[], confirmed: true, scanned: null };
  const scanned = await scanFile(file.file_name, bytes ?? (await downloadBytes(supabase, file.storage_path)));
  const items = data ? mergeMap((data.items ?? []) as MapItem[], scanned) : scanned;
  return { items: data ? items.filter((it) => it.field) : autoItems(items), confirmed: false, scanned };
}

export type FillPlan = {
  kind: string | null;
  confirmed: boolean;
  /** Profile fields this file uses that have no value yet. */
  missing: string[];
  /** "Ask me each time" blanks: their labels. */
  asks: { key: string; label: string }[];
  blanks: number;
};

export function planFor(items: MapItem[], v: Values, kind: string | null, confirmed: boolean): FillPlan {
  const used = fieldsUsed(items);
  const asks = items
    .filter((it) => it.field?.startsWith("ask:"))
    .map((it) => ({ key: it.field!, label: it.label }))
    .filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i);
  return { kind, confirmed, missing: missingFields(used, v), asks, blanks: items.length };
}

/** Fills an original with a profile. `answers` = typed values (fields and "ask:" blanks); when `save` is true the
 *  field answers are also kept in the profile (the caller saves `profile`). */
export async function fillOriginal(
  supabase: SupabaseClient,
  userId: string,
  file: SourceFile,
  profile: ProfileData,
  opts: { lang: Lang; answers?: Record<string, string>; save?: boolean; version: number; today?: string }
): Promise<{ bytes: Uint8Array; fill: CopyFill; profile: ProfileData; changedProfile: boolean }> {
  const bytes = await downloadBytes(supabase, file.storage_path);
  const { items } = await mapFor(supabase, userId, file, bytes);
  const answers = opts.answers ?? {};
  const fieldAnswers = Object.fromEntries(Object.entries(answers).filter(([k]) => !k.startsWith("ask:")));
  const askAnswers = Object.fromEntries(Object.entries(answers).filter(([k]) => k.startsWith("ask:")));
  const merged = Object.keys(fieldAnswers).length ? withAnswers(profile, opts.lang, fieldAnswers) : profile;
  const kept = opts.save ? merged : profile;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const v = resolveValues(merged, opts.lang, { today, version: `${opts.version}.0`, answers: askAnswers });
  const report: FillReport = { filled: 0, skipped: [] };
  const out = items.length ? await fillFile(file.file_name, bytes, items, v, report) : bytes;
  const snap = snapshot(resolveValues(kept, opts.lang), fieldsUsed(items).filter((k) => !k.startsWith("ask:")));
  return {
    bytes: out,
    fill: { lang: opts.lang, snapshot: snap, filled: report.filled, skipped: report.skipped.slice(0, 30), version: opts.version, answers: Object.fromEntries(Object.entries(askAnswers).map(([k, x]) => [k, String(x).slice(0, 2000)])) },
    profile: kept,
    changedProfile: !!opts.save && Object.keys(fieldAnswers).length > 0,
  };
}
