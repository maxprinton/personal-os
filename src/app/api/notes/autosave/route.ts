// Last-moment save of a note when you leave or reload the page (sent with fetch keepalive by NoteEditor).
// Same rules as the autosaveNote server action; the row is protected by RLS (only your notes).
import { NextResponse } from "next/server";
import { autosaveNote } from "@/app/note-actions";

export async function POST(req: Request) {
  let body: { id?: unknown; title?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof body.id !== "string" || typeof body.content !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await autosaveNote({ id: body.id, title: typeof body.title === "string" ? body.title : "", content: body.content });
  return NextResponse.json(r, { status: r.error ? 400 : 200 });
}
