// Pure parts of the web clipper: key hashing, template → props, tag list, image identity, image rehosting (fake storage).
import assert from "node:assert/strict";
import { cleanTagList, generateClipKey, hashClipKey, imageIdentity, rehostMarkdownImages, resolveClipProps, type ClipProperty } from "@/lib/clip";

let n = 0;
const t = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve(fn()).then(() => {
    n++;
    console.log("ok", name);
  });

const props: ClipProperty[] = [
  { id: "P-type", key: "type", name: "Type", type: "select", config: { options: [{ id: "aprendizaje", name: "Aprendizaje" }, { id: "idea", name: "Idea" }] } },
  { id: "P-status", key: "status", name: "Status", type: "status", config: { options: [{ id: "inbox", name: "Inbox" }] } },
  { id: "P-source", key: "source", name: "Source", type: "url", config: {} },
  { id: "P-fav", key: "favorite", name: "Favorite", type: "checkbox", config: {} },
  { id: "P-rev", key: "review_on", name: "Review on", type: "date", config: {} },
  { id: "P-multi", key: "p_x", name: "Skills", type: "multi_select", config: { options: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] } },
  { id: "P-rel", key: "related", name: "Related notes", type: "relation", config: {} },
];

(async () => {
  await t("keys", () => {
    const k = generateClipKey();
    assert.ok(k.startsWith("posclip_") && k.length > 30);
    assert.equal(hashClipKey(k), hashClipKey(`  ${k} `));
    assert.notEqual(hashClipKey(k), hashClipKey(generateClipKey()));
  });
  await t("select by name or id, any case", () => {
    assert.deepEqual(resolveClipProps(props, { type: "aprendizaje" }), { "P-type": "aprendizaje" });
    assert.deepEqual(resolveClipProps(props, { Type: "APRENDIZAJE" }), { "P-type": "aprendizaje" });
    assert.deepEqual(resolveClipProps(props, { type: "Idea", status: "Inbox" }), { "P-type": "idea", "P-status": "inbox" });
  });
  await t("unknown option, unknown key and computed types are skipped", () => {
    assert.deepEqual(resolveClipProps(props, { type: "nope", zzz: "x", related: "y" }), {});
    assert.deepEqual(resolveClipProps(props, null), {});
    assert.deepEqual(resolveClipProps(props, ["type"]), {});
  });
  await t("url, checkbox, date, multi-select", () => {
    assert.deepEqual(resolveClipProps(props, { source: " https://x.org/a " }), { "P-source": "https://x.org/a" });
    assert.deepEqual(resolveClipProps(props, { favorite: true }), { "P-fav": true });
    assert.deepEqual(resolveClipProps(props, { favorite: false }), {});
    assert.deepEqual(resolveClipProps(props, { review_on: "2026-12-01" }), { "P-rev": { start: "2026-12-01" } });
    assert.deepEqual(resolveClipProps(props, { review_on: "tomorrow" }), {});
    assert.deepEqual(resolveClipProps(props, { Skills: ["alpha", "Beta", "alpha", "zzz"] }), { "P-multi": ["a", "b"] });
  });
  await t("tag list", () => {
    assert.deepEqual(cleanTagList(["#roles", "Roles", " pm ", ""]), ["roles", "pm"]);
    assert.deepEqual(cleanTagList("a, b,#c"), ["a", "b", "c"]);
    assert.equal(cleanTagList(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 12);
    assert.deepEqual(cleanTagList(undefined), []);
  });
  await t("image identity ignores expiry/hmac", () => {
    assert.equal(imageIdentity("https://d3.cloudfront.net/a/b.png?expiry=1&hmac=x"), imageIdentity("https://d3.cloudfront.net/a/b.png?expiry=2&hmac=y"));
  });
  await t("rehost: duplicates saved once, failures keep their link", async () => {
    const uploads: string[] = [];
    const admin = { storage: { from: () => ({ upload: async (path: string) => (uploads.push(path), { error: null }) }) } } as never;
    // 8.8.8.8 style public IPs avoid DNS in the test
    const ok = "https://8.8.8.8/img/one.png";
    const bad = "https://8.8.4.4/img/two.png";
    const fake = (async (u: string) =>
      u.startsWith(ok) ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }) : new Response("", { status: 410 })) as unknown as typeof fetch;
    const md = `a\n\n![x](${ok}?expiry=1)\n\n![](${ok}?expiry=2)\n\n![y](${bad}?e=1)\n`;
    const r = await rehostMarkdownImages(admin, "U1", md, fake);
    assert.equal(r.saved, 1);
    assert.equal(r.failed, 1);
    assert.equal(uploads.length, 1);
    assert.ok(uploads[0].startsWith("U1/"));
    assert.equal((r.markdown.match(/\/api\/files\/U1\//g) ?? []).length, 2);
    assert.ok(r.markdown.includes(`${bad}?e=1`));
  });
  console.log(`\n${n} clip tests passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
