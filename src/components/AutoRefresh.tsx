"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the server page so the "right now" banner stays current.
 * Every 5 minutes, and only while the tab is visible (a hidden tab costs server CPU and database
 * reads for nothing). When the tab comes back it refreshes once if it has been a while.
 */
export default function AutoRefresh({ seconds = 300 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      last = Date.now();
      router.refresh();
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, seconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= seconds * 1000) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);
  return null;
}
