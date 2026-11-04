"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { readPref, writePref } from "@/components/calendar/util";
import { useAddonFavorites } from "@/components/addons/useFavorites";
import { ADDON_TYPES, ADDONS, MAX_FAVORITES, searchAddons, type Addon, type AddonType } from "@/lib/addons/registry";

type View = "grid" | "list" | "type";
const VIEWS: { id: View; label: string }[] = [
  { id: "grid", label: "Icons" },
  { id: "list", label: "List" },
  { id: "type", label: "By type" },
];

function StarButton({ on, onClick, name }: { on: boolean; onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={on}
      title={on ? `Unpin ${name} from the menu` : `Pin ${name} to the menu`}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
        on ? "text-warning-solid hover:bg-subtle" : "text-faint hover:bg-subtle hover:text-fg"
      }`}
    >
      <svg width={18} height={18} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" aria-hidden>
        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
      </svg>
    </button>
  );
}

function Tile({ a, fav, onStar }: { a: Addon; fav: boolean; onStar: () => void }) {
  return (
    <Link
      href={a.href}
      className="group relative flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface p-4 text-center shadow-card transition-colors hover:border-line-strong hover:bg-subtle"
    >
      <span className="absolute right-1.5 top-1.5">
        <StarButton on={fav} onClick={onStar} name={a.name} />
      </span>
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon name={a.icon} size={28} />
      </span>
      <span className="text-sm font-medium">{a.name}</span>
      <span className="text-[11px] text-faint">{ADDON_TYPES[a.type].label}</span>
    </Link>
  );
}

function Row({ a, fav, onStar }: { a: Addon; fav: boolean; onStar: () => void }) {
  return (
    <li>
      <Link href={a.href} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-card transition-colors hover:bg-subtle">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon name={a.icon} size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{a.name}</span>
            <span className="text-xs text-faint">{ADDON_TYPES[a.type].label}</span>
            {a.key && <span className="text-xs text-faint">· g then {a.key}</span>}
          </span>
          <span className="block text-sm text-muted">{a.description}</span>
          {a.connects?.length ? <span className="block text-xs text-faint">Connects to: {a.connects.join(", ")}</span> : null}
        </span>
        <StarButton on={fav} onClick={onStar} name={a.name} />
      </Link>
    </li>
  );
}

/** The add-ons library: every add-on in the code, with search, a type filter, three views and favorites. */
export default function AddonLibrary() {
  const { favorites, toggle } = useAddonFavorites();
  const [q, setQ] = useState("");
  const [type, setType] = useState<AddonType | "all">("all");
  const [view, setView] = useState<View>("grid");
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const v = readPref("addons.view");
    if (v === "grid" || v === "list" || v === "type") setView(v);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && t && !["INPUT", "TEXTAREA"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => searchAddons(ADDONS, q, type), [q, type]);
  const usedTypes = (Object.keys(ADDON_TYPES) as AddonType[]).filter((t) => ADDONS.some((a) => a.type === t));

  function star(a: Addon) {
    const ok = toggle(a.id);
    setNotice(ok ? null : `Your menu already has ${MAX_FAVORITES} favorites. Unpin one first (tap its star).`);
  }

  function pickView(v: View) {
    setView(v);
    writePref("addons.view", v);
  }

  const groups = view === "type" ? usedTypes.map((t) => ({ t, items: shown.filter((a) => a.type === t) })).filter((g) => g.items.length) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2">
          <Icon name="search" size={16} className="text-faint" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search add-ons  ( / )"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </label>
        <div className="flex rounded-lg border border-line-strong p-0.5 text-sm" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => pickView(v.id)}
              aria-pressed={view === v.id}
              className={`rounded-md px-2.5 py-1 ${view === v.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-fg"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {(["all", ...usedTypes] as (AddonType | "all")[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={`rounded-full border px-3 py-1 ${type === t ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
          >
            {t === "all" ? "All" : ADDON_TYPES[t].label}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">
          ★ In your menu: {favorites.length}/{MAX_FAVORITES}
        </span>
      </div>

      {notice && <p className="rounded-lg border border-warning px-3 py-2 text-sm">{notice}</p>}

      {!shown.length ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">No add-on matches “{q}”.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {shown.map((a) => (
            <Tile key={a.id} a={a} fav={favorites.includes(a.id)} onStar={() => star(a)} />
          ))}
        </div>
      ) : view === "list" ? (
        <ul className="space-y-2">
          {shown.map((a) => (
            <Row key={a.id} a={a} fav={favorites.includes(a.id)} onStar={() => star(a)} />
          ))}
        </ul>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.t} className="space-y-2">
              <div>
                <h2 className="text-sm font-semibold">{ADDON_TYPES[g.t].label}</h2>
                <p className="text-xs text-faint">{ADDON_TYPES[g.t].hint}</p>
              </div>
              <ul className="space-y-2">
                {g.items.map((a) => (
                  <Row key={a.id} a={a} fav={favorites.includes(a.id)} onStar={() => star(a)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
