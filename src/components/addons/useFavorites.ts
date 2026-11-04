"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddonFavorites, saveAddonFavorites } from "@/app/addon-actions";
import { cleanFavorites, DEFAULT_FAVORITES, toggleFavorite } from "@/lib/addons/registry";

const KEY = "pos-addon-favorites-v1";
const EVENT = "pos-addon-favorites";

function readLocal(): string[] | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? cleanFavorites(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // storage blocked: the database copy (if any) is still used
  }
}

let loaded: Promise<void> | null = null;

/**
 * The add-ons pinned to the main menu. Saved in the database (migration 0030) and cached in the browser so the
 * menu draws instantly; without the migration only the browser remembers them. Every open copy (sidebar, phone
 * menu, library) stays in sync through a window event.
 */
export function useAddonFavorites() {
  const [favorites, setFavorites] = useState<string[]>(DEFAULT_FAVORITES);

  useEffect(() => {
    const local = readLocal();
    if (local) setFavorites(local);
    const onChange = (e: Event) => setFavorites((e as CustomEvent<string[]>).detail);
    window.addEventListener(EVENT, onChange);
    if (!loaded) {
      loaded = getAddonFavorites()
        .then((r) => {
          if (!r.stored) return;
          writeLocal(r.favorites);
          window.dispatchEvent(new CustomEvent(EVENT, { detail: r.favorites }));
        })
        .catch(() => {});
    }
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  /** Pin/unpin. Returns false (and changes nothing) when the menu is already full. */
  const toggle = useCallback(
    (id: string) => {
      const next = toggleFavorite(favorites, id);
      if (!next) return false;
      writeLocal(next);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
      saveAddonFavorites(next).catch(() => {});
      return true;
    },
    [favorites],
  );

  return { favorites, toggle };
}
