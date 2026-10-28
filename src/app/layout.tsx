import type { Metadata } from "next";
import "./globals.css";
import ServiceWorker from "@/components/ServiceWorker";
import RecoverStale from "@/components/RecoverStale";
import NowTint from "@/components/calendar/NowTint";
import AppShell from "@/components/shell/AppShell";
import { themeScript } from "@/components/ui/ThemeToggle";

export const metadata: Metadata = {
  title: "Personal OS",
  description: "My personal operating system",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Personal OS", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1117" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies light/dark before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
        <NowTint />
        <ServiceWorker />
        <RecoverStale />
      </body>
    </html>
  );
}
