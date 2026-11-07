// Fallback for addresses that match nothing (no language in them). Pages inside /en and /es get their own 404.
import Link from "next/link";

export const metadata = { title: "Not found", robots: { index: false } };

export default function NotFound() {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#17302a", color: "#f1efe6", padding: 40 }}>
        <h1>404</h1>
        <p>That page does not exist · Esa página no existe.</p>
        <p>
          <Link href="/en" style={{ color: "#f4d35e" }}>
            English
          </Link>{" "}
          ·{" "}
          <Link href="/es" style={{ color: "#f4d35e" }}>
            Español
          </Link>
        </p>
      </body>
    </html>
  );
}
