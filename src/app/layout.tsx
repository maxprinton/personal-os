import type { Metadata } from "next";
import "./globals.css";
import ServiceWorker from "@/components/ServiceWorker";
import CalendarDock from "@/components/calendar/CalendarDock";

export const metadata: Metadata = {
  title: "Personal OS",
  description: "My personal operating system",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Personal OS", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport = { themeColor: "#171717" };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <CalendarDock />
        <ServiceWorker />
      </body>
    </html>
  );
}
