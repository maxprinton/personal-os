"use client";

import { useState, useTransition } from "react";
import { saveVideoFolder } from "@/app/work-actions";

/** The Drive folder link: click it to open the folder; "Edit" shows the current link ready to change or replace. */
export default function DriveFolderLink({ folder, fallback }: { folder: string; fallback: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(folder);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function save() {
    setError("");
    start(async () => {
      const res = await saveVideoFolder(value);
      if (res.error) setError(res.error);
      else {
        if (!value.trim()) setValue(fallback);
        setEditing(false);
      }
    });
  }

  if (!editing) {
    return (
      <div className="mt-1 flex items-center gap-3 text-sm">
        <a href={folder} target="_blank" rel="noreferrer" className="font-medium text-accent underline">
          Open the Drive folder ↗
        </a>
        <button
          type="button"
          onClick={() => {
            setValue(folder);
            setEditing(true);
          }}
          className="text-xs text-muted underline"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          placeholder="https://drive.google.com/drive/folders/…"
          className="min-w-64 flex-1 rounded-md border border-line-strong px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-hover disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted underline">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
