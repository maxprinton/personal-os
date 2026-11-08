// Tests for saving web images into notes (npm run test:remote-image)
import { isPrivateIp, parseRemoteUrl, fileNameFor, fetchRemoteImage } from "@/lib/remote-image";
import { isRemoteImageSrc, isDataImageSrc, pendingImageSrcs } from "@/lib/editor/rehost";
import { Schema } from "@tiptap/pm/model";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) passed++; else { failed++; console.log("FAIL:", name, extra ?? ""); }
}

// private addresses
for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"]) check(`private ${ip}`, isPrivateIp(ip));
for (const ip of ["8.8.8.8", "13.224.0.1", "2606:4700::1111"]) check(`public ${ip}`, !isPrivateIp(ip));

// urls
check("https ok", !!parseRemoteUrl("https://d3c33hcgiwev3.cloudfront.net/a.png?expiry=1&hmac=2"));
check("ftp no", !parseRemoteUrl("ftp://x.com/a.png"));
check("file no", !parseRemoteUrl("file:///etc/passwd"));
check("localhost no", !parseRemoteUrl("http://localhost:3000/a.png"));
check("ip private no", !parseRemoteUrl("http://169.254.169.254/latest/meta-data"));
check("creds no", !parseRemoteUrl("https://user:pw@example.com/a.png"));
check("odd port no", !parseRemoteUrl("http://example.com:8080/a.png"));
check(".internal no", !parseRemoteUrl("http://db.internal/a.png"));

// names
check("name keeps ext", fileNameFor(new URL("https://x.com/p/iS9Zdse_C2M3L1R2-NEW.png?expiry=1"), "image/png") === "iS9Zdse_C2M3L1R2-NEW.png");
check("name adds ext", fileNameFor(new URL("https://x.com/p/photo"), "image/jpeg") === "photo.jpg");
check("name empty", fileNameFor(new URL("https://x.com/"), "image/webp") === "image.webp");

// fetch with a fake network
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const mk = (status: number, type: string, body: Uint8Array | null, headers: Record<string, string> = {}) =>
  (async () => new Response(body as BodyInit | null, { status, headers: { "content-type": type, ...headers } })) as unknown as typeof fetch;
let r = await fetchRemoteImage("https://8.8.8.8/a.png", mk(200, "image/png", png));
check("fetch ok", !("error" in r) && r.type === "image/png" && r.bytes.byteLength === 7 && r.name === "a.png", r);
r = await fetchRemoteImage("https://8.8.8.8/a.png", mk(403, "text/html", new Uint8Array([1])));
check("expired -> message", "error" in r && /expired/.test(r.error), r);
r = await fetchRemoteImage("https://8.8.8.8/a.png", mk(200, "text/html", new Uint8Array([1])));
check("html rejected", "error" in r && /picture/.test(r.error), r);
r = await fetchRemoteImage("https://8.8.8.8/a.svg", mk(200, "image/svg+xml", new Uint8Array([1])));
check("svg rejected", "error" in r, r);
r = await fetchRemoteImage("https://8.8.8.8/a.png", mk(200, "image/png", png, { "content-length": String(30 * 1024 * 1024) }));
check("too big", "error" in r && /25 MB/.test(r.error), r);
r = await fetchRemoteImage("http://127.0.0.1/a.png", mk(200, "image/png", png));
check("blocks private", "error" in r, r);
let hops = 0;
const redirectToPrivate = (async () => { hops++; return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } }); }) as unknown as typeof fetch;
r = await fetchRemoteImage("https://8.8.8.8/a.png", redirectToPrivate);
check("redirect to private blocked", "error" in r && hops === 1, r);
const loop = (async () => new Response(null, { status: 302, headers: { location: "https://8.8.4.4/b.png" } })) as unknown as typeof fetch;
r = await fetchRemoteImage("https://8.8.8.8/a.png", loop);
check("redirect loop stops", "error" in r, r);

// editor side
check("remote src", isRemoteImageSrc("https://a.com/x.png", "https://app.com"));
check("own src is not remote", !isRemoteImageSrc("https://app.com/x.png", "https://app.com"));
check("api link is not remote", !isRemoteImageSrc("/api/files/u/2026-11/a.png", "https://app.com"));
check("data src", isDataImageSrc("data:image/png;base64,AAAA"));
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    image: { group: "block", atom: true, attrs: { src: { default: "" } } },
  },
});
const doc = schema.node("doc", null, [
  schema.node("image", { src: "https://a.com/1.png" }),
  schema.node("image", { src: "https://a.com/1.png" }),
  schema.node("image", { src: "/api/files/u/x.png" }),
  schema.node("image", { src: "data:image/png;base64,AAAA" }),
  schema.node("image", { src: "https://a.com/done.png" }),
]);
const todo = pendingImageSrcs(doc, new Set(["https://a.com/done.png"]), "https://app.com");
check("pending: unique, skips own + tried", todo.length === 2 && todo.includes("https://a.com/1.png") && todo.includes("data:image/png;base64,AAAA"), todo);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
