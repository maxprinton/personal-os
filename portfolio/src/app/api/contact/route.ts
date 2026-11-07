// Contact form endpoint of the public site. All the logic is in lib/contact.ts.
import { NextResponse } from "next/server";
import { handleSiteContact } from "../../../lib/contact";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.text();
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const r = await handleSiteContact({ body, ip, origin: req.headers.get("origin"), host: req.headers.get("host") }, process.env);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
