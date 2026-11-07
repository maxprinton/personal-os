// The OS calls this after publishing / unpublishing so the pages refresh at once (the site also refreshes itself hourly).
// The request must be signed with PORTFOLIO_REVALIDATE_SECRET (HMAC of the body + a timestamp, 5 minutes tolerance).
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { SIGNATURE_HEADER, verifySignature } from "../../../lib/sign";
import { isLang } from "../../../lib/i18n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 20_000;

export async function POST(req: Request) {
  const secret = process.env.PORTFOLIO_REVALIDATE_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const body = await req.text();
  if (body.length > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const v = verifySignature(secret, body, req.headers.get(SIGNATURE_HEADER));
  if (!v.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let items: unknown;
  try {
    items = (JSON.parse(body) as { items?: unknown }).items;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length > 20) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const langs = new Set<string>();
  for (const it of items as { lang?: unknown }[]) if (typeof it?.lang === "string" && isLang(it.lang)) langs.add(it.lang);
  // the menu, the "Now" card and the lists show on every page of a language, so refresh the whole language
  for (const l of langs) revalidatePath(`/${l}`, "layout");
  revalidatePath("/sitemap.xml");
  return NextResponse.json({ revalidated: [...langs] });
}
