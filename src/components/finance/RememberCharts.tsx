"use client";

// BL-122: remembers the last dates/months you chose on Finance → Charts (in this browser only).
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const KEY = "pos-finance-charts";

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    try {
      if (sp.has("reset")) {
        localStorage.removeItem(KEY);
        router.replace("/finance/charts");
      } else if (sp.toString()) {
        localStorage.setItem(KEY, sp.toString());
      } else {
        const saved = localStorage.getItem(KEY);
        if (saved && /^[\w=&%.\-]+$/.test(saved)) router.replace(`/finance/charts?${saved}`);
      }
    } catch {
      // storage can be blocked: the page just uses the defaults
    }
  }, [sp, router]);
  return null;
}

export default function RememberCharts() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
