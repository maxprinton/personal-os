"use client";

import { useActionState } from "react";
import { saveNoteTags } from "@/app/block-note-actions";
import type { ActionState } from "@/app/actions";

/** Tags of a block note (its text autosaves on its own). */
export default function NoteTagsForm({ id, tags }: { id: string; tags: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveNoteTags, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="tags"
        defaultValue={tags}
        placeholder="Tags, comma separated"
        className="min-w-0 flex-1 rounded-md border border-line-strong px-3 py-2 text-sm"
      />
      <button disabled={pending} className="rounded-md border border-edge px-3 py-2 text-sm hover:bg-subtle disabled:opacity-50">
        {pending ? "Saving…" : "Save tags"}
      </button>
      {state.ok && <span className="text-sm text-success">Saved.</span>}
      {state.error && <span className="text-sm text-danger">{state.error}</span>}
    </form>
  );
}
