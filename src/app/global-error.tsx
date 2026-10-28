"use client";

import "./globals.css";
import ErrorScreen from "@/components/ErrorScreen";
import { themeScript } from "@/components/ui/ThemeToggle";

/** Last line of defence: the app frame itself failed. Replaces Next.js's bare "Application error" line. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Personal OS · Something went wrong</title>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ErrorScreen error={error} retry={reset} whole />
      </body>
    </html>
  );
}
