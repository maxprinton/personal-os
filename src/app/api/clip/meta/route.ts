// What the clipper's template screen can offer: your tags and the properties a template may fill (with their options).
import { NextResponse } from "next/server";
import { clipUser, loadClipProperties, settableProperties } from "@/lib/clip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const who = await clipUser(request);
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  const { admin, userId } = who;
  const [props, tags] = await Promise.all([
    loadClipProperties(admin, userId),
    admin.from("tags").select("name,color").eq("user_id", userId).is("deleted_at", null).order("name"),
  ]);
  return NextResponse.json({
    properties: settableProperties(props).map((p) => ({ key: p.key, name: p.name, type: p.type, options: (p.config?.options ?? []).map((o) => ({ id: o.id, name: o.name })) })),
    tags: ((tags.data ?? []) as { name: string }[]).map((t) => t.name),
  });
}
