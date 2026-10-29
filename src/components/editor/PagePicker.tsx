"use client";

import { useMemo, useState } from "react";
import type { PageRef } from "@/lib/editor/context";
import { MenuItem, MenuLabel, useListKeys } from "@/components/editor/ui";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function PageIcon({ icon }: { icon?: string | null }) {
  const v = icon || "📄";
  if (/^(https?:|\/)/.test(v)) return <img src={v} alt="" className="inline-block h-[1.1em] w-[1.1em] rounded-sm object-cover" />;
  return <span>{v}</span>;
}

/** Search box + list of notes (for Move to). */
export default function PagePicker({ pages, onPick, placeholder }: { pages: PageRef[]; onPick: (p: PageRef) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = fold(q.trim());
    return pages.filter((p) => !t || fold(p.title || "Untitled").includes(t)).slice(0, 50);
  }, [pages, q]);
  const [index, setIndex] = useListKeys(list.length, (i) => list[i] && onPick(list[i]));
  return (
    <div className="p-1">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="n-input mb-1 w-full" />
      <MenuLabel>Pages</MenuLabel>
      <div className="max-h-[320px] overflow-y-auto">
        {list.length === 0 && <p className="px-2 py-1.5 text-sm text-faint">No pages</p>}
        {list.map((p, i) => (
          <MenuItem key={p.id} icon={<PageIcon icon={p.icon} />} label={p.title || "Untitled"} active={i === index} onHover={() => setIndex(i)} onClick={() => onPick(p)} />
        ))}
      </div>
    </div>
  );
}
