import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/paths";

export default function robots(): MetadataRoute.Robots {
  if (process.env.ROBOTS_NOINDEX === "1") return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/"] }, sitemap: `${siteUrl()}/sitemap.xml` };
}
