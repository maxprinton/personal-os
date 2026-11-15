// The Coursera browser extension sends a lesson (reading or video transcript) here and it becomes a note.
// Public in the middleware: the personal clip key is the login (see lib/clip.ts).
import { NextResponse } from "next/server";
import { cleanTagList, clipUser, loadClipProperties, MAX_CLIP_CHARS, rehostMarkdownImages, resolveClipProps, tagNote } from "@/lib/clip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const who = await clipUser(request);
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  const { admin, userId } = who;

  let body: { title?: unknown; markdown?: unknown; tags?: unknown; props?: unknown; replace?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  const tags = cleanTagList(body.tags);
  if (!title || !markdown.trim()) return NextResponse.json({ error: "Nothing to save (empty title or text)." }, { status: 400 });
  if (markdown.length > MAX_CLIP_CHARS) return NextResponse.json({ error: "That page is too long to save." }, { status: 413 });

  // Same title already clipped? Ask before making a second copy.
  const { data: same } = await admin
    .from("notes")
    .select("id,props")
    .eq("user_id", userId)
    .eq("title", title)
    .eq("source", "web")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const existingId = (same?.[0]?.id as string | undefined) ?? null;
  const existingProps = (same?.[0]?.props as Record<string, unknown> | null | undefined) ?? {};
  if (existingId && body.replace !== true) return NextResponse.json({ duplicate: true, id: existingId }, { status: 409 });

  const props = resolveClipProps(await loadClipProperties(admin, userId), body.props);
  const imgs = await rehostMarkdownImages(admin, userId, markdown);

  let id = existingId;
  if (id) {
    const { error } = await admin.from("notes").update({ content: imgs.markdown, props: { ...existingProps, ...props }, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
    if (error) return NextResponse.json({ error: "Couldn't update the note." }, { status: 500 });
  } else {
    const { data, error } = await admin.from("notes").insert({ user_id: userId, title, content: imgs.markdown, source: "web", props }).select("id").single();
    if (error || !data) return NextResponse.json({ error: "Couldn't create the note." }, { status: 500 });
    id = data.id as string;
  }
  for (const t of tags) await tagNote(admin, userId, id, t);
  // "Last used" (migration 0070); harmless if the column is not there yet
  await admin.from("user_settings").update({ clip_last_used_at: new Date().toISOString() }).eq("user_id", userId);

  return NextResponse.json({ ok: true, id, replaced: Boolean(existingId), tags, images: { saved: imgs.saved, failed: imgs.failed } });
}
