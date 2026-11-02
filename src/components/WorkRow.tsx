"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteWorkClass, setVideoPosted, updateWorkClass } from "@/app/work-actions";
import type { ActionState } from "@/app/actions";
import { ClassFields, type Suggestions } from "@/components/WorkForms";
import { formatMinutes } from "@/lib/time";
import { fmtHours, fmtMoney, needsEvidence, ROLE_LABEL, SHEET_TYPE_LABEL, shortDay, toMinutes, type WorkClass } from "@/lib/work-log";

const INPUT = "rounded-md border border-line-strong px-2 py-1.5 text-sm";
const PRIMARY = "rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50";
const GHOST = "rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-subtle disabled:opacity-50";

function VideoCell({ c, ended }: { c: WorkClass; ended: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setVideoPosted, {});
  if (c.video_posted) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="id" value={c.id} />
        <input type="hidden" name="posted" value="0" />
        <span className="font-medium text-success">✓ Video posted</span>
        {c.video_url && (
          <a href={c.video_url} target="_blank" rel="noreferrer" className="text-xs underline">
            Open link
          </a>
        )}
        <button disabled={pending} className="text-xs text-muted underline hover:text-fg">
          Undo
        </button>
      </form>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={c.id} />
      <input type="hidden" name="posted" value="1" />
      <span className={`text-xs font-medium ${ended ? "text-warning" : "text-faint"}`}>{ended ? "Video not posted" : "Video: after class"}</span>
      <input name="video_url" placeholder={needsEvidence(c.sheet_type) ? "Drive link of the recording (required)" : "Drive link (optional)"} defaultValue={c.video_url ?? ""} className={`${INPUT} min-w-0 flex-1 basis-40 py-1 text-xs`} />
      <button disabled={pending} className={GHOST}>
        {pending ? "…" : "Mark posted"}
      </button>
      {state.error && <span className="basis-full text-xs text-danger">{state.error}</span>}
    </form>
  );
}

export default function WorkRow({ c, ended, suggestions }: { c: WorkClass; ended: boolean; suggestions: Suggestions }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(updateWorkClass, {});
  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  if (editing) {
    return (
      <li className="rounded-lg border border-accent bg-surface p-4 shadow-card">
        <form action={action} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ClassFields
            d={{
              id: c.id,
              class_date: c.class_date,
              start_time: c.start_time,
              end_time: c.end_time,
              group_name: c.group_name,
              role: c.role,
              sheet_type: c.sheet_type ?? "",
              requested_by: c.requested_by,
              notes: c.notes,
              rate: c.rate,
            }}
            s={suggestions}
            idp={`e-${c.id}`}
          />
          <div className="col-span-2 flex gap-2 sm:col-span-4">
            <button disabled={pending} className={PRIMARY}>
              {pending ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={GHOST}>
              Cancel
            </button>
          </div>
          {state.error && <p className="col-span-2 text-sm text-danger sm:col-span-4">{state.error}</p>}
        </form>
      </li>
    );
  }

  const missing = ended && !c.video_posted;
  return (
    <li className={`space-y-2 rounded-lg border bg-surface p-4 shadow-card ${missing ? "border-warning" : "border-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{c.group_name}</span>
            {c.sheet_type ? (
              <span className="rounded-full bg-subtle-2 px-2 py-px text-[11px] font-medium text-muted">{SHEET_TYPE_LABEL[c.sheet_type]}</span>
            ) : (
              <span className="rounded-full border border-line px-2 py-px text-[11px] text-faint">Not in the Sheet</span>
            )}
            {c.role === "head" && <span className="rounded-full bg-subtle-2 px-2 py-px text-[11px] font-medium text-muted">{ROLE_LABEL.head}</span>}
          </p>
          <p className="text-sm text-muted">
            {shortDay(c.class_date)} · {formatMinutes(toMinutes(c.start_time))} – {formatMinutes(toMinutes(c.end_time))}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">{fmtMoney(c.amount)}</p>
          <p className="text-xs text-muted tabular-nums">
            {fmtHours(c.hours)} h × {fmtMoney(c.rate)}
          </p>
        </div>
      </div>
      {(c.requested_by || c.notes) && (
        <p className="text-sm text-muted">
          {c.requested_by && <span>Requested by {c.requested_by}</span>}
          {c.requested_by && c.notes && " · "}
          {c.notes}
        </p>
      )}
      <VideoCell c={c} ended={ended} />
      <div className="flex gap-3 text-xs">
        <button type="button" onClick={() => setEditing(true)} className="text-muted underline hover:text-fg">
          Edit
        </button>
        <form
          action={deleteWorkClass}
          onSubmit={(e) => {
            if (!window.confirm(`Delete ${c.group_name} on ${shortDay(c.class_date)}?`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={c.id} />
          <button className="text-muted underline hover:text-danger">Delete</button>
        </form>
      </div>
    </li>
  );
}
