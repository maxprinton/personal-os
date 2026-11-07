// Portfolio contact form — what the OS does with a message the public site forwarded: check it, rate-limit it, score it for spam,
// save it to the inbox and tell the owner. Pure logic + injected database / notifier, so it is tested without network.
import type { SupabaseClient } from "@supabase/supabase-js";
import { SIGNATURE_HEADER, verifySignature } from "./sign";
import { validateContact, type ContactInput } from "./contact-validate";

export const SPAM_THRESHOLD = 3;
export const LIMITS = { perIpPerHour: 3, perDay: 100, bodyBytes: 20_000 } as const;

/** What the site sends (already signed). `ip_hash` is a hash made on the site; the OS never sees an IP address. */
export type Forwarded = ContactInput & { ip_hash: string; fast?: boolean };

const SPAM_WORDS = /\b(casino|viagra|cialis|forex|crypto|bitcoin|backlinks?|seo (services?|expert|ranking)|rank #?1|loans?|lottery|porn|escort|click here|buy now|free money|earn \$|guaranteed (results|income)|make money|investment opportunity|whatsapp me|telegram me)\b/gi;

export type SpamResult = { score: number; reasons: string[] };
export function spamScore(m: ContactInput, flags: { fast?: boolean; duplicate?: boolean } = {}): SpamResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => ((score += n), reasons.push(why));
  const links = (m.message.match(/https?:\/\/|www\./gi) ?? []).length;
  if (links >= 3) add(3, "many links");
  else if (links === 2) add(2, "two links");
  else if (links === 1) add(1, "a link");
  if (/<a\s|<\/a>|\[url=|\[link=/i.test(m.message)) add(2, "link markup");
  const words = new Set((m.message.match(SPAM_WORDS) ?? []).map((w) => w.toLowerCase()));
  if (words.size) add(Math.min(4, words.size * 2), "spam words");
  const letters = m.message.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  if (letters.length > 20 && letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length / letters.length > 0.6) add(1, "shouting");
  if (/(.)\1{9,}/.test(m.message)) add(2, "repeated characters");
  if (/https?:\/\/|www\./i.test(m.name)) add(2, "link in the name");
  if (flags.fast) add(2, "sent too fast");
  if (flags.duplicate) add(3, "same message again");
  return { score, reasons };
}

export function telegramText(m: { name: string; email: string; message: string }): string {
  const first = m.message.length > 400 ? m.message.slice(0, 399).trimEnd() + "…" : m.message;
  return `📨 New message from your website\nFrom: ${m.name || "(no name)"} <${m.email}>\n\n${first}\n\nOpen: Portfolio → Inbox`;
}

export type ContactDeps = {
  db: SupabaseClient;
  now?: () => Date;
  /** tells the owner (Telegram). Never allowed to fail the request. */
  notify?: (userId: string, text: string) => Promise<void>;
  secret: string | undefined;
};
export type ContactReply = { status: number; body: { ok?: true; error?: string } };
const reply = (status: number, error?: string): ContactReply => ({ status, body: error ? { error } : { ok: true } });

/** One request: verifies the signature, saves the message. Spam is saved too (in its own tab) but never pings the owner. */
export async function handleContact(d: ContactDeps, rawBody: string, headers: { get(name: string): string | null }): Promise<ContactReply> {
  if (!d.secret) return reply(503, "Not configured");
  if (rawBody.length > LIMITS.bodyBytes) return reply(413, "Too large");
  if (!verifySignature(d.secret, rawBody, headers.get(SIGNATURE_HEADER), (d.now?.() ?? new Date()).getTime()).ok) return reply(401, "Unauthorized");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return reply(400, "Bad request");
  }
  const p = parsed as Partial<Forwarded>;
  const v = validateContact(p);
  const ip = typeof p.ip_hash === "string" && /^[0-9a-f]{16,64}$/.test(p.ip_hash) ? p.ip_hash : null;
  if (!v.ok || !ip) return reply(400, "Bad request");

  const now = d.now?.() ?? new Date();
  const iso = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const owner = (await d.db.from("portfolio_site").select("user_id").limit(1).maybeSingle()).data as { user_id: string } | null;
  if (!owner) return reply(503, "Not set up");

  // rate limits (counted before this request is added)
  const [{ count: perIp }, { count: perDay }] = await Promise.all([
    d.db.from("portfolio_contact_hits").select("ip_hash", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", iso(3_600_000)),
    d.db.from("portfolio_contact_hits").select("ip_hash", { count: "exact", head: true }).gte("created_at", iso(86_400_000)),
  ]);
  if ((perIp ?? 0) >= LIMITS.perIpPerHour || (perDay ?? 0) >= LIMITS.perDay) return reply(429, "Too many messages");
  await d.db.from("portfolio_contact_hits").insert({ ip_hash: ip, created_at: now.toISOString() });
  // housekeeping: counters older than two days are of no use
  await d.db.from("portfolio_contact_hits").delete().lt("created_at", iso(2 * 86_400_000));

  const dup = (await d.db.from("portfolio_inbox").select("id").eq("user_id", owner.user_id).eq("message", v.value.message).gte("created_at", iso(86_400_000)).limit(1)).data as unknown[] | null;
  const s = spamScore(v.value, { fast: p.fast === true, duplicate: !!dup?.length });
  const spam = s.score >= SPAM_THRESHOLD;
  const { error } = await d.db.from("portfolio_inbox").insert({
    user_id: owner.user_id,
    name: v.value.name || null,
    email: v.value.email,
    message: v.value.message,
    lang: v.value.lang,
    ip_hash: ip,
    spam_score: s.score,
    spam,
    created_at: now.toISOString(),
  });
  if (error) return reply(500, "Could not save");
  if (!spam && d.notify) {
    try {
      await d.notify(owner.user_id, telegramText(v.value));
    } catch {
      /* the message is saved; the ping is a bonus */
    }
  }
  return reply(200);
}
