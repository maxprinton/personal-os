// RSS 2.0 feed builder (pure: no network, no database). Summary-only items, so readers send people to the site.
export type FeedItem = { title: string; link: string; pubDate: string | null; summary: string };
export type FeedInput = { title: string; description: string; lang: string; siteLink: string; selfLink: string; items: FeedItem[] };

// characters XML 1.0 does not allow
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(v: string): string {
  return v
    .replace(BAD_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const rfc822 = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
};

export function buildRss(f: FeedInput): string {
  const dates = f.items.map((i) => (i.pubDate ? new Date(i.pubDate).getTime() : NaN)).filter((n) => !Number.isNaN(n));
  const last = dates.length ? new Date(Math.max(...dates)).toUTCString() : null;
  const items = f.items
    .map((i) => {
      const date = rfc822(i.pubDate);
      return [
        "    <item>",
        `      <title>${escapeXml(i.title)}</title>`,
        `      <link>${escapeXml(i.link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(i.link)}</guid>`,
        date ? `      <pubDate>${date}</pubDate>` : "",
        `      <description>${escapeXml(i.summary)}</description>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(f.title)}</title>`,
    `    <link>${escapeXml(f.siteLink)}</link>`,
    `    <description>${escapeXml(f.description)}</description>`,
    `    <language>${escapeXml(f.lang)}</language>`,
    last ? `    <lastBuildDate>${last}</lastBuildDate>` : "",
    `    <atom:link href="${escapeXml(f.selfLink)}" rel="self" type="application/rss+xml"/>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
