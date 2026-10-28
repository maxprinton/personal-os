"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import ErrorScreen from "@/components/ErrorScreen";

/** Any page that breaks shows this inside the app (sidebar and tabs keep working). */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const retry = () =>
    startTransition(() => {
      router.refresh(); // fetch the page again from the server…
      reset(); // …and draw it again
    });
  return <ErrorScreen error={error} retry={retry} />;
}
