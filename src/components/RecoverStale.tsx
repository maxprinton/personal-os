"use client";

import { useEffect } from "react";
import { isStaleBuildError, reloadOnce } from "@/lib/recover";

/**
 * After a new version is published, a tab that was already open may fail to load a piece of the app.
 * Instead of crashing later, it reloads itself (once) and gets the new version.
 */
export default function RecoverStale() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isStaleBuildError(e.error ?? e.message)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isStaleBuildError(e.reason)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
