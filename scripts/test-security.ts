// Public site, Phase 3: security checks. Headers, the signed revalidate endpoint, hostile HTML, what the site is allowed to
// read from the database, and that nothing private leaks into the public project. Nothing is sent.
// Run: npm run test:security
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nextConfig from "../portfolio/next.config";
import { POST } from "../portfolio/src/app/api/revalidate/route";
import { signBody, verifySignature } from "@/lib/portfolio/sign";
import { sanitizeHtml } from "@/lib/portfolio/publish/sanitize";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`❌ ${name}${extra ? `  [${extra}]` : ""}`);
  }
}
const root = fileURLToPath(new URL("../", import.meta.url));
function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === ".next") continue;
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

// ——— headers ———
{
  const groups = await nextConfig.headers!();
  const h = Object.fromEntries(groups[0].headers.map((x) => [x.key, x.value]));
  const csp = h["Content-Security-Policy"];
  ok("CSP: only self by default", /default-src 'self'/.test(csp));
  ok("CSP: frames only from YouTube privacy mode", /frame-src https:\/\/www\.youtube-nocookie\.com(;|$)/.test(csp));
  ok("CSP: nobody can frame the site, no plugins, fixed base", /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp));
  const contact = groups.find((g) => g.source.includes("contact"));
  const ccsp = contact?.headers.find((x) => x.key === "Content-Security-Policy")?.value ?? "";
  ok("CSP: the strict policy has no Cloudflare anywhere", !/cloudflare/.test(csp));
  ok("CSP: only the contact page may load Turnstile, nothing else widened", /challenges\.cloudflare\.com/.test(ccsp) && ccsp.replace(/ https:\/\/challenges\.cloudflare\.com/g, "") === csp, ccsp);
  ok("CSP: no wildcard sources", !/\*/.test(csp) && !/script-src[^;]*https:/.test(csp));
  ok("nosniff, referrer, HSTS, no-frame, permissions", h["X-Content-Type-Options"] === "nosniff" && !!h["Referrer-Policy"] && /max-age=\d{7,}/.test(h["Strict-Transport-Security"]) && h["X-Frame-Options"] === "DENY" && /camera=\(\)/.test(h["Permissions-Policy"]));
  ok("no X-Powered-By", nextConfig.poweredByHeader === false);
}

// ——— the signed revalidate endpoint ———
{
  const SECRET = "test-secret-123";
  const call = (body: string, sig: string | null, secret: string | null = SECRET) => {
    if (secret === null) delete process.env.PORTFOLIO_REVALIDATE_SECRET;
    else process.env.PORTFOLIO_REVALIDATE_SECRET = secret;
    return POST(new Request("https://site.test/api/revalidate", { method: "POST", body, headers: sig ? { "x-portfolio-signature": sig } : {} }));
  };
  const body = JSON.stringify({ items: [{ lang: "en", paths: ["/"] }] });
  ok("revalidate: no secret configured → 503", (await call(body, signBody(SECRET, body), null)).status === 503);
  ok("revalidate: no signature → 401", (await call(body, null)).status === 401);
  ok("revalidate: wrong secret → 401", (await call(body, signBody("other", body))).status === 401);
  ok("revalidate: body changed after signing → 401", (await call(body + " ", signBody(SECRET, body))).status === 401);
  ok("revalidate: old signature (replay) → 401", (await call(body, signBody(SECRET, body, Date.now() - 10 * 60_000))).status === 401);
  ok("revalidate: future signature → 401", (await call(body, signBody(SECRET, body, Date.now() + 10 * 60_000))).status === 401);
  ok("revalidate: garbage header → 401", (await call(body, "t=1,v1=zz")).status === 401);
  const big = JSON.stringify({ items: [], pad: "x".repeat(25_000) });
  ok("revalidate: huge body → 413", (await call(big, signBody(SECRET, big))).status === 413);
  const bad = "not json";
  ok("revalidate: signed but not JSON → 400", (await call(bad, signBody(SECRET, bad))).status === 400);
  const many = JSON.stringify({ items: Array.from({ length: 30 }, () => ({ lang: "en" })) });
  ok("revalidate: too many items → 400", (await call(many, signBody(SECRET, many))).status === 400);
  const wrong = JSON.stringify({ items: "x" });
  ok("revalidate: wrong shape → 400", (await call(wrong, signBody(SECRET, wrong))).status === 400);
  // a valid call gets past every check; outside Next's server the refresh itself can't run, so it errors there (not 401/4xx)
  let status = 0;
  try {
    status = (await call(body, signBody(SECRET, body))).status;
  } catch {
    status = 500;
  }
  ok("revalidate: a valid signed call passes the checks", status === 200 || status === 500);
  ok("signature round trip", verifySignature(SECRET, body, signBody(SECRET, body)).ok);
}

// ——— hostile HTML (the site cleans it again at display) ———
{
  const attacks = [
    `<img src=x onerror=alert(1)>`,
    `<svg onload=alert(1)><script>alert(1)</script></svg>`,
    `<a href="jav&#x09;ascript:alert(1)">x</a>`,
    `<a href="&#106;avascript:alert(1)">x</a>`,
    `<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>`,
    `<iframe src="javascript:alert(1)"></iframe>`,
    `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>`,
    `<iframe src="https://www.youtube-nocookie.com.evil.com/embed/dQw4w9WgXcQ"></iframe>`,
    `<object data="x"></object><embed src="x">`,
    `<form action="https://evil.test"><input></form>`,
    `<p style="background:url(javascript:alert(1))">x</p>`,
    `<p style="position:fixed;top:0;left:0;width:100%;height:100%">x</p>`,
    `<meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test/">`,
    `<math><mi xlink:href="javascript:alert(1)">x</mi></math>`,
    `<div onclick="x()" onmouseover="y()">x</div>`,
    `<scr<script>ipt>alert(1)</scr</script>ipt>`,
    `<a href="//evil.test/x">x</a>`,
  ];
  for (const a of attacks) {
    const out = sanitizeHtml(a).html;
    const bad = /<script|<svg|<math|<object|<embed|<form|<meta|<base|onerror|onload|onclick|onmouseover|javascript:|data:text|href="\/\/|position:|<iframe(?![^>]*youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}")/i.test(out);
    ok(`attack neutralised: ${a.slice(0, 50)}`, !bad, out);
  }
  ok("a real YouTube privacy embed survives", sanitizeHtml('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>').html.includes("<iframe"));
}

// ——— what the public project may read and hold ———
{
  const files = walk(join(root, "portfolio")).filter((f) => /\.(ts|tsx|json|mjs|css|md|example)$/.test(f) && !/package-lock|tsbuildinfo/.test(f));
  const allText = files.map((f) => [f, readFileSync(f, "utf8")] as const);
  const data = readFileSync(join(root, "portfolio/src/lib/data.ts"), "utf8");
  ok("site reads only public columns (no *, no private columns)", !/select\(\s*["'`]\*/.test(data) && !/blocked_words|yt_video_id|user_id|previous_keys/.test(data.replace(/\/\/.*$/gm, "")));
  const tables = [...data.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  ok("site touches only the public tables", tables.length > 0 && tables.every((t) => ["portfolio_pages", "portfolio_site", "portfolio_videos"].includes(t)), [...new Set(tables)].join());
  ok("no service key in the public project", !allText.some(([f, t]) => /SUPABASE_SECRET_KEY|service_role|SERVICE_ROLE/.test(t) && !/\.md$/.test(f)));
  ok("no private OS code imported", !allText.some(([f, t]) => /\.(ts|tsx)$/.test(f) && /from\s+["'](\.\.\/)+src\/|from\s+["']@\//.test(t) && !/lib\/sign|lib\/sanitize/.test(t)), allText.filter(([, t]) => /from\s+["']@\//.test(t)).map(([f]) => f).join());
  ok("no secrets written into files", !allText.some(([, t]) => /eyJ[A-Za-z0-9_-]{30,}|sk_live|AKIA[0-9A-Z]{12}/.test(t)));
  const pkg = JSON.parse(readFileSync(join(root, "portfolio/package.json"), "utf8"));
  ok("site dependencies are small and expected", Object.keys(pkg.dependencies).sort().join() === "@fontsource/source-serif-4,@supabase/supabase-js,katex,next,react,react-dom");
  ok("dangerouslySetInnerHTML only with sanitized or JSON-LD content", allText.filter(([, t]) => /dangerouslySetInnerHTML/.test(t)).every(([f, t]) => /safeBody|jsonLd\(|JSON\.stringify/.test(t)));
  const searchPage = readFileSync(join(root, "portfolio/src/app/[lang]/search/page.tsx"), "utf8");
  const dataTs = readFileSync(join(root, "portfolio/src/lib/data.ts"), "utf8");
  ok("search: query is cleaned before it reaches the database", /cleanQuery\(/.test(searchPage) && /termsOf\(cleanQuery\(q\)\)/.test(dataTs));
  ok("search: page is never indexed and is not cached", /index:\s*false/.test(searchPage) && /force-dynamic/.test(searchPage));
  ok("rss: GET only", !/export async function (POST|PUT|DELETE|PATCH)/.test(readFileSync(join(root, "portfolio/src/app/[lang]/rss.xml/route.ts"), "utf8")));
  ok(".env.example has no values", !/=\s*\S*eyJ/.test(readFileSync(join(root, "portfolio/.env.example"), "utf8")));
}

console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
