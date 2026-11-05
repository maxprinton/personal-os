// Server only — AES-256-GCM encryption of Google tokens before they are stored in yt_oauth.
// Key: YT_TOKEN_KEY (Vercel). Any long random text works; it is turned into 32 bytes with SHA-256.
// A 44-character base64 text of 32 bytes (openssl rand -base64 32) is used as is.
// Format: "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>". Changing the key = reconnect Google.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function tokenKey(secret = process.env.YT_TOKEN_KEY): Buffer | null {
  const s = secret?.trim();
  if (!s || s.length < 16) return null;
  if (/^[A-Za-z0-9+/]{43}=$/.test(s)) {
    const b = Buffer.from(s, "base64");
    if (b.length === 32) return b;
  }
  return createHash("sha256").update(s, "utf8").digest();
}

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** null when the text is not ours or the key is wrong (tampered / key changed). */
export function decryptToken(enc: string | null | undefined, key: Buffer): string | null {
  if (!enc) return null;
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
