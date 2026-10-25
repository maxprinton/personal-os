"use client";

import { useActionState } from "react";
import { saveNote } from "@/app/note-actions";
import type { ActionState } from "@/app/actions";

export default function NoteEditor({
  id,
  title,
  content,
  tags,
}: {
  id: string;
  title: string;
  content: string;
  tags: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveNote, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input
        name="title"
        defaultValue={title}
        placeholder="Title"
        className="w-full border-0 border-b border-line px-0 py-2 text-2xl font-semibold focus:outline-none"
      />
      <input
        name="tags"
        defaultValue={tags}
        placeholder="Tags, comma separated"
        className="w-full rounded-md border border-line-strong px-3 py-2 text-sm"
      />
      <textarea
        name="content"
        defaultValue={content}
        rows={16}
        placeholder="Write in Markdown…"
        className="w-full rounded-md border border-line-strong px-3 py-2 font-mono text-sm"
      />
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-sm text-accent-fg disabled:opacity-50">
          {pending ? "Saving..." : "Save"}
        </button>
        {state.ok && <span className="text-sm text-success">Saved.</span>}
        {state.error && <span className="text-sm text-danger">{state.error}</span>}
      </div>
    </form>
  );
}
