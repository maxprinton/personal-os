// Saves a copy of an image that lives on another website (server side).
// Why: when you copy text + images from a web page and paste it into a note, the editor only gets a LINK to the
// image. Many sites (Coursera, Google, Notion…) give links that stop working after ~24 hours, so the image
// "disappeared" from the note. Here we download it once and the note keeps its own copy in note-files.
import { lookup } from "node:dns/promises";
import net from "node:net";

export const MAX_REMOTE_IMAGE = 25 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 20000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/bmp"]);
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp" };

/** True for addresses a public website should never be able to point us at (our own network, metadata servers…). */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe[89ab])/.test(v) || v.startsWith("ff");
  }
  return true;
}

/** Only plain http(s) links to a normal host name or public address, no passwords, standard ports. */
export function parseRemoteUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare) && isPrivateIp(bare)) return null;
  return u;
}

async function assertPublicHost(u: URL): Promise<boolean> {
  const bare = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) return !isPrivateIp(bare);
  try {
    const all = await lookup(bare, { all: true });
    return all.length > 0 && all.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

export function fileNameFor(u: URL, type: string): string {
  let last = "";
  try {
    last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    last = u.pathname.split("/").filter(Boolean).pop() ?? "";
  }
  const clean = last.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-60);
  const ext = EXT[type] ?? "png";
  if (!clean) return `image.${ext}`;
  return /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(clean) ? clean : `${clean}.${ext}`;
}

export type RemoteImage = { bytes: Uint8Array; type: string; name: string };

/** Downloads the image (follows a few redirects, checks every hop, size and type limits). */
export async function fetchRemoteImage(raw: string, fetchImpl: typeof fetch = fetch): Promise<RemoteImage | { error: string }> {
  const first = parseRemoteUrl(raw);
  if (!first) return { error: "That link can't be saved." };
  let u: URL = first;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await assertPublicHost(u))) return { error: "That link can't be saved." };
      const res: Response = await fetchImpl(u.toString(), {
        redirect: "manual",
        signal: ctl.signal,
        headers: { accept: "image/*,*/*;q=0.5", "user-agent": "Mozilla/5.0 (compatible; PersonalOS image saver)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc: string | null = res.headers.get("location");
        const next: URL | null = loc ? parseRemoteUrl(new URL(loc, u).toString()) : null;
        if (!next) return { error: "The image link redirects somewhere that can't be saved." };
        u = next;
        continue;
      }
      if (!res.ok) return { error: res.status === 403 || res.status === 401 || res.status === 410 ? "The link expired or is private." : `The site answered ${res.status}.` };
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!IMAGE_TYPES.has(type)) return { error: "That link isn't a picture." };
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_REMOTE_IMAGE) return { error: "The image is bigger than 25 MB." };
      const reader = res.body?.getReader();
      if (!reader) return { error: "Empty answer." };
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_REMOTE_IMAGE) {
          await reader.cancel();
          return { error: "The image is bigger than 25 MB." };
        }
        chunks.push(value);
      }
      if (!total) return { error: "Empty image." };
      const bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.byteLength;
      }
      return { bytes, type: type === "image/jpg" ? "image/jpeg" : type, name: fileNameFor(u, type) };
    }
    return { error: "Too many redirects." };
  } catch (e) {
    return { error: e instanceof Error && e.name === "AbortError" ? "The site took too long." : "Couldn't download the image." };
  } finally {
    clearTimeout(timer);
  }
}
