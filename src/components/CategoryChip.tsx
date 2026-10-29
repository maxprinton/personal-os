"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCategory, renameCategory } from "@/app/finance-actions";

/** A category pill: tap the name to rename it (every transaction follows), × to delete. */
export default function CategoryChip({ id, name, kind }: { id: string; name: string; kind: "income" | "expense" }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const locked = name.toLowerCase() === "adjustment";

  function save() {
    if (value.trim() === name) return setEditing(false);
    setError(null);
    start(async () => {
      const res = await renameCategory(id, value);
      if (res.error) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-1 rounded-full bg-subtle py-0.5 pl-2 pr-1 text-sm">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setValue(name);
              setEditing(false);
              setError(null);
            }
          }}
          autoFocus
          aria-label={`New name for ${name}`}
          className="w-32 rounded-md border border-line-strong bg-surface px-2 py-0.5 text-sm"
        />
        <button type="button" onClick={save} disabled={pending} className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-fg disabled:opacity-50">
          {pending ? "…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(name);
            setEditing(false);
            setError(null);
          }}
          aria-label="Cancel"
          className="rounded-full px-1.5 text-faint hover:text-fg"
        >
          ✕
        </button>
        {error && <span className="w-full px-1 text-xs text-danger">{error}</span>}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 rounded-full bg-subtle py-0.5 pl-3 pr-1 text-sm">
      {locked ? (
        <span title="Used for balance updates">{name}</span>
      ) : (
        <button type="button" onClick={() => setEditing(true)} title="Rename" className="hover:text-accent hover:underline">
          {name}
        </button>
      )}
      <span className="text-xs text-faint">{kind === "income" ? "income" : "expense"}</span>
      <form action={deleteCategory}>
        <input type="hidden" name="id" value={id} />
        <button
          aria-label={`Delete ${name}`}
          title="Delete category (past transactions become Uncategorized)"
          className="rounded-full px-1.5 text-faint hover:text-danger"
        >
          ×
        </button>
      </form>
    </li>
  );
}
