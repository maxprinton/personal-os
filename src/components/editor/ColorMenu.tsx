"use client";

import { COLOR_LABEL, COLOR_NAMES } from "@/lib/editor/colors";
import { MenuLabel, MenuItem, Swatch } from "@/components/editor/ui";

/** Notion's color list: "Last used", 10 text colors, 10 background colors. */
export default function ColorMenu({ current, last, onPick }: { current: string | null; last: string | null; onPick: (color: string | null) => void }) {
  const row = (value: string | null, bg: boolean, c: (typeof COLOR_NAMES)[number]) => (
    <MenuItem
      key={`${bg}-${c}`}
      icon={<Swatch color={c} bg={bg} />}
      label={c === "default" ? (bg ? "Default background" : "Default text") : `${COLOR_LABEL[c]}${bg ? " background" : ""}`}
      right={(current ?? null) === value || (!current && c === "default" && !bg) ? <span className="text-xs">✓</span> : undefined}
      onClick={() => onPick(value)}
    />
  );
  const lastName = last ? (last.replace(/_bg$/, "") as (typeof COLOR_NAMES)[number]) : null;
  return (
    <div className="max-h-[420px] overflow-y-auto p-1">
      {last && lastName && COLOR_NAMES.includes(lastName) && (
        <>
          <MenuLabel>Last used</MenuLabel>
          {row(last, last.endsWith("_bg"), lastName)}
        </>
      )}
      <MenuLabel>Text color</MenuLabel>
      {COLOR_NAMES.map((c) => row(c === "default" ? null : c, false, c))}
      <MenuLabel>Background color</MenuLabel>
      {COLOR_NAMES.map((c) => row(c === "default" ? null : `${c}_bg`, true, c))}
    </div>
  );
}
