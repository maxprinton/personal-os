// Portfolio publishing — "source hash": a fingerprint of everything that ends up on the public page.
// Same hash as the last publish = nothing to republish. Used for change detection.
import { createHash } from "node:crypto";

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export type HashNote = { title: string | null; content: string | null; page?: { icon?: string | null; cover?: string | null } | null };
export type HashSlot = { kind: string; meta?: unknown; langs?: Record<string, unknown> | null };

export function sourceHash(note: HashNote, slot: HashSlot, lang: string): string {
  const langMeta = (slot.langs ?? {})[lang] ?? null;
  return createHash("sha256")
    .update(stable([note.title ?? "", note.content ?? "", note.page?.icon ?? "", note.page?.cover ?? "", slot.kind, slot.meta ?? null, langMeta]))
    .digest("hex")
    .slice(0, 32);
}
