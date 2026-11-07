"use server";
// Portfolio add-on — publish actions (preview, publish / update, unpublish, restore, history). Each returns plain data for the dialog.
import { revalidatePath } from "next/cache";
import { BASE, LANGS, type Lang } from "@/lib/portfolio/constants";
import { highlightWords } from "@/lib/portfolio/publish/check";
import { history, publish, rollback, stage, unpublish, type Affected } from "@/lib/portfolio/publish/engine";
import { publishDeps } from "@/lib/portfolio/publish/deps";
import { notifySite } from "@/lib/portfolio/publish/notify";
import type { HistoryReply, PreviewReply, PublishReply, SimpleReply } from "@/lib/portfolio/publish/preview";
import { loadSite } from "@/lib/portfolio/site";

const okLang = (l: string): l is Lang => (LANGS as readonly string[]).includes(l);
const okId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const bad = { ok: false as const, error: "Something is wrong with that request." };
const fresh = (slotId: string) => {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/pages`);
  revalidatePath(`${BASE}/pages/${slotId}`);
};
const tell = async (a: Affected) => {
  const r = await notifySite([a]);
  return r.skipped ? ("skipped" as const) : r.ok ? ("updated" as const) : ("failed" as const);
};
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export async function previewAction(slotId: string, lang: string): Promise<PreviewReply> {
  if (!okId(slotId) || !okLang(lang)) return bad;
  try {
    const d = await publishDeps();
    if (!d.ok) return d;
    const b = await stage(d.deps, slotId, lang);
    if (!b.snapshot) return { ok: false, error: b.warnings.find((w) => w.level === "error")?.message ?? "Nothing to preview.", warnings: b.warnings };
    const [{ site }, live] = await Promise.all([
      loadSite(d.deps.db, d.deps.userId),
      d.deps.db.from("portfolio_pages").select("is_live").eq("user_id", d.deps.userId).eq("slot_id", slotId).eq("lang", lang).maybeSingle(),
    ]);
    const s = b.snapshot;
    return {
      ok: true,
      preview: {
        title: s.title,
        path: s.path,
        hash: s.source_hash,
        html: highlightWords(s.body_html, site.blocked_words ?? []),
        summary: s.summary,
        icon: s.icon,
        cover: s.cover_url,
        readingMinutes: s.reading_minutes,
        warnings: b.warnings,
        blocked: b.blocked,
        needsConfirm: b.needsConfirm,
        live: !!(live.data as { is_live?: boolean } | null)?.is_live,
        nextVersion: (b.version ?? 1),
      },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function publishAction(slotId: string, lang: string, confirm: boolean, expectHash: string): Promise<PublishReply> {
  if (!okId(slotId) || !okLang(lang)) return bad;
  try {
    const d = await publishDeps();
    if (!d.ok) return d;
    const r = await publish(d.deps, slotId, lang, { confirm, expectHash });
    if (!r.ok) return r;
    const site = await tell(r.affected);
    fresh(slotId);
    return { ok: true, version: r.version, path: r.path, site };
  } catch (e) {
    return fail(e);
  }
}

export async function unpublishAction(slotId: string, lang: string): Promise<SimpleReply> {
  if (!okId(slotId) || !okLang(lang)) return bad;
  try {
    const d = await publishDeps();
    if (!d.ok) return d;
    const r = await unpublish(d.deps, slotId, lang);
    if (!r.ok) return r;
    const site = await tell(r.affected);
    fresh(slotId);
    return { ok: true, site };
  } catch (e) {
    return fail(e);
  }
}

export async function rollbackAction(slotId: string, lang: string, version: number): Promise<SimpleReply> {
  if (!okId(slotId) || !okLang(lang) || !Number.isInteger(version)) return bad;
  try {
    const d = await publishDeps();
    if (!d.ok) return d;
    const r = await rollback(d.deps, slotId, lang, version);
    if (!r.ok) return r;
    const site = await tell(r.affected);
    fresh(slotId);
    return { ok: true, site, note: `Restored as version ${r.version}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function historyAction(slotId: string, lang: string): Promise<HistoryReply> {
  if (!okId(slotId) || !okLang(lang)) return bad;
  try {
    const d = await publishDeps();
    if (!d.ok) return d;
    return { ok: true, items: await history(d.deps, slotId, lang, 10) };
  } catch (e) {
    return fail(e);
  }
}

