import type { NextConfig } from "next";

const build = (extra: { script?: string; frame?: string; connect?: string } = {}) => [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${extra.script ? ` ${extra.script}` : ""}`, // Next injects small inline scripts
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  `frame-src https://www.youtube-nocookie.com${extra.frame ? ` ${extra.frame}` : ""}`,
  `connect-src 'self'${extra.connect ? ` ${extra.connect}` : ""}`,
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const csp = build();
// Only the contact page may load the Turnstile check (Cloudflare). Every other page keeps the strict policy.
const contactCsp = build({ script: "https://challenges.cloudflare.com", frame: "https://challenges.cloudflare.com", connect: "https://challenges.cloudflare.com" });

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/:lang(en|es)/contact", headers: [{ key: "Content-Security-Policy", value: contactCsp }] },
    ];
  },
};

export default nextConfig;
